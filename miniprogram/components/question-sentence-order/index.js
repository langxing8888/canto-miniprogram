/**
 * 选词组成句子 / 听音排序（纯点击交互，参考多邻国）
 * - 下方词块点击后飞入上方虚线槽位
 * - 点击上方已填词块退回下方
 * - 点击【提交】判定，结果通过 answered 事件抛给页面
 */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

Component({
  properties: {
    question: { type: Object, value: null },
  },

  data: {
    pool: [], // [{ text, jyut, used }]
    filled: [], // [poolIndex]
    locked: false,
    result: '', // '' | 'correct' | 'wrong'
  },

  observers: {
    'question.id'() {
      this.reset();
    },
  },

  lifetimes: {
    attached() {
      this.reset();
    },
  },

  methods: {
    reset() {
      const q = this.properties.question;
      if (!q) return;
      const all = (q.tokens || []).concat(q.distractors || []);
      this.setData({
        pool: shuffle(all).map((t) => ({ ...t, used: false })),
        filled: [],
        locked: false,
        result: '',
      });
    },

    onTapPool(e) {
      if (this.data.locked) return;
      const idx = e.currentTarget.dataset.idx;
      if (this.data.pool[idx].used) return;
      this.setData({
        [`pool[${idx}].used`]: true,
        filled: this.data.filled.concat(idx),
        result: '',
      });
    },

    onTapFilled(e) {
      if (this.data.locked) return;
      const pos = e.currentTarget.dataset.pos;
      const poolIdx = this.data.filled[pos];
      const filled = this.data.filled.slice();
      filled.splice(pos, 1);
      this.setData({
        [`pool[${poolIdx}].used`]: false,
        filled,
        result: '',
      });
    },

    onSubmit() {
      if (this.data.locked) return;
      const q = this.properties.question;
      const answer = q.tokens.map((t) => t.text).join('');
      const mine = this.data.filled.map((i) => this.data.pool[i].text).join('');
      const correct = mine === answer;
      this.setData({ locked: true, result: correct ? 'correct' : 'wrong' });
      this.triggerEvent('answered', { correct, option: mine });
    },

    /** 槽位区整句播放按钮 → 由页面驱动左上角播放器播放 */
    onTapReplay() {
      this.triggerEvent('replay');
    },
  },
});
