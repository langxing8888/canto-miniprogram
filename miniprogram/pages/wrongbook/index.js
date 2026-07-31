const api = require('../../utils/api');
const store = require('../../utils/store');

const TYPE_LABELS = {
  pic_choice: '看图/听音选图',
  choice: '选择题',
  sentence_order: '选词组句',
  speaking: '口语题',
};

Page({
  data: {
    tab: 'all', // all | todo | done
    list: [],
    todoCount: 0,
    doneCount: 0,
    totalErrors: 0,
  },

  onShow() {
    const wrongs = store.getWrongBook();
    this.fullList = wrongs
      .map((w) => {
        const q = api.getQuestionById(w.questionId);
        if (!q) return null;
        const level = api.getLevelById(w.levelId);
        // 题干展示文本：题干文字 > 普通话提示 > 词块拼句
        const text =
          (q.stem && q.stem.text) ||
          q.prompt ||
          (q.tokens ? q.tokens.map((t) => t.text).join('') : '');
        const jyut =
          (q.stem && q.stem.jyut) ||
          (q.tokens ? q.tokens.map((t) => t.jyut).join(' ') : '');
        return {
          questionId: w.questionId,
          levelId: w.levelId,
          levelName: level ? level.name : '',
          typeLabel: TYPE_LABELS[q.type] || q.type,
          text,
          jyut,
          errorCount: w.errorCount || 1,
          resolved: !!w.resolved,
          time: w.time,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.time - a.time);

    this.setData({
      todoCount: this.fullList.filter((i) => !i.resolved).length,
      doneCount: this.fullList.filter((i) => i.resolved).length,
      totalErrors: this.fullList.reduce((s, i) => s + i.errorCount, 0),
    });
    this.applyFilter(this.data.tab);
  },

  onTabChange(e) {
    this.applyFilter(e.currentTarget.dataset.tab);
  },

  applyFilter(tab) {
    let list = this.fullList || [];
    if (tab === 'todo') list = list.filter((i) => !i.resolved);
    if (tab === 'done') list = list.filter((i) => i.resolved);
    this.setData({ tab, list });
  },

  /** 去所属关卡重练 */
  onRetryLevel(e) {
    const { levelId } = e.currentTarget.dataset;
    wx.navigateTo({ url: `/pages/quiz/index?levelId=${levelId}` });
  },
});
