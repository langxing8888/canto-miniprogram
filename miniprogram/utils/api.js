/**
 * 数据访问层
 * - 远程模式：启动时从后端预取题库/关卡（app.js 调 syncRemote），页面同步读取缓存
 * - 降级策略：服务器不可用时自动回落到本地 Mock 数据，学生端体验不受影响
 * - 上报：关卡结算 + 单题埋点异步上报，失败不阻塞流程
 */
const mockLevels = require('../data/levels');
const mockQuestions = require('../data/questions');
const store = require('./store');

/* 远程配置：正式环境（HTTPS 域名已在微信公众平台配置为 request 合法域名） */
const REMOTE = {
  enabled: true,
  baseUrl: 'https://yy.fla.wang',
};

/* 远程缓存（syncRemote 成功后生效） */
let remote = { levels: null, questions: null };

function request(path, method, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: REMOTE.baseUrl + path,
      method: method || 'GET',
      data,
      timeout: 5000,
      success: (res) => {
        if (res.data && res.data.ok) resolve(res.data.data);
        else reject(new Error((res.data && res.data.error) || 'bad response'));
      },
      fail: (err) => reject(new Error(err.errMsg || 'network error')),
    });
  });
}

/** 设备匿名 ID（用户体系上线前用于区分学生） */
function getDeviceId() {
  let id = wx.getStorageSync('deviceId');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    wx.setStorageSync('deviceId', id);
  }
  return id;
}

/** 启动时预取远程题库（app.onLaunch 调用）；失败静默降级 Mock */
function syncRemote() {
  if (!REMOTE.enabled) return Promise.resolve(false);
  return Promise.all([request('/api/levels'), request('/api/questions')])
    .then(([levels, questions]) => {
      if (Array.isArray(levels) && levels.length && Array.isArray(questions) && questions.length) {
        // 服务器音频为相对路径（/audio/xx.mp3），补全为完整域名
        questions.forEach((q) => {
          if (q.stem && q.stem.audioUrl && q.stem.audioUrl.indexOf('/audio/') === 0) {
            q.stem.audioUrl = REMOTE.baseUrl + q.stem.audioUrl;
          }
        });
        remote = { levels, questions };
        console.log(`[api] 已连接服务器：${levels.length} 关 / ${questions.length} 题`);
        return true;
      }
      return false;
    })
    .catch((e) => {
      console.warn('[api] 服务器不可用，使用本地 Mock 数据：', e.message);
      return false;
    });
}

function levelSource() {
  return remote.levels || mockLevels;
}

function questionSource() {
  return remote.questions || mockQuestions;
}

/** 关卡列表（合并本地进度：解锁/通关状态） */
function getLevels() {
  const progress = store.getProgress();
  const levels = levelSource();
  return levels.map((lv, i) => {
    const p = progress[lv.id] || {};
    const prevPassed = i === 0 || (progress[levels[i - 1].id] || {}).passed;
    return {
      ...lv,
      index: i + 1,
      passed: !!p.passed,
      locked: !prevPassed,
      bestFirstCorrect: p.bestFirstCorrect || 0,
      total: lv.questionIds.length,
    };
  });
}

function getLevelById(levelId) {
  return levelSource().find((lv) => lv.id === levelId) || null;
}

function getQuestionById(questionId) {
  return questionSource().find((q) => q.id === questionId) || null;
}

/** 关卡题目（按关卡配置顺序返回） */
function getLevelQuestions(levelId) {
  const lv = getLevelById(levelId);
  if (!lv) return [];
  return lv.questionIds
    .map((id) => questionSource().find((q) => q.id === id))
    .filter(Boolean);
}

/**
 * 提交关卡结算：本地保存 + 异步上报服务器（结算数据与单题埋点）
 * result: { firstCorrect, finalCorrect, total, seconds, answeredCount, passed }
 */
function submitResult(levelId, result, logs) {
  store.saveLevelResult(levelId, result);
  store.addTotals(result.seconds, result.answeredCount);

  if (REMOTE.enabled) {
    const deviceId = getDeviceId();
    request('/api/results', 'POST', { ...result, levelId, deviceId }).catch(() => {});
    if (logs && logs.length) {
      request('/api/logs', 'POST', { deviceId, logs }).catch(() => {});
    }
    uploadProgress(); // 已登录用户：结算后同步进度到云端账号
  }
  return Promise.resolve({ ok: true });
}

