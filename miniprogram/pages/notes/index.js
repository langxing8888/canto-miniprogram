const api = require('../../utils/api');
const edition = require('../../utils/edition');

Page({
  data: { notes: [], loaded: false },

  onShow() {
    if (!edition.guardStudentPage()) return;
    if (!wx.getStorageSync('userToken')) {
      wx.showToast({ title: '请先到「我的」页登录', icon: 'none' });
      this.setData({ loaded: true });
      return;
    }
    this.load();
  },

  load() {
    api.fetchMyNotes().then((list) => {
      const notes = (list || []).map((n) => ({
        ...n,
        timeText: this.fmt(n.ts),
      }));
      this.setData({ notes, loaded: true });
    }).catch(() => this.setData({ loaded: true }));
  },

  fmt(ts) {
    const d = new Date(ts);
    const p = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  },

  onTapImg(e) {
    const { url, imgs } = e.currentTarget.dataset;
    wx.previewImage({ current: url, urls: imgs });
  },
});
