const api = require('../../utils/api');
const store = require('../../utils/store');
const edition = require('../../utils/edition');

Page({
  data: {
    totalMinutes: 0,
    totalAnswered: 0,
    passedCount: 0,
    streakDays: 0,
    wrongCount: 0,
    user: null, // { nickname, avatarEmoji, phone, hasPhone }
    showLogin: false, // 登录弹层
    agreed: false, // 已勾选协议
  },

  onShow() {
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ selected: 3 });
    }
    // 双版本状态（学员横幅可见性 + 切换入口）
    this.setData({ isStudentEd: edition.isStudent(), versionSwitchOn: edition.switchEnabled() });
    const totals = store.getTotals();
    const levels = api.getLevels();
    const checkin = wx.getStorageSync('checkin') || { days: 0 };
    this.setData({
      totalMinutes: Math.floor(totals.studySeconds / 60),
      totalAnswered: totals.answeredCount,
      passedCount: levels.filter((lv) => lv.passed).length,
      streakDays: checkin.days || 0,
      wrongCount: store.getWrongBook().filter((w) => !w.resolved).length,
      user: wx.getStorageSync('user') || null,
    });
    // 登录了则以云端连续打卡天数为准（跨设备一致）
    if (wx.getStorageSync('userToken')) {
      api.fetchCheckin().then((d) => this.setData({ streakDays: d.streak || 0 })).catch(() => {});
    }
  },

  /* ===== 登录弹层 ===== */
  openLoginSheet() {
    this.setData({ showLogin: true, agreed: false });
    if (typeof this.getTabBar === 'function') this.getTabBar().setData({ hide: true }); // 弹层期间隐藏 TabBar
  },

  closeLoginSheet() {
    this.setData({ showLogin: false });
    if (typeof this.getTabBar === 'function') this.getTabBar().setData({ hide: false });
  },

  noop() {},

  toggleAgree() {
    this.setData({ agreed: !this.data.agreed });
  },

  onNeedAgree() {
    wx.showToast({ title: '请先阅读并勾选同意协议', icon: 'none' });
  },

  goAgreement(e) {
    const { type } = e.currentTarget.dataset;
    const urls = wx.getStorageSync('legalUrls') || {};
    const link = type === 'privacy' ? urls.privacy : urls.ua;
    if (link) {
      // 后台配置了 HTTPS 链接：用 web-view 打开（需在小程序后台配业务域名白名单）
      wx.navigateTo({ url: '/pages/webview/index?url=' + encodeURIComponent(link) + '&title=' + encodeURIComponent(type === 'privacy' ? '隐私政策' : '用户协议') });
    } else {
      // 未配置：用内置文本版本兜底
      wx.navigateTo({ url: '/pages/agreement/index?type=' + type });
    }
  },

  /** 退出登录：进度保存到云端账号，本机清零 */
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '学习进度将保存到你的账号，本机记录清空；下次登录自动恢复。',
      confirmText: '退出',
      confirmColor: '#ff4b4b',
      success: (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '保存进度中…', mask: true });
        api.uploadProgress().then((saved) => {
          wx.hideLoading();
          if (!saved) {
            // 云端保存失败时不清本机，避免丢数据
            wx.showModal({
              title: '进度保存失败',
              content: '网络异常，本次退出已取消，请稍后再试。',
              showCancel: false,
            });
            return;
          }
          wx.removeStorageSync('user');
          wx.removeStorageSync('userToken');
          store.clearProgress(); // 本机学习数据归零
          this.setData({ user: null });
          this.onShow();
          wx.showToast({ title: '已退出，进度已存入账号', icon: 'none' });
        });
      },
    });
  },

  /** 手机号一键登录（用户拒绝授权则降级为微信身份登录） */
  onPhoneLogin(e) {
    const phoneCode = (e.detail && e.detail.code) || '';
    if (!phoneCode && e.detail && e.detail.errMsg && e.detail.errMsg.includes('deny')) {
      // 用户点了拒绝：仍可用微信身份登录
      wx.showModal({
        title: '登录',
        content: '不授权手机号也可以登录，仅用微信身份创建账号，是否继续？',
        confirmText: '继续登录',
        success: (r) => {
          if (r.confirm) this.doLogin('');
        },
      });
      return;
    }
    this.doLogin(phoneCode);
  },

  doLogin(phoneCode) {
    wx.showLoading({ title: '登录中…', mask: true });
    api
      .wxLogin(phoneCode)
      .then((d) => {
        wx.setStorageSync('user', d.user);
        wx.setStorageSync('userToken', d.token);
        // 进度同步：云端有快照则恢复到本机；没有则把本机进度上传（游客转正）
        return api.fetchProgress().then((res) => {
          if (res && res.progress) {
            store.restore(res.progress);
          } else {
            api.uploadProgress();
          }
          wx.hideLoading();
          this.setData({ user: d.user, showLogin: false });
          if (typeof this.getTabBar === 'function') this.getTabBar().setData({ hide: false });
          this.onShow(); // 恢复后刷新学习数据
          wx.showToast({ title: d.user.hasPhone ? '登录成功' : '已用微信身份登录', icon: 'success' });
        });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '登录失败', icon: 'none' });
      });
  },

  goWrongBook() {
    wx.navigateTo({ url: '/pages/wrongbook/index' });
  },

  /** 切换学员版/用户版 */
  onSwitchEdition() {
    const cur = edition.isStudent();
    wx.showActionSheet({
      itemList: [cur ? '切换到用户版（自学）' : '切换到学员版（机构学员）'],
      success: () => {
        edition.setEdition(cur ? 'user' : 'student');
        this.setData({ isStudentEd: !cur });
        wx.showToast({ title: cur ? '已切换到用户版' : '已切换到学员版', icon: 'none' });
      },
    });
  },

  goMyCourse() {
    wx.navigateTo({ url: '/pages/mycourse/index' });
  },

  goAchievement() {
    wx.navigateTo({ url: '/pages/achievement/index' });
  },

  goLevels() {
    wx.switchTab({ url: '/pages/levels/index' });
  },

  onAbout() {
    wx.showModal({
      title: '粤讲粤醒目',
      content: '版本 0.2.0\n场景化粤语口语学习\n闯关刷题 · AI 纠音 · 录播课',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  onClearData() {
    wx.showModal({
      title: '清除本地数据',
      content: '将清空本机的学习进度、错题本和打卡记录（服务器数据不受影响），确定？',
      confirmColor: '#ff4b4b',
      success: (res) => {
        if (res.confirm) {
          wx.clearStorageSync();
          store.init();
          this.onShow();
          wx.showToast({ title: '已清除', icon: 'success' });
        }
      },
    });
  },
});