/* 内置课程占位（服务器不可用时降级展示） */
const mockCourses = [
  { id: 'C1', name: '粤语发音入门：九声六调', category: '发音入门', cover: '#58cc02', intro: '从零开始掌握粤拼与声调系统', lessons: 8, duration: '3小时20分', freeTrial: true, status: 'online' },
  { id: 'C2', name: '茶餐厅生存粤语', category: '词汇拓展', cover: '#1cb0f6', intro: '点餐、埋单、搭台全场景对话', lessons: 6, duration: '2小时10分', freeTrial: true, status: 'online' },
];
let remoteCourses = null;

/** 课程列表（远程优先，失败降级内置） */
function getCourses() {
  if (!REMOTE.enabled) return Promise.resolve(mockCourses);
  // 带 token 以便后端判定 owned/locked（付费课访问态）；不缓存，保证购买后即时刷新
  const t = userToken();
  return request('/api/courses' + (t ? '?token=' + encodeURIComponent(t) : ''))
    .then((list) => (list && list.length ? list : mockCourses))
    .catch(() => mockCourses);
}

/** 取课程播放地址（鉴权：免费/会员/已购才返回真实地址） */
function fetchCoursePlay(courseId) {
  return request('/api/course/play?courseId=' + courseId + '&token=' + encodeURIComponent(userToken()));
}

/** 下单：type=course(courseId) / member(plan) */
function createCourseOrder(payload) {
  return request('/api/course/order', 'POST', Object.assign({ token: userToken() }, payload));
}

/** 会员状态 + 定价 */
function fetchMembership() {
  return request('/api/membership?token=' + encodeURIComponent(userToken()));
}

/** 全部口语题（AI 纠音训练场用） */
function getSpeakingQuestions() {
  return questionSource().filter((q) => q.type === 'speaking');
}

/**
 * AI 纠音评分：读录音文件 -> base64 -> 服务器粤语识别逐字比对
 * 返回 { score, hyp, words: [{char, ok}] }
 */
function assessSpeaking(questionId, filePath) {
  return new Promise((resolve, reject) => {
    if (!REMOTE.enabled) return reject(new Error('离线模式暂不支持评分'));
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'base64',
      success: (fileRes) => {
        wx.request({
          url: REMOTE.baseUrl + '/api/speaking/assess',
          method: 'POST',
          data: { questionId, audio: fileRes.data, deviceId: getDeviceId() },
          timeout: 20000, // 识别需要几秒，放宽超时
          success: (res) => {
            if (res.data && res.data.ok) resolve(res.data.data);
            else reject(new Error((res.data && res.data.error) || 'bad response'));
          },
          fail: (err) => reject(new Error(err.errMsg || 'network error')),
        });
      },
      fail: () => reject(new Error('读取录音失败')),
    });
  });
}

/**
 * 微信一键登录：wx.login 凭证 + 手机号凭证（可为空，服务端自动降级微信身份登录）
 */
function wxLogin(phoneCode) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (lr) => {
        if (!lr.code) return reject(new Error('微信登录凭证获取失败'));
        wx.request({
          url: REMOTE.baseUrl + '/api/auth/login',
          method: 'POST',
          data: { loginCode: lr.code, phoneCode: phoneCode || '', deviceId: getDeviceId() },
          timeout: 15000, // 服务端要调两次微信接口，放宽超时
          success: (res) => {
            if (res.data && res.data.ok) resolve(res.data.data);
            else reject(new Error((res.data && res.data.error) || 'bad response'));
          },
          fail: (err) => reject(new Error(err.errMsg || 'network error')),
        });
      },
      fail: () => reject(new Error('wx.login 调用失败')),
    });
  });
}

/* ===== 账号进度云同步 ===== */

/** 上传本机进度快照到云端账号（需已登录）；静默失败不打扰学习 */
function uploadProgress() {
  const token = wx.getStorageSync('userToken');
  if (!token || !REMOTE.enabled) return Promise.resolve(false);
  return request('/api/user/progress', 'POST', { token, progress: store.snapshot() })
    .then(() => true)
    .catch(() => false);
}

/** 拉取云端账号进度快照 */
function fetchProgress() {
  const token = wx.getStorageSync('userToken');
  if (!token || !REMOTE.enabled) return Promise.resolve(null);
  return request('/api/user/progress?token=' + encodeURIComponent(token)).catch(() => null);
}

/* ===== 约课 / 课时包 ===== */

function userToken() {
  return wx.getStorageSync('userToken') || '';
}

/** 未来 3 天可约时段 */
function fetchOpenSlots() {
  return request('/api/schedule/open');
}

