/**
 * 我的教材页
 * - 按学生分类（A/B/C）自动匹配教材序列
 * - 解锁规则：学到当前册的解锁章后，下一册自动开放（服务端计算）
 * - 已解锁 -> 进入教材阅读页（含老师批注同步）
 */
const api = require('../../utils/api');
const edition = require('../../utils/edition');

Page({
  data: {
    classTag: '',
    curBook: 1,
    curChapter: 1,
    books: [],
    loading: true,
  },

  onShow() {
    if (!edition.guardStudentPage()) return;
    if (!wx.getStorageSync('userToken')) {
      wx.showToast({ title: '请先到「我的」页登录', icon: 'none' });
      return;
    }
    api
      .fetchMyMaterials()
      .then((d) => this.setData({ ...d, loading: false }))
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      });
  },

  onOpen(e) {
    const { id, unlocked, order } = e.currentTarget.dataset;
    if (!unlocked) {
      return wx.showToast({ title: `学完当前册指定章节后自动解锁第 ${order} 册`, icon: 'none' });
    }
    wx.navigateTo({ url: '/pages/material/index?id=' + id });
  },
});
