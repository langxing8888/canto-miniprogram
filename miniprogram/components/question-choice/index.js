/**
 * 文字选择题（翻译 / 语境辨析 / 汉字选粤拼 / 粤拼选汉字 / 听音选词选句）
 * 点击选项立即判定，结果通过 answered 事件抛给页面
 */
Component({
  properties: {
    question: { type: Object, value: null },
  },

  data: {
    locked: false,
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
      if (!correct) states[q.answer] = 'correct';
      this.setData({ locked: true, states });
      this.triggerEvent('answered', { correct, option: id });
    },
  },
});
