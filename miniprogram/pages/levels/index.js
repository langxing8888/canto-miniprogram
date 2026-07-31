const api = require('../../utils/api');
const store = require('../../utils/store');
const edition = require('../../utils/edition');

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return '夜阑人静';
  if (h < 12) return '早晨！';
  if (h < 18) return '午安！';
  return '夜晚好！';
}

Page({
  data: {
    levels: [],
    totalMinutes: 0,
    totalAnswered: 0,
    passedCount: 0,
    wrongCount: 0,
    greeting: '',
    nextLevelId: '',
    nextLevelName: '',
  },

  onShow() {
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ selected: 0 });
    }
    // 双版本：开关开启且未选择时弹版本选择；用户版不加载学员元素
    const showEditionSheet = edition.needChoose();
    const isStudentEd = edition.isStudent();
    this.setData({ showEditionSheet, isStudentEd });
    if (showEditionSheet && typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ hide: true });
    }
    if (isStudentEd) this.loadNextLesson();
    else this.setData({ nextLesson: null });
    const totals = store.getTotals();
    const levels = api.getLevels();
    const passedCount = levels.filter((lv) => lv.passed).length;
    // 下一待挑战关卡（全部通关则回到第一关复习）
    const next = levels.find((lv) => !lv.locked && !lv.passed) || levels[0];
    this.setData({
      levels,
      totalMinutes: Math.floor(totals.studySeconds / 60),
      totalAnswered: totals.answeredCount,
      passedCount,
      wrongCount: store.getWrongBook().filter((w) => !w.resolved).length,
      greeting: greeting(),
      nextLevelId: next ? next.id : '',
      nextLevelName: next ? next.name : '',
    });
  },

  onTapContinue() {
    if (!this.data.nextLevelId) return;
    wx.navigateTo({ url: `/pages/quiz/index?levelId=${this.data.nextLevelId}` });
  },

  onTapWrongBook() {
    wx.navigateTo({ url: '/pages/wrongbook/index' });
  },

  onTapLevel(e) {
    const { id, locked } = e.currentTarget.dataset;
    if (locked) {
      wx.showToast({ title: '先通过上一关啦', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/quiz/index?levelId=${id}` });
  },

  /** 课表速览：今天/明天最近的一节 1对1 课 */
  loadNextLesson() {
    if (!wx.getStorageSync('userToken')) return this.setData({ nextLesson: null });
    api
      .fetchMyCourse()
      .then((d) => {
        const p = (n) => String(n).padStart(2, '0');
        const fmt = (dt) => `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
        const today = fmt(new Date());
        const tomorrow = fmt(new Date(Date.now() + 86400000));
        const next = d.bookings
          .filter((b) => b.status === 'booked' && (b.date === today || b.date === tomorrow))
          .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
        this.setData({ nextLesson: next ? { ...next, when: next.date === today ? '今天' : '明天' } : null });
      })
      .catch(() => this.setData({ nextLesson: null }));
  },

  goMyCourse() {
    wx.navigateTo({ url: '/pages/mycourse/index' });
  },

  /** 版本选择（学员版/用户版） */
  onChooseEdition(e) {
    const ed = e.currentTarget.dataset.ed;
    edition.setEdition(ed);
    this.setData({ showEditionSheet: false, isStudentEd: ed !== 'user' });
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ hide: false });
    }
    if (ed !== 'user') this.loadNextLesson();
    wx.showToast({ title: ed === 'user' ? '已进入用户版' : '已进入学员版', icon: 'none' });
  },
});
