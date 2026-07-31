const api = require('../../utils/api');
const store = require('../../utils/store');

Page({
  data: {
    list: [], // 口语题列表
    activeId: '', // 当前展开练习的题
    recording: false,
    recordPath: '',
    playingSelf: false,
    assessing: false, // 评分中
    result: null, // { score, hyp, words: [{char, ok}] }
    scoreLevel: '', // good / mid / bad（评分环配色）
  },

  onShow() {
    if (typeof this.getTabBar === 'function') {
      this.getTabBar().setData({ selected: 1 });
    }
    this.setData({ list: api.getSpeakingQuestions() });
  },

  onLoad() {
    this.initRecorder();
  },

  onUnload() {
    if (this.selfCtx) {
      this.selfCtx.destroy();
      this.selfCtx = null;
    }
    if (this.stdCtx) {
      this.stdCtx.destroy();
      this.stdCtx = null;
    }
  },

  initRecorder() {
    this.recorder = wx.getRecorderManager();
    this.recorder.onStop((res) => {
      if (res.tempFilePath && res.duration > 400) {
        this.setData({ recording: false, recordPath: res.tempFilePath });
        this.doAssess(res.tempFilePath); // 录完自动评分
      } else {
        this.setData({ recording: false });
        wx.showToast({ title: '录音太短，再试一次', icon: 'none' });
      }
    });
    this.recorder.onError((err) => {
      this.setData({ recording: false });
      store.logEvent('record_error', { err: err.errMsg, from: 'practice' });
      wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' });
    });
    this.selfCtx = wx.createInnerAudioContext();
    this.selfCtx.onPlay(() => this.setData({ playingSelf: true }));
    this.selfCtx.onEnded(() => this.setData({ playingSelf: false }));
    this.selfCtx.onStop(() => this.setData({ playingSelf: false }));
    this.selfCtx.onError(() => this.setData({ playingSelf: false }));
    this.stdCtx = wx.createInnerAudioContext();
  },

  /** 展开/收起某道口语题 */
  onTapItem(e) {
    const { id } = e.currentTarget.dataset;
    if (this.selfCtx) this.selfCtx.stop();
    this.setData({
      activeId: this.data.activeId === id ? '' : id,
      recordPath: '',
      recording: false,
      playingSelf: false,
      assessing: false,
      result: null,
      scoreLevel: '',
    });
  },

  /** 调用 AI 评分（粤语识别 + 逐字比对） */
  doAssess(filePath) {
    const q = this.data.list.find((x) => x.id === this.data.activeId);
    if (!q) return;
    // 开发者工具录音非标准 mp3，云端无法识别；真机不受影响
    if (wx.getSystemInfoSync().platform === 'devtools') {
      wx.showToast({ title: '开发者工具不支持 AI 评分，请用真机预览体验', icon: 'none', duration: 2500 });
      return;
    }
    this.setData({ assessing: true, result: null });
    api
      .assessSpeaking(q.id, filePath)
      .then((r) => {
        const scoreLevel = r.score >= 80 ? 'good' : r.score >= 60 ? 'mid' : 'bad';
        store.logEvent('speaking_assess', { qid: q.id, score: r.score }); // 成果页练习量统计
        this.setData({ assessing: false, result: r, scoreLevel });
      })
      .catch((e) => {
        this.setData({ assessing: false });
        wx.showToast({ title: e.message || '评分失败，可先对比听', icon: 'none' });
      });
  },

  onRecordStart() {
    if (this.data.recording) return;
    this.setData({ recording: true });
    this.recorder.start({ duration: 30000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
  },

  onRecordEnd() {
    if (!this.data.recording) return;
    this.recorder.stop();
  },

  onPlaySelf() {
    if (!this.data.recordPath) return;
    this.selfCtx.stop();
    this.selfCtx.src = this.data.recordPath;
    this.selfCtx.play();
  },

  onPlayStandard(e) {
    const { url } = e.currentTarget.dataset;
    if (!url) return;
    this.stdCtx.stop();
    this.stdCtx.src = url;
    this.stdCtx.play();
  },

  onRetry() {
    if (this.selfCtx) this.selfCtx.stop();
    this.setData({ recordPath: '', playingSelf: false, result: null, assessing: false, scoreLevel: '' });
  },
});
