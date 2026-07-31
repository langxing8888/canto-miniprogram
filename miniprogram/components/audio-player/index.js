/**
 * 左上角小人音频播放入口
 * - 每道题随机一个吉祥物形象（矢量插画，共5个）
 * - 进入题目自动播放一次，点击小人重播
 * - 听力题（slowable）额外显示「小乌龟」慢速按钮
 */
const MASCOT_COUNT = 5;
const store = require('../../utils/store');

Component({
  properties: {
    src: { type: String, value: '' },
    slowable: { type: Boolean, value: false },
    autoplay: { type: Boolean, value: true },
    // 题目 id 变化时重新随机小人并自动播放
    questionId: { type: String, value: '' },
  },

  data: {
    avatarIdx: 0,
    playing: false,
  },

  observers: {
    questionId() {
      this.setData({ avatarIdx: Math.floor(Math.random() * MASCOT_COUNT) });
      if (this.properties.autoplay && this.properties.src) {
        // 等待页面切题渲染完成后再播
        setTimeout(() => this.play(1), 300);
      }
    },
  },

  lifetimes: {
    attached() {
      // 短音频高频播放场景，官方建议开启 WebAudio 驱动（性能与兼容更优）
      this.ctx = wx.createInnerAudioContext({ useWebAudioImplement: true });
      this.ctx.onPlay(() => this.setData({ playing: true }));
      this.ctx.onEnded(() => this.setData({ playing: false }));
      this.ctx.onStop(() => this.setData({ playing: false }));
      this.ctx.onError((err) => {
        this.setData({ playing: false });
        this._loadedSrc = ''; // 出错后下次重新加载
        // Mock 占位音频可能无法播放，静默降级并记录埋点（音频播放失败率统计用）
        store.logEvent('audio_error', { src: this.properties.src, questionId: this.properties.questionId, errCode: err && err.errCode, errMsg: err && err.errMsg });
        console.warn('[audio-player] 音频播放失败', this.properties.src, JSON.stringify(err));
      });
      this.setData({ avatarIdx: Math.floor(Math.random() * MASCOT_COUNT) });
      if (this.properties.autoplay && this.properties.src) {
        setTimeout(() => this.play(1), 300);
      }
    },
    detached() {
      if (this.ctx) {
        this.ctx.destroy();
        this.ctx = null;
      }
    },
  },

  methods: {
    /**
     * 播放：src 未变化时直接重播（不重设 src，避免安卓/iOS 解码竞态）；
     * 新音频等 onCanplay 就绪后再 play（规避 errCode 602/504 时序问题）
     */
    play(rate) {
      if (!this.properties.src || !this.ctx) return;
      const src = this.properties.src;
      this.ctx.stop();
      this.ctx.playbackRate = rate;
      if (this._loadedSrc === src) {
        this.ctx.seek(0);
        this.ctx.play();
        return;
      }
      this._loadedSrc = src;
      if (this.ctx.offCanplay) this.ctx.offCanplay();
      this.ctx.onCanplay(() => {
        if (this.ctx && this.ctx.offCanplay) this.ctx.offCanplay();
        if (this.ctx) this.ctx.play();
      });
      this.ctx.src = src;
    },
    onTapAvatar() {
      this.play(1);
    },
    onTapTurtle() {
      this.play(0.6);
    },
  },
});