/** 学生约课 */
function createBooking(slotId) {
  return request('/api/booking/create', 'POST', { token: userToken(), slotId });
}

/** 取消预约 */
function cancelBooking(id) {
  return request('/api/booking/cancel', 'POST', { token: userToken(), id });
}

/** 我的课程聚合：课时包 + 约课列表（会议号按时间窗下发） */
function fetchMyCourse() {
  return request('/api/my/course?token=' + encodeURIComponent(userToken()));
}

/* ===== 课后作业 ===== */

/** 我的作业列表（含提交/批改状态） */
function fetchHomework() {
  return request('/api/homework/list?token=' + encodeURIComponent(userToken()));
}

/** 上传作业图片（压缩后 base64 -> 服务端转存 COS），返回 url */
function uploadHwImage(filePath) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: filePath,
      quality: 50,
      success: (c) => {
        wx.getFileSystemManager().readFile({
          filePath: c.tempFilePath,
          encoding: 'base64',
          success: (fr) => {
            wx.request({
              url: REMOTE.baseUrl + '/api/homework/upload',
              method: 'POST',
              data: { token: userToken(), dataUrl: 'data:image/jpeg;base64,' + fr.data },
              timeout: 30000,
              success: (res) => {
                if (res.data && res.data.ok) resolve(res.data.data.url);
                else reject(new Error((res.data && res.data.error) || '上传失败'));
              },
              fail: (err) => reject(new Error(err.errMsg || 'network error')),
            });
          },
          fail: () => reject(new Error('读取图片失败')),
        });
      },
      fail: () => reject(new Error('压缩图片失败')),
    });
  });
}

/** 提交作业 */
function submitHomework(hwId, text, images) {
  return request('/api/homework/submit', 'POST', { token: userToken(), hwId, text, images });
}

/** 每日学习打卡上云（当天首次才+1）：返回 {total,streak,lastDate,todayDone} */
function doCheckin() {
  return request('/api/checkin', 'POST', { token: userToken() });
}
/** 读云端打卡状态 */
function fetchCheckin() {
  return request('/api/my/checkin?token=' + encodeURIComponent(userToken()));
}

/** 我的站内通知（作业提醒/批改）：{ unread, list } */
function fetchNotices() {
  return request('/api/my/notices?token=' + encodeURIComponent(userToken()));
}

/** 标记通知已读（{all:1} 全部 / {id} 单条 / {refId} 某作业相关） */
function readNotices(payload) {
  return request('/api/notices/read', 'POST', Object.assign({ token: userToken() }, payload));
}

/** 我的教材（按分类匹配 + 自动解锁状态） */
function fetchMyMaterials() {
  return request('/api/materials/mine?token=' + encodeURIComponent(userToken()));
}

/** 小程序全局配置（双版本开关等） */
function fetchAppConfig() {
  return request('/api/app/config');
}

/* ===== 录播课观看进度 ===== */

/** 上报观看进度（seconds 当前秒 / duration 总秒 / ended 是否看完） */
function reportWatch(courseId, seconds, duration, ended) {
  return request('/api/course/watch', 'POST', {
    token: userToken(), deviceId: getDeviceId(), courseId,
    seconds: Math.floor(seconds || 0), duration: Math.floor(duration || 0), ended: !!ended,
  }).catch(() => {});
}

/** 拉取我的观看进度（{courseId: {seconds,pct,ts}}） */
function fetchWatch() {
  return request('/api/course/watch?token=' + encodeURIComponent(userToken()) + '&deviceId=' + getDeviceId()).catch(() => ({}));
}

/** 录播课分类（后台配置的顶部滑动栏分类） */
function fetchCourseCategories() {
  return request('/api/course/categories').catch(() => []);
}

/** 我的课堂笔记（老师发给我的 + 公开） */
function fetchMyNotes() {
  return request('/api/my/notes?token=' + encodeURIComponent(userToken()));
}

module.exports = { getLevels, getLevelById, getQuestionById, getLevelQuestions, submitResult, syncRemote, getCourses, getSpeakingQuestions, assessSpeaking, wxLogin, uploadProgress, fetchProgress, fetchOpenSlots, createBooking, cancelBooking, fetchMyCourse, fetchHomework, uploadHwImage, submitHomework, fetchMyMaterials, fetchAppConfig, reportWatch, fetchWatch, fetchCourseCategories, fetchMyNotes, fetchCoursePlay, createCourseOrder, fetchMembership, fetchNotices, readNotices, doCheckin, fetchCheckin };
