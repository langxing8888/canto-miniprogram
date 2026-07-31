const store = require('../../utils/store');
const api = require('../../utils/api');

Page({
  data: {
    days: 0,
  },

  onLoad() {
    // 本地先记一天（离线兑底），登录了则上云并以云端连续天数为准
    this.setData({ days: store.checkin() });
    if (wx.getStorageSync('userToken')) {
      api.doCheckin()
        .then((d) => this.setData({ days: d.streak || d.total || this.data.days }))
        .catch(() => {});
    }
  },

  onContinue() {
    wx.reLaunch({ url: '/pages/levels/index' });
  },
});
