/**
 * 本地进度存储（wx.storage）
 * 后续接后端后，这里只作为离线缓存
 */
const KEY_PROGRESS = 'progress'; // { [levelId]: { passed, attempts, bestFirstCorrect, total, firstRun, review } }
const KEY_TOTALS = 'totals'; // { studySeconds, answeredCount }
const KEY_CHECKIN = 'checkin'; // { days, lastDate }
const KEY_WRONG = 'wrongBook'; // [{ questionId, levelId, errorCount, resolved, time }]
const KEY_LOGS = 'answerLogs'; // 单题作答埋点，接后端后批量上报
const KEY_EVENTS = 'events'; // 异常事件埋点（音频播放失败等）
const LOGS_CAP = 1000;
const EVENTS_CAP = 500;

function get(key, def) {
  const v = wx.getStorageSync(key);
  return v === '' || v === undefined || v === null ? def : v;
}

function set(key, val) {
  wx.setStorageSync(key, val);
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

module.exports = {
  init() {
    if (!wx.getStorageSync(KEY_PROGRESS)) set(KEY_PROGRESS, {});
    if (!wx.getStorageSync(KEY_TOTALS)) set(KEY_TOTALS, { studySeconds: 0, answeredCount: 0 });
    if (!wx.getStorageSync(KEY_CHECKIN)) set(KEY_CHECKIN, { days: 0, lastDate: '' });
    if (!wx.getStorageSync(KEY_WRONG)) set(KEY_WRONG, []);
  },

  getProgress() {
    return get(KEY_PROGRESS, {});
  },

  saveLevelResult(levelId, { passed, firstCorrect, finalCorrect, total, seconds }) {
    const progress = get(KEY_PROGRESS, {});
    const old = progress[levelId] || { passed: false, attempts: 0, bestFirstCorrect: 0, total };
    const entry = {
      ...old,
      passed: old.passed || passed,
      attempts: old.attempts + 1,
      bestFirstCorrect: Math.max(old.bestFirstCorrect, firstCorrect),
      total,
    };
    // 首刷 / 复习分开统计
    if (old.attempts === 0) {
      entry.firstRun = { firstCorrect, finalCorrect, total, seconds };
    } else {
      const r = old.review || { runs: 0, sumFirstCorrect: 0, sumFinalCorrect: 0, sumTotal: 0 };
      entry.review = {
        runs: r.runs + 1,
        sumFirstCorrect: r.sumFirstCorrect + firstCorrect,
        sumFinalCorrect: r.sumFinalCorrect + finalCorrect,
        sumTotal: r.sumTotal + total,
      };
    }
    progress[levelId] = entry;
    set(KEY_PROGRESS, progress);
  },

  getTotals() {
    return get(KEY_TOTALS, { studySeconds: 0, answeredCount: 0 });
  },

  addTotals(seconds, answeredCount) {
    const t = get(KEY_TOTALS, { studySeconds: 0, answeredCount: 0 });
    t.studySeconds += seconds;
    t.answeredCount += answeredCount;
    set(KEY_TOTALS, t);
  },

  /** 打卡：当天首次调用天数 +1，返回累计天数 */
  checkin() {
    const c = get(KEY_CHECKIN, { days: 0, lastDate: '' });
    if (c.lastDate !== today()) {
      c.days += 1;
      c.lastDate = today();
      set(KEY_CHECKIN, c);
    }
    return c.days;
  },

  addWrong(questionId, levelId) {
    const list = get(KEY_WRONG, []);
    const item = list.find((w) => w.questionId === questionId);
    if (item) {
      item.errorCount = (item.errorCount || 1) + 1;
      item.resolved = false;
      item.time = Date.now();
    } else {
      list.push({ questionId, levelId, errorCount: 1, resolved: false, time: Date.now() });
    }
    set(KEY_WRONG, list);
  },

  /** 曾答错的题最终做对时，标记已掌握 */
  resolveWrong(questionId) {
    const list = get(KEY_WRONG, []);
    const item = list.find((w) => w.questionId === questionId);
    if (item && !item.resolved) {
      item.resolved = true;
      set(KEY_WRONG, list);
    }
  },

  getWrongBook() {
    return get(KEY_WRONG, []);
  },

  /** 批量追加单题作答埋点（qid/type/correct/option/ms/attempt/ts） */
  appendAnswerLogs(logs) {
    if (!logs || !logs.length) return;
    let list = get(KEY_LOGS, []).concat(logs);
    if (list.length > LOGS_CAP) list = list.slice(list.length - LOGS_CAP);
    set(KEY_LOGS, list);
  },

  getAnswerLogs() {
    return get(KEY_LOGS, []);
  },

  /** 异常事件埋点：audio_error / image_error / record_error 等 */
  logEvent(type, payload) {
    let list = get(KEY_EVENTS, []);
    list.push({ type, payload: payload || {}, ts: Date.now() });
    if (list.length > EVENTS_CAP) list = list.slice(list.length - EVENTS_CAP);
    set(KEY_EVENTS, list);
  },

  /* ===== 账号进度云同步 ===== */

  /** 导出进度快照（用于上传云端账号） */
  snapshot() {
    return {
      progress: get(KEY_PROGRESS, {}),
      totals: get(KEY_TOTALS, { studySeconds: 0, answeredCount: 0 }),
      checkin: get(KEY_CHECKIN, { days: 0, lastDate: '' }),
      wrongBook: get(KEY_WRONG, []),
      ver: 1,
    };
  },

  /** 用云端快照覆盖本机进度（登录恢复） */
  restore(snap) {
    if (!snap) return;
    set(KEY_PROGRESS, snap.progress || {});
    set(KEY_TOTALS, snap.totals || { studySeconds: 0, answeredCount: 0 });
    set(KEY_CHECKIN, snap.checkin || { days: 0, lastDate: '' });
    set(KEY_WRONG, snap.wrongBook || []);
  },

  /** 清空本机学习进度（退出登录后本机归零；埋点与设备号保留） */
  clearProgress() {
    set(KEY_PROGRESS, {});
    set(KEY_TOTALS, { studySeconds: 0, answeredCount: 0 });
    set(KEY_CHECKIN, { days: 0, lastDate: '' });
    set(KEY_WRONG, []);
  },
};
