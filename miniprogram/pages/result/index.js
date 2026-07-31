function fmt(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}分${s}秒`;
}

Page({
  data: {
    levelId: '',
    passed: false,
    first: 0,
    final: 0,
    total: 0,
    firstRate: 0,
    finalRate: 0,
    timeText: '',
  },

  onLoad(options) {
    const first = Number(options.first || 0);
    const final = Number(options.final || 0);
    const total = Number(options.total || 0);
    this.setData({
      levelId: options.levelId || '',
      passed: options.passed === '1',
      first,
      final,
      total,
      firstRate: total ? Math.round((first / total) * 100) : 0,
      finalRate: total ? Math.round((final / total) * 100) : 0,
      timeText: fmt(Number(options.seconds || 0)),
    });
  },

  /** 继续学习 → 打卡页 */
  onContinue() {
    wx.redirectTo({ url: '/pages/checkin/index' });
  },

  /** 未通关：再挑战一次 */
  onRetry() {
    wx.redirectTo({ url: `/pages/quiz/index?levelId=${this.data.levelId}` });
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/levels/index' });
  },
});
