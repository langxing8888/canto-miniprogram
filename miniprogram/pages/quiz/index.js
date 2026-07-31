const api = require('../../utils/api');
const store = require('../../utils/store');

const MAX_WRONG = 5; // 同题错满 5 次视为完成（跳过）

function fmt(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

Page({
  data: {
    levelName: '',
    current: null, // 当前题目
    doneCount: 0, // 已完成题数（答对/错满5次/口语跳过）
    total: 0,
    timerText: '00:00',
    feedback: { show: false, correct: false, message: '' },
    finished: false,
    // 口语题录音状态
    recording: false,
    recordPath: '',
    playingSelf: false,
    assessing: false, // AI 评分中
    assessResult: null, // { score, hyp, words }
    scoreLevel: '', // good / mid / bad
  },

  onLoad(options) {
    this.levelId = options.levelId;
    const level = api.getLevelById(this.levelId);
    const questions = api.getLevelQuestions(this.levelId);

    // 答题运行时状态（非渲染数据）
    this.level = level;
    this.queue = questions.slice(); // 待答队列，答错的题回到队尾
    this.firstTry = {}; // { qid: true/false/'skipped' }，首次作答结果
    this.wrongCount = {}; // { qid: n }
    this.attemptCount = {}; // { qid: n }，本关内第几次作答
    this.attemptLogs = []; // 单题作答埋点，结算时批量写入
    this.firstCorrect = 0;
    this.finalCorrect = 0;
    this.answeredCount = 0; // 有效作答次数（含重做）
    this.seconds = 0;
    this.qStartTs = Date.now(); // 当前题目展示时刻（平均答题时间统计用）

    this.setData({
      levelName: level ? level.name : '',
      total: questions.length,
      current: this.queue[0] || null,
    });

    this.timer = setInterval(() => {
      this.seconds += 1;
      this.setData({ timerText: fmt(this.seconds) });
    }, 1000);

    this.initRecorder();
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
    if (this.selfCtx) {
      this.selfCtx.destroy();
      this.selfCtx = null;
    }
  },

  /* ============ 答题主流程 ============ */

  onAnswered(e) {
    if (this.data.finished) return;
    const { correct, option } = e.detail;
    const q = this.data.current;
    this.answeredCount += 1;
    this.attemptCount[q.id] = (this.attemptCount[q.id] || 0) + 1;

    // 单题埋点：题目/题型/对错/所选内容/耗时/第几次作答
    this.attemptLogs.push({
      qid: q.id,
      type: q.type,
      levelId: this.levelId,
      correct,
      option: option || '',
      ms: Date.now() - this.qStartTs,
      attempt: this.attemptCount[q.id],
      ts: Date.now(),
    });

    // 首次作答记录
    if (!(q.id in this.firstTry)) {
      this.firstTry[q.id] = correct;
      if (correct) this.firstCorrect += 1;
    }

    if (correct) {
      this.finalCorrect += 1;
      // 曾答错过、这次做对 → 错题本标记已掌握
      if (this.wrongCount[q.id]) store.resolveWrong(q.id);
      this.showFeedback(true, '答对啦，非常好！');
      setTimeout(() => this.next(false), 900);
      return;
    }

    // 答错：记错题本 + 计数
    this.wrongCount[q.id] = (this.wrongCount[q.id] || 0) + 1;
    store.addWrong(q.id, this.levelId);

    if (this.wrongCount[q.id] >= MAX_WRONG) {
      this.showFeedback(false, `已连错${MAX_WRONG}次，本题先跳过`);
      setTimeout(() => this.next(false), 1500);
    } else {
      this.showFeedback(false, '答错了，已加入错题本，本题稍后会再出现');
      setTimeout(() => this.next(true), 1500);
    }
  },

  /** 组句题槽位区整句播放 → 驱动左上角播放器 */
  onReplayAudio() {
    const player = this.selectComponent('#player');
    if (player) player.play(1);
  },

  /**
   * 切换下一题
   * @param requeue 答错未满5次时，把当前题放回队尾
   */
  next(requeue) {
    const cur = this.queue.shift();
    if (requeue) this.queue.push(cur);

    this.setData({
      feedback: { show: false, correct: false, message: '' },
      doneCount: this.data.total - this.uniqueRemaining(),
      recording: false,
      recordPath: '',
      playingSelf: false,
      assessing: false,
      assessResult: null,
      scoreLevel: '',
    });

    if (this.queue.length === 0) {
      this.finish();
      return;
    }
    this.qStartTs = Date.now();
    this.setData({ current: this.queue[0] });
  },

  uniqueRemaining() {
    const ids = {};
    this.queue.forEach((q) => (ids[q.id] = 1));
    return Object.keys(ids).length;
  },

  showFeedback(correct, message) {
    this.setData({ feedback: { show: true, correct, message } });
  },

  finish() {
    this.setData({ finished: true });
    if (this.timer) clearInterval(this.timer);

    const total = this.data.total;
    const passed = this.finalCorrect >= (this.level ? this.level.passThreshold : total);
    const result = {
      firstCorrect: this.firstCorrect,
      finalCorrect: this.finalCorrect,
      total,
      seconds: this.seconds,
      answeredCount: this.answeredCount,
      passed,
    };
    store.appendAnswerLogs(this.attemptLogs);
    api.submitResult(this.levelId, result, this.attemptLogs);

    wx.redirectTo({
      url:
        `/pages/result/index?levelId=${this.levelId}` +
        `&first=${result.firstCorrect}&final=${result.finalCorrect}` +
        `&total=${total}&seconds=${this.seconds}&passed=${passed ? 1 : 0}`,
    });
  },

  /* ============ 口语题：本地录音对比听（简化版纠音） ============ */

  initRecorder() {
    this.recorder = wx.getRecorderManager();
    this.recorder.onStop((res) => {
      if (res.tempFilePath && res.duration > 400) {
        this.setData({ recording: false, recordPath: res.tempFilePath });
        this.doAssess(res.tempFilePath); // 录完自动 AI 评分
      } else {
        this.setData({ recording: false });
        wx.showToast({ title: '录音太短，再试一次', icon: 'none' });
      }
    });
    this.recorder.onError((err) => {
      this.setData({ recording: false });
      store.logEvent('record_error', { err: err.errMsg });
      wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' });
    });
    // 播放自己录音的独立播放器
    this.selfCtx = wx.createInnerAudioContext();
    this.selfCtx.onPlay(() => this.setData({ playingSelf: true }));
    this.selfCtx.onEnded(() => this.setData({ playingSelf: false }));
    this.selfCtx.onStop(() => this.setData({ playingSelf: false }));
    this.selfCtx.onError(() => this.setData({ playingSelf: false }));
  },

  /** 长按开始录音 */
  onRecordStart() {
    if (this.data.recording) return;
    this.setData({ recording: true });
    this.recorder.start({ duration: 30000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
  },

  /** 松开结束录音 */
  onRecordEnd() {
    if (!this.data.recording) return;
    this.recorder.stop();
  },

  /** 听自己的录音 */
  onPlaySelf() {
    if (!this.data.recordPath || !this.selfCtx) return;
    this.selfCtx.stop();
    this.selfCtx.src = this.data.recordPath;
    this.selfCtx.play();
  },

  /** 听标准音 */
  onPlayStandard() {
    this.onReplayAudio();
  },

  /** 再读一次：清空录音重录 */
  onRecordRetry() {
    if (this.selfCtx) this.selfCtx.stop();
    this.setData({ recordPath: '', playingSelf: false, assessing: false, assessResult: null, scoreLevel: '' });
  },

  /** AI 评分（粤语识别 + 逐字比对） */
  doAssess(filePath) {
    const q = this.data.current;
    if (!q) return;
    // 开发者工具录音非标准 mp3，云端无法识别；真机不受影响
    if (wx.getSystemInfoSync().platform === 'devtools') {
      wx.showToast({ title: '开发者工具不支持 AI 评分，请用真机预览体验', icon: 'none', duration: 2500 });
      return;
    }
    this.setData({ assessing: true, assessResult: null });
    api
      .assessSpeaking(q.id, filePath)
      .then((r) => {
        const scoreLevel = r.score >= 80 ? 'good' : r.score >= 60 ? 'mid' : 'bad';
        store.logEvent('speaking_assess', { qid: q.id, score: r.score }); // 成果页练习量统计
        this.setData({ assessing: false, assessResult: r, scoreLevel });
      })
      .catch(() => {
        // 评分失败不拦学生：保留对比听，完成按通过处理
        this.setData({ assessing: false });
        wx.showToast({ title: '评分服务开小差，可先对比听', icon: 'none' });
      });
  },

  /** 完成跟读，进入下一题（有评分按 60 分线判定；无评分降级按完成计对） */
  onSpeakingDone() {
    const r = this.data.assessResult;
    const correct = r ? r.score >= 60 : true;
    this.onAnswered({ detail: { correct, option: r ? 'speaking_' + r.score : 'speaking_done' } });
  },

  /** 口语题：现在不方便口语练习，直接跳过 */
  onSkipSpeaking() {
    const q = this.data.current;
    this.attemptLogs.push({
      qid: q.id,
      type: q.type,
      levelId: this.levelId,
      correct: null,
      option: 'skipped',
      ms: Date.now() - this.qStartTs,
      attempt: 1,
      ts: Date.now(),
    });
    if (!(q.id in this.firstTry)) this.firstTry[q.id] = 'skipped';
    this.showFeedback(true, '已跳过口语练习');
    setTimeout(() => this.next(false), 600);
  },

  /* ============ 顶部操作 ============ */

  onExit() {
    wx.showModal({
      title: '退出关卡',
      content: '本关进度不会保存，确定退出吗？',
      confirmText: '退出',
      confirmColor: '#ff4b4b',
      success: (res) => {
        if (res.confirm) wx.navigateBack();
      },
    });
  },
});
