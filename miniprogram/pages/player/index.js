const store = require('../../utils/store');
const api = require('../../utils/api');

Page({
  data: {
    name: '',
    url: '',
    startAt: 0,
  },

  onLoad(options) {
    const url = decodeURIComponent(options.url || '');
    const name = decodeURIComponent(options.name || '课程播放');
    wx.setNavigationBarTitle({ title: name });
    // 断点续播：读取上次进度（本地兜底，云端进度启动时合并）
    const progress = wx.getStorageSync('watchProgress') || {};
    this.courseId = options.courseId || '';
    this.duration = 0;
    this.currentTime = 0;
    this.reported = 0;
    this.setData({ url, name, startAt: progress[this.courseId] || 0 });
  },

  onReady() {
    this.videoCtx = wx.createVideoContext('coursePlayer');
    if (this.data.startAt > 5) {
      this.videoCtx.seek(this.data.startAt - 3); // 留 3 秒缓冲
      wx.showToast({ title: '已从上次位置继续', icon: 'none' });
    }
    // 每 15 秒上报一次进度（防止中途杀进程丢记录）
    this.timer = setInterval(() => this.report(false), 15000);
  },

  onLoadedMeta(e) {
    this.duration = Math.floor(e.detail.duration || 0);
  },

  onTimeUpdate(e) {
    this.currentTime = Math.floor(e.detail.currentTime);
    if (!this.duration && e.detail.duration) this.duration = Math.floor(e.detail.duration);
  },

  /** 上报观看进度（本地 + 云端） */
  report(ended) {
    if (!this.courseId || this.currentTime <= 5) return;
    const progress = wx.getStorageSync('watchProgress') || {};
    progress[this.courseId] = this.currentTime;
    wx.setStorageSync('watchProgress', progress);
    // 进度未变化且非结束事件则跳过云端上报，省请求
    if (!ended && this.currentTime === this.reported) return;
    this.reported = this.currentTime;
    api.reportWatch(this.courseId, this.currentTime, this.duration, ended);
  },

  onEnded() {
    this.currentTime = this.duration || this.currentTime;
    this.report(true);
    wx.showModal({
      title: '本节课已学完 🎉',
      content: '去闯关页做几道题巩固一下吧！',
      confirmText: '去练习',
      cancelText: '再看看',
      success: (r) => {
        if (r.confirm) wx.switchTab({ url: '/pages/levels/index' });
      },
    });
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
    this.report(false);
  },

  onError(e) {
    store.logEvent('video_error', { courseId: this.courseId, err: e.detail.errMsg });
    wx.showToast({ title: '视频加载失败', icon: 'none' });
  },
});
