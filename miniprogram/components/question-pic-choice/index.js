/**
 * 看图选词 / 听音选图（2x2 大卡片）
 * 点击卡片立即判定，结果通过 answered 事件抛给页面
 */
Component({
  properties: {
    question: { type: Object, value: null },
  },

  data: {
    locked: false,
    // 每个选项的状态：'' | 'correct' | 'wrong'
    states: {},
  },

  observers: {
    'question.id'() {
      this.setData({ locked: false, states: {} });
    },
  },

  methods: {
    onTapOption(e) {
      if (this.data.locked || !this.properties.question) return;
      const { id } = e.currentTarget.dataset;
      const q = this.properties.question;
      const correct = id === q.answer;
      const states = {};
      states[id] = correct ? 'correct' : 'wrong';
      if (!correct) states[q.answer] = 'correct'; // 同时提示正确答案
      this.setData({ locked: true, states });
      this.triggerEvent('answered', { correct, option: id });
    },
  },
});
