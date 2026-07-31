/**
 * 课后作业页（单页闭环）
 * - 列表：待完成 / 已提交（含已批改）
 * - 展开卡片：查看题目 -> 拍照/选图（自动压缩上传）-> 提交
 * - 已批改：分数 + 评语 + 老师红笔批改图（点击可放大）
 */
const api = require('../../utils/api');
const edition = require('../../utils/edition');

Page({
  data: {
    tab: 'todo', // todo | done
    list: [],
    todoList: [],
    doneList: [],
    openId: '', // 展开的作业
    draftText: '',
    draftImages: [], // 已上传的 url
    uploading: false,
    submitting: false,
    loading: true,
  },

  onShow() {
    if (!edition.guardStudentPage()) return;
    if (!wx.getStorageSync('userToken')) {
      wx.showToast({ title: '请先到「我的」页登录', icon: 'none' });
      return;
    }
    this.refresh();
    // 进入作业页即把作业相关通知标记已读（清红点）
    api.readNotices({ all: 1 }).catch(() => {});
  },

  refresh() {
    this.setData({ loading: true });
    api
      .fetchHomework()
      .then((list) => {
        const fmt = (ts) => (ts ? new Date(ts).toLocaleDateString() : '');
        const mapped = list.map((hw) => ({
          ...hw,
          endText: hw.endAt ? fmt(hw.endAt) + ' 截止' : '不限期',
          subTime: hw.sub ? new Date(hw.sub.ts).toLocaleDateString() : '',
        }));
        this.setData({
          list: mapped,
          todoList: mapped.filter((h) => !h.sub && !h.expired),
          doneList: mapped.filter((h) => h.sub),
          loading: false,
        });
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      });
  },

  onTab(e) {
    this.setData({ tab: e.currentTarget.dataset.tab, openId: '' });
  },

  onToggle(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ openId: this.data.openId === id ? '' : id, draftText: '', draftImages: [] });
  },

  onDraftInput(e) {
    this.setData({ draftText: e.detail.value });
  },

  onPickImage() {
    if (this.data.draftImages.length >= 6) return wx.showToast({ title: '最多 6 张', icon: 'none' });
    wx.chooseMedia({
      count: 6 - this.data.draftImages.length,
      mediaType: ['image'],
      sizeType: ['compressed'],
      success: async (r) => {
        this.setData({ uploading: true });
        try {
          for (const f of r.tempFiles) {
            const url = await api.uploadHwImage(f.tempFilePath);
            this.setData({ draftImages: [...this.data.draftImages, url] });
          }
        } catch (e) {
          wx.showToast({ title: e.message || '上传失败', icon: 'none' });
        }
        this.setData({ uploading: false });
      },
    });
  },

  onRemoveImage(e) {
    const idx = e.currentTarget.dataset.idx;
    const imgs = this.data.draftImages.slice();
    imgs.splice(idx, 1);
    this.setData({ draftImages: imgs });
  },

  onSubmit(e) {
    const hwId = e.currentTarget.dataset.id;
    const { draftText, draftImages } = this.data;
    if (!draftText && !draftImages.length) return wx.showToast({ title: '写点内容或传张图片吧', icon: 'none' });
    this.setData({ submitting: true });
    api
      .submitHomework(hwId, draftText, draftImages)
      .then(() => {
        wx.showToast({ title: '提交成功', icon: 'success' });
        this.setData({ submitting: false, openId: '', draftText: '', draftImages: [], tab: 'done' });
        this.refresh();
      })
      .catch((err) => {
        this.setData({ submitting: false });
        wx.showToast({ title: err.message || '提交失败', icon: 'none' });
      });
  },

  onPreview(e) {
    const { urls, cur } = e.currentTarget.dataset;
    wx.previewImage({ urls, current: cur });
  },
});
