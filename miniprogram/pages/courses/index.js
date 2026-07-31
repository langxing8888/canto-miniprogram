const api = require('../../utils/api');
const edition = require('../../utils/edition');

Page({
  data: {
    courses: [],
    categories: ['全部'],
    activeCat: '全部',
    filtered: [],
    continueCard: null, // 最近在学（未看完）的一门，置顶"继续学习"
  },

  onShow() {
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ selected: 2 });
    }
    Promise.all([api.getCourses(), api.fetchWatch(), api.fetchCourseCategories()]).then(([list, watch, cats]) => {
      const w = watch || {};
      const courses = list.map((c) => {
        const rec = w[c.id] || {};
        return {
          ...c,
          priceYuan: c.price ? (c.price / 100).toFixed(c.price % 100 === 0 ? 0 : 2) : '0',
          pct: rec.pct || 0,
          watched: (rec.pct || 0) > 0,
          finished: (rec.pct || 0) >= 95,
          lastTs: rec.ts || 0,
        };
      });
      // 继续学习：最近观看且未看完
      const inProgress = courses
        .filter((c) => c.watched && !c.finished && c.videoUrl)
        .sort((a, b) => b.lastTs - a.lastTs)[0] || null;
      // 分类：后台配置优先，兜底用课程里出现过的分类
      const cfgCats = Array.isArray(cats) && cats.length ? cats : [...new Set(list.map((c) => c.category))];
      const categories = ['全部'].concat(cfgCats);
      this.setData({ courses, categories, continueCard: inProgress });
      this.applyFilter(this.data.activeCat);
    });
  },

  onTapCat(e) {
    this.applyFilter(e.currentTarget.dataset.cat);
  },

  applyFilter(cat) {
    const list = this.data.courses;
    this.setData({
      activeCat: cat,
      filtered: cat === '全部' ? list : list.filter((c) => c.category === cat),
    });
  },

  onTapCourse(e) {
    const { id } = e.currentTarget.dataset;
    const course = this.data.courses.find((c) => c.id === id);
    if (!course) return;
    // 学员专享课：用户版不可看
    if (course.studentOnly && !edition.isStudent()) {
      wx.showModal({ title: '学员专享课程', content: '该课程仅对机构学员开放，可在「我的」页切换学员版或联系客服。', showCancel: false });
      return;
    }
    // 付费课且未购：拉起购买
    if (course.locked) return this.promptBuy(course);
    this.playCourse(course);
  },

  /** 进入播放：向后端换取鉴权后的真实播放地址（免费/会员/已购才有） */
  playCourse(course) {
    if (!course.videoUrl && !course.owned && course.price > 0) return this.promptBuy(course);
    // 免费课列表已带 videoUrl，可直接播；付费已购课走鉴权接口取地址
    const go = (url) => {
      if (!url) return wx.showToast({ title: '该课程视频待上传，敬请期待', icon: 'none' });
      wx.navigateTo({ url: `/pages/player/index?courseId=${course.id}&url=${encodeURIComponent(url)}&name=${encodeURIComponent(course.name)}` });
    };
    if (course.videoUrl) return go(course.videoUrl);
    api.fetchCoursePlay(course.id).then((d) => go(d.videoUrl)).catch((err) => {
      wx.showToast({ title: err.message || '无法播放', icon: 'none' });
    });
  },

  /** 付费课购买引导（支付未开通时优雅提示） */
  promptBuy(course) {
    if (!wx.getStorageSync('userToken')) {
      wx.showToast({ title: '请先到「我的」页登录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '购买课程',
      content: `《${course.name}》\n价格 ¥${course.priceYuan}\n\n购买后永久可看，或开通会员畅看全部课程。`,
      confirmText: '立即购买',
      success: (r) => {
        if (!r.confirm) return;
        api.createCourseOrder({ type: 'course', courseId: course.id })
          .then((d) => {
            if (d.needConfig) {
              wx.showModal({ title: '支付即将开放', content: '课程购买通道正在开通中，敬请期待～', showCancel: false });
              return;
            }
            // 支付已配置：调起微信支付
            wx.requestPayment(Object.assign({}, d.payParams, {
              success: () => { wx.showToast({ title: '购买成功', icon: 'success' }); setTimeout(() => this.onShow(), 800); },
              fail: () => wx.showToast({ title: '已取消支付', icon: 'none' }),
            }));
          })
          .catch((err) => wx.showToast({ title: err.message || '下单失败', icon: 'none' }));
      },
    });
  },

  onContinue() {
    const c = this.data.continueCard;
    if (c) this.onTapCourse({ currentTarget: { dataset: { id: c.id } } });
  },
});
