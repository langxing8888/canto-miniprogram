/**
 * 学习成果页：多维度数据可视化
 * - 1对1 课程：已上节数（云端课时包）
 * - 闯关：通关数/答题量/学习时长（本地进度，登录后与云同步）
 * - AI 纠音：练习次数（本地事件埋点）
 * - 坚持：连续打卡天数
 */
const store = require('../../utils/store');
const api = require('../../utils/api');
const edition = require('../../utils/edition');

function fmtHours(seconds) {
  if (seconds < 3600) return (seconds / 60).toFixed(0) + ' 分钟';
  return (seconds / 3600).toFixed(1) + ' 小时';
}

Page({
  data: {
    lessons: 0, // 1对1 已上节数
    passed: 0,
    total: 0,
    passPct: 0,
    answered: 0,
    studyText: '0 分钟',
    speakCount: 0,
    checkinDays: 0,
    wrongResolved: 0,
  },

  onShow() {
    this.setData({ isStudentEd: edition.isStudent() });
    // 本地数据
    const totals = wx.getStorageSync('totals') || { studySeconds: 0, answeredCount: 0 };
    const checkin = wx.getStorageSync('checkin') || { days: 0 };
    const progress = wx.getStorageSync('progress') || {};
    const wrong = wx.getStorageSync('wrongBook') || [];
    const events = wx.getStorageSync('events') || [];
    const passed = Object.keys(progress).filter((k) => progress[k] && progress[k].passed).length;
    const speakCount = events.filter((e) => e.type === 'speaking_assess').length;

    const levels = api.getLevels() || [];
    const total = levels.length || 1;

    this.setData({
      total,
      passPct: Math.min(100, Math.round((passed / total) * 100)),
      passed,
      answered: totals.answeredCount || 0,
      studyText: fmtHours(totals.studySeconds || 0),
      speakCount,
      checkinDays: checkin.days || 0,
      wrongResolved: wrong.filter((w) => w.resolved).length,
    });

    // 云端：1对1 已上节数
    if (wx.getStorageSync('userToken')) {
      api.fetchMyCourse().then((d) => this.setData({ lessons: d.pack.used || 0 })).catch(() => {});
    }
  },
});
