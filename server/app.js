/**
 * 粤语学习小程序 · 后端服务（零第三方依赖，Node >= 18 直接运行）
 *
 * 启动：node app.js  （默认端口 3000，可用环境变量 PORT 覆盖）
 *
 * 路由总览
 *  学生端：
 *    GET  /api/health                     健康检查
 *    GET  /api/levels                     关卡列表（仅上线关卡）
 *    GET  /api/questions?levelId=L1       某关题目（已发布题）
 *    GET  /api/questions                  全部已发布题目（小程序启动预取用）
 *    POST /api/results                    上报关卡结算
 *    POST /api/logs                       上报单题作答埋点（批量）
 *  管理端（已加鉴权：POST /api/admin/login 校验 admins.json 账号并签发 token；
 *          其余 /api/admin/* 均需 x-auth-token 会话（checkAuth）+ 角色权限（roleAllowed）校验；
 *          公网上线仍需补充的加固项见 DEPLOY.md）：
 *    GET  /api/admin/questions            题库全量
 *    PUT  /api/admin/questions            按 id 合并保存（不存在则新增）
 *    DELETE /api/admin/questions/:id      删除题目
 *    GET/PUT /api/admin/levels            关卡（PUT 全量覆盖）
 *    DELETE /api/admin/levels/:id
 *    GET/PUT /api/admin/courses           课程（PUT 全量覆盖）
 *    DELETE /api/admin/courses/:id
 *    GET  /api/admin/overview             统计概览（真实上报数据聚合）
 *  静态：
 *    /admin/*                             管理后台页面（public/admin）
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const db = require('./lib/jsondb');
const { synthesizeCantonese, cosPutObject, recognizeCantonese, tcRequest, cosListUsage, cosDeleteObject, cosListPrefix } = require('./lib/tencentcloud');
const { code2Session, getPhoneNumber, sendMpTemplate } = require('./lib/wechat');
const wxpay = require('./lib/wxpay');

/* COS 桶（题图等静态资源）；CDN 域名生效后把 resBase 换成 https://res.fla.wang */
const COS_HOST = 'canto-res-1385268704.cos.ap-guangzhou.myqcloud.com';
function resBase() {
  const cfg = db.load('config');
  return (cfg && cfg.resBase) || `https://${COS_HOST}`;
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

/* ---------- 管理员账号与角色权限 ---------- */
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** 多账号集合（admins.json）；从旧版单账号 admin.json 自动迁移 */
function loadAdmins() {
  let admins = db.load('admins');
  if (!admins || !admins.length) {
    const legacy = db.load('admin') || { username: 'admin', passHash: sha256('canto2026') };
    admins = [{ username: legacy.username, passHash: legacy.passHash, role: 'super', name: '超级管理员', createdAt: Date.now() }];
    db.save('admins', admins);
  }
  return admins;
}
loadAdmins();

/**
 * 角色 -> 模块权限（r 只读 / rw 读写）；super 全模块读写
 * 模块名取自路径 /api/admin/<模块>/...
 */
const ROLE_SCOPES = {
  editor: { questions: 'rw', levels: 'rw', courses: 'rw', tts: 'rw', upload: 'rw', vod: 'rw', material: 'rw', materials: 'r' }, // 内容编辑（含教材）
  teacher: { overview: 'r', students: 'rw', questions: 'r', material: 'rw', materials: 'r', teachers: 'rw', schedule: 'rw', bookings: 'rw', packs: 'rw', homework: 'rw', my: 'r', notes: 'rw', upload: 'rw' }, // 教务（管全体老师排班/学生/作业）
  tutor: { my: 'rw', material: 'rw', materials: 'r', notes: 'rw', upload: 'rw' }, // 授课老师（教师工作台：自己的课表/学生/批注/笔记/自助排课/点名）
  finance: { usage: 'r', packs: 'r', bookings: 'r' }, // 财务审核（用量账单+课时消耗只读）
};
const ROLE_NAMES = { super: '超级管理员', editor: '内容编辑', teacher: '教务', tutor: '授课老师', finance: '财务审核' };

function roleAllowed(role, p, method) {
  if (role === 'super') return true;
  if (p === '/api/admin/password') return true; // 任何人可改自己密码
  if (p === '/api/admin/imgproxy') return true; // 图片代理（批改画布用，只读且限自有域名）
  const seg = p.replace('/api/admin/', '').split('/')[0];
  const scope = (ROLE_SCOPES[role] || {})[seg];
  if (!scope) return false;
  return scope === 'rw' || method === 'GET';
}

const sessions = new Map(); // token -> { exp, username, role, name }（内存会话，重启失效需重登）
const SESSION_TTL = 12 * 3600 * 1000; // 12 小时

function issueToken(account) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { exp: Date.now() + SESSION_TTL, username: account.username, role: account.role, name: account.name, teacherId: account.teacherId || '' });
  return token;
}

function checkAuth(req) {
  const token = req.headers['x-auth-token'] || '';
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() > s.exp) {
    sessions.delete(token);
    return null;
  }
  s.exp = Date.now() + SESSION_TTL; // 滑动续期
  return s;
}

/* ---------- TTS 粤语合成：文本 -> mp3 落盘 public/audio/ ---------- */
const AUDIO_DIR = path.join(PUBLIC_DIR, 'audio');
if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

/** 可约时间窗（天）：老师排课滚动生成 + 学生可约上限，均以此为准。
 *  可由教务在后台「约课设置」调整（adminconfig.bookAheadDays），默认 7 天，范围 1~90。 */
const DEFAULT_BOOK_AHEAD_DAYS = 7;
function bookAheadDays() {
  const bc = db.load('adminconfig', {});
  const n = parseInt(bc.bookAheadDays, 10);
  return (n >= 1 && n <= 90) ? n : DEFAULT_BOOK_AHEAD_DAYS;
}

/** 题目的可朗读文本：题干文字 > 词块拼句 */
function speakableText(q) {
  if (q.stem && q.stem.text) return q.stem.text;
  if (q.tokens && q.tokens.length) return q.tokens.map((t) => t.text).join('');
  return '';
}

async function ttsForQuestion(q) {
  const sec = db.load('secrets');
  if (!sec || !sec.tencent) throw new Error('服务器未配置云 API 密钥');
  const text = speakableText(q);
  if (!text) throw new Error('该题无可朗读文本');
  const mp3 = await synthesizeCantonese(sec.tencent.secretId, sec.tencent.secretKey, text, sec.tencent.region);
  const file = `${q.id}.mp3`;
  fs.writeFileSync(path.join(AUDIO_DIR, file), mp3);
  db.append('logs', [{ event: 'tts_call', questionId: q.id, chars: text.length, ts: Date.now() }], 500000); // TTS 字符记账
  return `/audio/${file}`;
}

/* ---------- AI 纠音：粤语识别 + 逐字比对评分 ---------- */
/** LCS 对齐：目标句 vs 识别结果，逐字标记对错 */
function assessByCompare(refRaw, hypRaw) {
  const clean = (s) => (s || '').replace(/[^\u4e00-\u9fff]/g, '');
  const ref = clean(refRaw);
  const hyp = clean(hypRaw);
  if (!ref) return null;
  const m = ref.length;
  const n = hyp.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = ref[i - 1] === hyp[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const ok = new Array(m).fill(false);
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (ref[i - 1] === hyp[j - 1]) {
      ok[i - 1] = true;
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i -= 1;
    else j -= 1;
  }
  const matched = ok.filter(Boolean).length;
  const score = Math.round((matched / m) * 100);
  return { score, hyp, words: ref.split('').map((c, idx) => ({ char: c, ok: ok[idx] })) };
}

/* ---------- 云点播 VOD 客户端上传签名 ---------- */
function vodUploadSignature() {
  const sec = db.load('secrets');
  if (!sec || !sec.tencent) return null;
  const { secretId, secretKey } = sec.tencent;
  const current = Math.floor(Date.now() / 1000);
  const original =
    `secretId=${secretId}&currentTimeStamp=${current}` +
    `&expireTime=${current + 3600}&random=${Math.round(Math.random() * 2 ** 31)}`;
  const hash = crypto.createHmac('sha1', secretKey).update(Buffer.from(original, 'utf8')).digest();
  return Buffer.concat([hash, Buffer.from(original, 'utf8')]).toString('base64');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
};

/* ---------- 工具 ---------- */

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
  });
  res.end(body);
}

function readBody(req) {
  if (req._cachedBody !== undefined) return Promise.resolve(req._cachedBody); // 审计预读后 handler 复用
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 10 * 1024 * 1024) req.destroy(); // 10MB 上限
    });
    req.on('end', () => {
      try {
        req._cachedBody = raw ? JSON.parse(raw) : {};
        resolve(req._cachedBody);
      } catch (e) {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

/** 审计详情摘要：提取业务关键字段，跳过大字段与敏感字段 */
const AUDIT_SKIP_KEYS = new Set(['password', 'newPassword', 'oldPassword', 'dataUrl', 'images', 'markImages', 'audio', 's', 'progress', 'items', 'data', 'token']);

function auditDetail(body) {
  if (!body || typeof body !== 'object') return '';
  const parts = [];
  Object.keys(body).forEach((k) => {
    if (AUDIT_SKIP_KEYS.has(k)) return;
    const v = body[k];
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) parts.push(`${k}=${v.slice(0, 5).join(',').slice(0, 40)}`);
    else if (typeof v === 'object') parts.push(`${k}={…}`);
    else parts.push(`${k}=${String(v).slice(0, 40)}`);
  });
  return parts.join('  ').slice(0, 240);
}

function execFileP(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000 }, (e, so, se) => (e ? reject(new Error(se || e.message)) : resolve(so)));
  });
}

/* ==================== 数据备份 ==================== */
// 备份目录放在 server 上级（/www/canto/backups），部署时 rm server 不会误删历史备份；本地开发回退到 server/backups
const BACKUP_DIR = fs.existsSync(path.dirname(__dirname)) && path.basename(path.dirname(__dirname)) === 'canto'
  ? path.join(path.dirname(__dirname), 'backups')
  : path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
const BACKUP_KEEP = 14; // 本地保留最近 14 份
const COS_BACKUP_KEEP_DAYS = 60; // COS 异地备份保留天数（到期自动删）

/** 备份加密密钥（32字节）：优先用 secrets.backupKey，否则由云密钥派生，保证稳定可复现。
 * 该密钥只存在于服务器 secrets 与管理员手中；攻击者即便下载到 COS 密文包也无法解密。 */
function backupCipherKey() {
  const sec = db.load('secrets') || {};
  const material = sec.backupKey || (sec.tencent && sec.tencent.secretKey) || 'canto-fallback-key';
  return crypto.createHash('sha256').update('canto-backup::' + material).digest(); // 32 bytes
}

/** AES-256-CBC 加密（随机 IV 前置到密文头部 16 字节） */
function encryptBuffer(buf) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', backupCipherKey(), iv);
  return Buffer.concat([iv, cipher.update(buf), cipher.final()]);
}

/** 执行一次备份：打包 data + public/materials + public/audio 为 tar.gz，含清理旧包 + 加密上传 COS 异地 */
async function runBackup(trigger) {
  const now = new Date(Date.now() + 8 * 3600000);
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
  const name = `canto-${stamp}.tar.gz`;
  const dest = path.join(BACKUP_DIR, name);
  // 一条 tar 多 -C：data 相对 __dirname，materials/audio 相对 PUBLIC_DIR，均只存相对路径不含绝对路径
  const args = ['-czf', dest, '-C', __dirname, 'data', '-C', PUBLIC_DIR];
  if (fs.existsSync(path.join(PUBLIC_DIR, 'materials'))) args.push('materials');
  if (fs.existsSync(path.join(PUBLIC_DIR, 'audio'))) args.push('audio');
  await execFileP('tar', args);
  const size = fs.statSync(dest).size;
  cleanOldBackups(); // 清理本地超出保留数的旧包（本地在 data 目录外网访问不到，明文安全）
  // 异地：加密后上传 COS（即便备份桶公共读、文件被下载，也是无法解密的密文）
  // 对象名加随机后缀，杜绝按"canto-日期"预测下载
  let cosOk = false;
  try {
    const sec = db.load('secrets');
    if (sec && sec.tencent) {
      const rand = crypto.randomBytes(6).toString('hex');
      const encKey = `/backups/canto-${stamp}-${rand}.tar.gz.enc`;
      const encBuf = encryptBuffer(fs.readFileSync(dest));
      await cosPutObject(sec.tencent.secretId, sec.tencent.secretKey, COS_HOST, encKey, encBuf, 'application/octet-stream');
      cosOk = true;
      cleanCosBackups(sec.tencent).catch(() => {}); // 异步清理 COS 过期备份，不阻塞
    }
  } catch (e) { /* COS 上传失败，本地仍有备份 */ }
  db.append('backupLogs', [{ name, size, trigger: trigger || 'manual', cos: cosOk, ts: Date.now() }], 1000);
  return { name, size, cos: cosOk };
}

/** 清理 COS 上超过保留天数的备份（兼容旧明文包 backups/canto-*.tar.gz 与新密文包 *.tar.gz.enc） */
async function cleanCosBackups(tc) {
  const list = await cosListPrefix(tc.secretId, tc.secretKey, COS_HOST, 'backups/');
  const cutoff = Date.now() - COS_BACKUP_KEEP_DAYS * 86400000;
  for (const o of list) {
    if (new Date(o.lastModified).getTime() < cutoff) {
      try { await cosDeleteObject(tc.secretId, tc.secretKey, COS_HOST, '/' + o.key); } catch (e) { /* 单个失败跳过 */ }
    }
  }
}

/** 清理：仅保留最近 BACKUP_KEEP 份 canto-*.tar.gz */
function cleanOldBackups() {
  try {
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^canto-.*\.tar\.gz$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(BACKUP_KEEP).forEach((x) => { try { fs.unlinkSync(path.join(BACKUP_DIR, x.f)); } catch (e) {} });
  } catch (e) { /* noop */ }
}

/** 读取备份目录状态：列表 + 汇总 */
function backupStatus() {
  let list = [];
  try {
    list = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^canto-.*\.tar\.gz$/.test(f))
      .map((f) => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, ts: st.mtimeMs };
      })
      .sort((a, b) => b.ts - a.ts);
  } catch (e) { /* noop */ }
  const totalSize = list.reduce((s, x) => s + x.size, 0);
  return { count: list.length, totalSize, latest: list[0] || null, keep: BACKUP_KEEP, list: list.slice(0, 30) };
}

/** 每日自动备份（03:00 档执行一次） */
let lastBackupDate = '';
async function dailyBackup() {
  const now = new Date(Date.now() + 8 * 3600000);
  const dateStr = now.toISOString().slice(0, 10);
  if (now.getUTCHours() !== 19 || lastBackupDate === dateStr) return; // UTC19 = 北京03:00
  lastBackupDate = dateStr;
  try { await runBackup('auto'); } catch (e) { db.append('backupLogs', [{ name: '', size: 0, trigger: 'auto', error: String(e.message || e).slice(0, 120), ts: Date.now() }], 1000); }
}
setInterval(dailyBackup, 20 * 60 * 1000);

/* ==================== 节假日服务（联网中国日历，缓存兜底） ==================== */
let holidayCache = null; // { year -> { 'YYYY-MM-DD': isOffDay } }
function loadHolidayCache() {
  if (holidayCache) return holidayCache;
  holidayCache = db.load('holidays', {}) || {};
  return holidayCache;
}
/** 拉取某年节假日数据（holiday-cn，jsDelivr CDN），写入缓存+落盘；失败静默 */
function fetchHolidayYear(year) {
  return new Promise((resolve) => {
    const url = `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`;
    const req = https.get(url, { timeout: 8000 }, (r) => {
      let raw = '';
      r.on('data', (c) => (raw += c));
      r.on('end', () => {
        try {
          const d = JSON.parse(raw);
          const map = {};
          (d.days || []).forEach((x) => { map[x.date] = !!x.isOffDay; }); // true=放假 false=调休上班
          const cache = loadHolidayCache();
          cache[year] = map;
          holidayCache = cache;
          db.save('holidays', cache);
          resolve(map);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}
/** 判断某天是否法定假（放假）；调休上班日返回 false；无数据降级 false（不跳过，宁多排勿漏） */
function isHoliday(dateStr) {
  const year = dateStr.slice(0, 4);
  const cache = loadHolidayCache();
  if (cache[year] && Object.prototype.hasOwnProperty.call(cache[year], dateStr)) return cache[year][dateStr] === true;
  return false;
}
/** 每天拉一次当年+次年节假日 */
let lastHolidayFetch = '';
async function dailyHolidaySync() {
  const now = new Date(Date.now() + 8 * 3600000);
  const dateStr = now.toISOString().slice(0, 10);
  if (lastHolidayFetch === dateStr) return;
  lastHolidayFetch = dateStr;
  const y = now.getUTCFullYear();
  await fetchHolidayYear(y);
  await fetchHolidayYear(y + 1);
}
setInterval(dailyHolidaySync, 6 * 3600 * 1000);
dailyHolidaySync(); // 启动即拉一次

/* ==================== 排课规则滚动展开（老师自助排课的核心） ==================== */
const dow = (dateStr) => new Date(`${dateStr}T00:00:00+08:00`).getDay(); // 0=周日
function ymd(ts) { return new Date(ts + 8 * 3600000).toISOString().slice(0, 10); }

/** 落在休息时段内则 true（该老师该日该时段被屏蔽） */
function inRest(teacherId, date, start, end) {
  return db.load('teacherRest', []).some((r) =>
    r.teacherId === teacherId && r.date === date &&
    start < r.end && end > r.start);
}

/** 把一条规则展开为未来 N 天内应生成的时段，写入 schedule（幂等去重、跳冲突、跳休息、跳节假日） */
function expandRule(rule, schedule, daysAhead) {
  if (rule.status === 'off') return 0;
  const now = Date.now();
  let added = 0;
  for (let i = 0; i <= daysAhead; i++) {
    const date = ymd(now + i * 86400000);
    if (rule.startDate && date < rule.startDate) continue;
    if (rule.endType === 'date' && rule.endDate && date > rule.endDate) continue;
    // free 模式只在指定单日生成；rule 模式按 weekdays 匹配
    if (rule.mode === 'free') { if (date !== rule.date) continue; }
    else if (!(rule.weekdays || []).includes(dow(date))) continue;
    // 节假日：默认跳过；skipHoliday=false 则照排
    if (rule.skipHoliday !== false && isHoliday(date)) continue;
    if (inRest(rule.teacherId, date, rule.start, rule.end)) continue;
    if (slotTs(date, rule.start) <= now) continue; // 不生成过去
    // 幂等：同老师+同日+同起始已存在则跳过
    if (schedule.some((s) => s.teacherId === rule.teacherId && s.date === date && s.start === rule.start)) continue;
    if (teacherConflict(rule.teacherId, date, rule.start, rule.end)) continue;
    schedule.push({ id: 'sl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), teacherId: rule.teacherId, date, start: rule.start, end: rule.end, status: 'open', fromRule: rule.id });
    added += 1;
    if (rule.endType === 'count') {
      rule.generated = (rule.generated || 0) + 1;
      if (rule.generated >= (rule.count || 0)) { rule.status = 'off'; break; }
    }
  }
  return added;
}

/** 每日滚动：把所有 on 规则展开未来 N 天（与学生可约窗一致） */
let lastRollDate = '';
function rollGenerate(force) {
  const now = new Date(Date.now() + 8 * 3600000);
  const dateStr = now.toISOString().slice(0, 10);
  if (!force && lastRollDate === dateStr) return;
  lastRollDate = dateStr;
  try {
    const rules = db.load('scheduleRules', []);
    const schedule = db.load('schedule', []);
    let total = 0;
    rules.forEach((r) => { try { total += expandRule(r, schedule, bookAheadDays()); } catch (e) { /* 单规则失败不影响其他 */ } });
    if (total > 0 || rules.some((r) => r.status === 'off')) { db.save('scheduleRules', rules); db.save('schedule', schedule); }
  } catch (e) { /* noop */ }
}
setInterval(() => rollGenerate(false), 30 * 60 * 1000);
setTimeout(() => rollGenerate(true), 3000); // 启动后补一次


/**
 * 教材批注指令流（append-only：笔画/撤销/清空统一按 seq 增量同步）
 * 频道化：chan = 教材id（公共讲解，全体学生可见） 或 教材id__uid（某学生专属 1对1 批注）
 */
function annoChan(matId, uid) {
  return uid ? String(matId) + '__' + String(uid) : String(matId);
}
function annoKey(chan) {
  return 'anno_' + String(chan).replace(/[^a-z0-9]/gi, '');
}

/** 长轮询等待者：chan -> [{res, since, timer}]；新笔画写入时立即唤醒，延迟降到网络往返级 */
const annoWaiters = new Map();

/** 实时进行中的笔画：chan -> {page,pts,c,w,mode,rev}；老师书写中增量推送，学生端秒级预览，不落盘不占 seq */
const annoLive = new Map();

/** AI 评分每日限流计数（deviceId:date -> count） */
const assessQuota = new Map();

function annoNotify(chan) {
  const list = annoWaiters.get(chan) || [];
  annoWaiters.set(chan, []);
  const anno = db.load(annoKey(chan), { seq: 0, items: [] });
  const live = annoLive.get(annoKey(chan)) || null;
  list.forEach((w) => {
    clearTimeout(w.timer);
    try {
      sendJson(w.res, 200, { ok: true, data: { seq: anno.seq, items: anno.items.filter((it) => it.seq > w.since), live } });
    } catch (e) { /* 客户端已断开 */ }
  });
}

/** 静态文件（含目录穿越防护） */
function serveStatic(req, res, urlPath) {
  let p = decodeURIComponent(urlPath);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' };
    // 后台/批注页的 html/js/css 全部禁用启发式缓存，改版立即生效（曾两次因缓存旧版排查半天）
    if (['.html', '.js', '.css'].includes(path.extname(file))) headers['Cache-Control'] = 'no-cache';
    res.writeHead(200, headers);
    res.end(data);
  });
}

/* ---------- 学生端 API ---------- */

function studentLevels() {
  return db
    .load('levels', [])
    .filter((lv) => lv.status !== 'draft')
    .map((lv) => ({
      id: lv.id,
      name: lv.name,
      desc: lv.desc,
      questionIds: lv.questionIds,
      passThreshold: lv.passThreshold,
    }));
}

function studentQuestions(levelId) {
  const questions = db.load('questions', []).filter((q) => q.status !== 'draft');
  if (!levelId) return questions;
  const lv = db.load('levels', []).find((l) => l.id === levelId);
  if (!lv) return [];
  return lv.questionIds.map((id) => questions.find((q) => q.id === id)).filter(Boolean);
}

/* ---------- 管理端统计 ---------- */

function adminOverview() {
  const results = db.load('results', []);
  const logs = db.load('logs', []);
  const questions = db.load('questions', []);
  const devices = new Set(results.map((r) => r.deviceId));
  const totalAnswered = logs.length;
  const correct = logs.filter((l) => l.correct === true).length;
  const firstTries = logs.filter((l) => l.attempt === 1 && l.correct !== null);
  const firstCorrect = firstTries.filter((l) => l.correct === true).length;

  // 每题聚合（真实作答数据）
  const perQuestion = {};
  logs.forEach((l) => {
    const s = (perQuestion[l.qid] = perQuestion[l.qid] || { attempts: 0, correct: 0, first: 0, firstCorrect: 0, skip: 0, ms: 0 });
    s.attempts += 1;
    if (l.correct === true) s.correct += 1;
    if (l.correct === null) s.skip += 1;
    if (l.attempt === 1) {
      s.first += 1;
      if (l.correct === true) s.firstCorrect += 1;
    }
    s.ms += l.ms || 0;
  });

  return {
    students: devices.size,
    levelRuns: results.length,
    passedRuns: results.filter((r) => r.passed).length,
    totalAnswered,
    accuracy: totalAnswered ? Math.round((correct / totalAnswered) * 100) : 0,
    firstAccuracy: firstTries.length ? Math.round((firstCorrect / firstTries.length) * 100) : 0,
    questionCount: questions.length,
    perQuestion,
    dashboard: buildDashboard(),
  };
}

/** 数据大屏真实统计（替代演示 MOCK；无数据时自然为 0，随真实运营自增长） */
function buildDashboard() {
  const now = Date.now();
  const users = db.load('users', []);
  const results = db.load('results', []);
  const logs = db.load('logs', []);
  const packs = db.load('packs', []);
  const beijingDay = (ts) => new Date((ts || 0) + 8 * 3600000).toISOString().slice(0, 10);
  const today = beijingDay(now);
  const dAgo = (n) => now - n * 86400000;

  // 学生：注册用户为准；活跃看 lastActive/progressAt/近端作答
  const total = users.length;
  const newToday = users.filter((u) => beijingDay(u.createdAt) === today).length;
  const new7d = users.filter((u) => (u.createdAt || 0) >= dAgo(7)).length;
  const paidUids = new Set(packs.filter((p) => (p.total || 0) > 0).map((p) => p.uid));
  const paid = [...paidUids].filter((uid) => users.some((u) => u.uid === uid)).length;
  const free = Math.max(0, total - paid);
  const actTs = (u) => Math.max(u.lastActive || 0, u.progressAt || 0, u.createdAt || 0);
  const activeToday = users.filter((u) => beijingDay(actTs(u)) === today).length;
  const active7d = users.filter((u) => actTs(u) >= dAgo(7)).length;
  const active30d = users.filter((u) => actTs(u) >= dAgo(30)).length;
  const finishedToday = results.filter((r) => beijingDay(r.ts) === today && r.passed).length;

  // 正确率
  const acc = (arr) => { const t = arr.length, c = arr.filter((l) => l.correct === true).length; return t ? Math.round((c / t) * 100) : 0; };
  const logs7 = logs.filter((l) => (l.ts || 0) >= dAgo(7));
  const logsToday = logs.filter((l) => beijingDay(l.ts) === today);
  const firstAll = logs.filter((l) => l.attempt === 1 && l.correct !== null);

  // 留存：注册满 N 天的用户中，之后仍活跃的比例（简化）
  const retention = (n) => {
    const cohort = users.filter((u) => (u.createdAt || 0) <= dAgo(n));
    if (!cohort.length) return 0;
    const back = cohort.filter((u) => actTs(u) >= (u.createdAt || 0) + n * 86400000);
    return Math.round((back.length / cohort.length) * 100);
  };

  // 近7日趋势
  const accTrend = [], actTrend = [];
  for (let i = 6; i >= 0; i--) {
    const day = beijingDay(dAgo(i));
    accTrend.push(acc(logs.filter((l) => beijingDay(l.ts) === day)));
    actTrend.push(users.filter((u) => beijingDay(actTs(u)) === day).length);
  }

  // 学习行为
  const secToday = results.filter((r) => beijingDay(r.ts) === today).reduce((s, r) => s + (r.seconds || 0), 0);
  const sec7 = results.filter((r) => (r.ts || 0) >= dAgo(7)).reduce((s, r) => s + (r.seconds || 0), 0);
  const round1 = (x) => Math.round(x * 10) / 10;

  // 学习打卡统计（上云后真实可算）：今日打卡人数 + 连续天数分布 + 均值
  const todayStr2 = beijingDay(now);
  const withCk = users.filter((u) => u.checkin && u.checkin.total > 0);
  const streakOf = (u) => {
    const c = u.checkin || {}; const yst = beijingDay(now - 86400000);
    return (c.lastDate === todayStr2 || c.lastDate === yst) ? (c.streak || 0) : 0;
  };
  const checkinToday = users.filter((u) => u.checkin && u.checkin.lastDate === todayStr2).length;
  const streak3 = withCk.filter((u) => streakOf(u) >= 3).length;
  const streak7 = withCk.filter((u) => streakOf(u) >= 7).length;
  const streak20 = withCk.filter((u) => streakOf(u) >= 20).length;
  const avgStreak = withCk.length ? round1(withCk.reduce((s, u) => s + streakOf(u), 0) / withCk.length) : 0;

  return {
    students: { total, newToday, new7d, paid, free, vipExpiring: 0, activeToday, active7d, active30d, finishedToday },
    retention: { d3: retention(3), d7: retention(7), d30: retention(30) },
    accuracy: { today: acc(logsToday), d7: acc(logs7), d30: acc(logs.filter((l) => (l.ts || 0) >= dAgo(30))), first: firstAll.length ? Math.round((firstAll.filter((l) => l.correct === true).length / firstAll.length) * 100) : 0 },
    behavior: {
      avgMinutesToday: activeToday ? round1(secToday / 60 / activeToday) : 0,
      avgMinutes7d: active7d ? round1(sec7 / 60 / active7d) : 0,
      avgDaysPerWeek: 0, avgQuestionsToday: activeToday ? Math.round(logsToday.length / activeToday) : 0,
      avgQuestions7d: 0, checkinToday, avgStreak, streak3, streak7, streak20, streakBroken: 0,
    },
    levelFunnel: {
      started: results.length,
      finished: results.filter((r) => r.passed).length,
      finishRate: results.length ? Math.round((results.filter((r) => r.passed).length / results.length) * 100) : 0,
      firstPassRate: 0, avgTries: 0, avgMinutes: 0, quitRate: 0,
    },
    alerts: { churnRisk: 0, churnRules: [], churnList: [], highActive: 0, highRules: [], highList: [] },
    accuracy7dTrend: accTrend,
    active7dTrend: actTrend,
  };
}

/* ---------- 约课/课时包 业务函数 ---------- */

/** 学生有效课时包（未过期且有余量，按到期时间升序优先消耗） */
function activePacks(uid) {
  const now = Date.now();
  return db
    .load('packs', [])
    .filter((p) => p.uid === uid && p.used < p.total && (!p.expireAt || p.expireAt > now))
    .sort((a, b) => (a.expireAt || Infinity) - (b.expireAt || Infinity));
}

function packSummary(uid) {
  const all = db.load('packs', []).filter((p) => p.uid === uid);
  const now = Date.now();
  const valid = all.filter((p) => !p.expireAt || p.expireAt > now);
  const total = valid.reduce((s, p) => s + p.total, 0);
  const used = valid.reduce((s, p) => s + p.used, 0);
  const expires = valid.filter((p) => p.expireAt).map((p) => p.expireAt);
  return { total, used, remain: total - used, expireAt: expires.length ? Math.min(...expires) : 0 };
}

/** 消课一节（返回 false=无可用课时）；packLogs 记流水 */
function consumeLesson(uid, note, by) {
  const packs = db.load('packs', []);
  const target = activePacks(uid)[0];
  if (!target) return false;
  const p = packs.find((x) => x.id === target.id);
  p.used += 1;
  db.save('packs', packs);
  db.append('packLogs', [{ uid, packId: p.id, type: 'consume', n: 1, note: note || '', by: by || 'system', ts: Date.now() }], 200000);
  return true;
}

/** 退还一节课时（取消已消课的场景/冲正） */
function refundLesson(uid, note, by) {
  const packs = db.load('packs', []);
  const p = packs.filter((x) => x.uid === uid && x.used > 0).sort((a, b) => (b.expireAt || Infinity) - (a.expireAt || Infinity))[0];
  if (!p) return false;
  p.used -= 1;
  db.save('packs', packs);
  db.append('packLogs', [{ uid, packId: p.id, type: 'refund', n: 1, note: note || '', by: by || 'system', ts: Date.now() }], 200000);
  return true;
}

/* ---------- 每日学习打卡（上云：跨设备不丢 + 可考核 + 进数据大屏） ---------- */

const beijingDateStr = (ts) => new Date((ts || Date.now()) + 8 * 3600000).toISOString().slice(0, 10);

/** 记一次打卡：当天首次才 +1；连续天数按"昨天是否打过"累计。返回 {total, streak, lastDate, todayDone} */
function doCheckin(uid) {
  const users = db.load('users', []);
  const u = users.find((x) => x.uid === uid);
  if (!u) return null;
  const today = beijingDateStr();
  const c = u.checkin || { total: 0, streak: 0, lastDate: '' };
  if (c.lastDate === today) return { total: c.total, streak: c.streak, lastDate: c.lastDate, todayDone: true };
  const yest = beijingDateStr(Date.now() - 86400000);
  c.streak = (c.lastDate === yest) ? (c.streak || 0) + 1 : 1; // 昨天打过则连续+1，否则重置为1
  c.total = (c.total || 0) + 1;
  c.lastDate = today;
  u.checkin = c;
  db.save('users', users);
  return { total: c.total, streak: c.streak, lastDate: c.lastDate, todayDone: true };
}

/** 读打卡状态（不产生打卡） */
function checkinStatus(uid) {
  const u = db.load('users', []).find((x) => x.uid === uid);
  const c = (u && u.checkin) || { total: 0, streak: 0, lastDate: '' };
  const today = beijingDateStr();
  // 连续天数：若 lastDate 既不是今天也不是昨天，说明已断，展示为 0（数据不改，仅展示）
  const yest = beijingDateStr(Date.now() - 86400000);
  const streak = (c.lastDate === today || c.lastDate === yest) ? (c.streak || 0) : 0;
  return { total: c.total || 0, streak, lastDate: c.lastDate || '', todayDone: c.lastDate === today };
}

/* ---------- 录播课付费：会员 + 单课买断（订单/权益判定） ---------- */

/** 该用户是否为有效会员（会员期内可看全部付费课） */
function isActiveMember(uid) {
  if (!uid) return false;
  const u = db.load('users', []).find((x) => x.uid === uid);
  return !!(u && u.memberExpireAt && u.memberExpireAt > Date.now());
}

/** 该用户是否已单独购买某课程（有一笔已支付的 course 订单） */
function hasPurchasedCourse(uid, courseId) {
  if (!uid) return false;
  return db.load('orders', []).some((o) => o.uid === uid && o.type === 'course' && o.courseId === courseId && o.status === 'paid');
}

/** 是否有权观看某课程：免费课 / 有效会员 / 已买断，任一即可 */
function hasCourseAccess(uid, course) {
  if (!course) return false;
  if (!course.price || course.price <= 0) return true; // 免费课
  return isActiveMember(uid) || hasPurchasedCourse(uid, course.id);
}

/** 会员定价配置（分）：默认月卡 3900 分、年卡 29900 分；可后台改 adminconfig.membership */
function membershipConfig() {
  const bc = db.load('adminconfig', {});
  const m = bc.membership || {};
  return {
    enabled: m.enabled !== false,
    monthFen: parseInt(m.monthFen, 10) >= 0 ? parseInt(m.monthFen, 10) : 3900,
    yearFen: parseInt(m.yearFen, 10) >= 0 ? parseInt(m.yearFen, 10) : 29900,
  };
}

/** 订单支付成功后发放权益（幂等：已 paid 的订单重复回调不再重复发放） */
function fulfillOrder(order) {
  if (order.status === 'paid') return; // 幂等
  order.status = 'paid';
  order.paidAt = Date.now();
  if (order.type === 'member') {
    const users = db.load('users', []);
    const u = users.find((x) => x.uid === order.uid);
    if (u) {
      const base = (u.memberExpireAt && u.memberExpireAt > Date.now()) ? u.memberExpireAt : Date.now();
      u.memberExpireAt = base + (order.months || 1) * 30 * 86400000;
      db.save('users', users);
    }
  }
  // course 类型无需额外发放：hasPurchasedCourse 直接按已支付订单判定
  db.append('orderLogs', [{ orderId: order.id, uid: order.uid, type: order.type, amountFen: order.amountFen, event: 'paid', ts: Date.now() }], 200000);
}


/** 时间字符串工具：'2026-07-30'+'19:00' -> 时间戳 */
function slotTs(date, hm) {
  return new Date(`${date}T${hm}:00+08:00`).getTime();
}

/** 自动结课：课程结束后将 booked -> done 并消课（每 5 分钟扫一次） */
function autoFinishBookings() {
  const now = Date.now();
  const bookings = db.load('bookings', []);
  const rules = db.load('scheduleRules', []);
  const schedule = db.load('schedule', []);
  let changed = false;
  bookings.forEach((b) => {
    // 课程结束：booked -> done，但不自动消课，置 attend='none' 待老师点名
    if (b.status === 'booked' && slotTs(b.date, b.end) < now) {
      b.status = 'done';
      b.doneAt = now;
      b.attend = 'none'; // 待点名
      changed = true;
    }
    // 兜底：done 且待点名超 2 小时，若该课来源规则开了 autoSign，则自动按签到消课
    if (b.status === 'done' && b.attend === 'none' && !b.deducted && slotTs(b.date, b.end) < now - 2 * 3600000) {
      const sl = schedule.find((s) => s.id === b.slotId);
      const rule = sl && sl.fromRule ? rules.find((r) => r.id === sl.fromRule) : null;
      if (rule && rule.autoSign) {
        b.attend = 'present';
        b.attendAt = now;
        b.deducted = true;
        b.consumed = consumeLesson(b.uid, `1对1课程 ${b.date} ${b.start} ${b.teacherName || ''}（自动签到）`, 'auto');
        changed = true;
      }
    }
  });
  if (changed) db.save('bookings', bookings);
}
setInterval(autoFinishBookings, 5 * 60 * 1000);

/** 一次性迁移：历史 done+consumed 的老约课补 attend='present'、deducted=true（防新逻辑重复消课/误判待点名） */
(function migrateBookingAttend() {
  try {
    const bookings = db.load('bookings', []);
    let changed = false;
    bookings.forEach((b) => {
      if (b.status === 'done' && b.attend === undefined) {
        b.attend = 'present';
        b.deducted = b.consumed !== false; // 之前已消课的标记为已扣，避免重复
        changed = true;
      }
    });
    if (changed) db.save('bookings', bookings);
  } catch (e) { /* noop */ }
})();


/**
 * 站内通知（双通道）：写入 notices 供小程序红点/列表消费；
 * 若配置了服务号(secrets.mp)且学生绑定 mpOpenId，同时推服务号模板消息（增强，无配置则仅站内）。
 * dedupe=true 时，同一 uid+type+refId 已有未读通知则不重复创建（避免每日提醒堆积）。
 */
function pushNotice(uid, type, title, body, refId, dedupe) {
  if (!uid) return;
  const notices = db.load('notices', []);
  if (dedupe && notices.some((n) => n.uid === uid && n.type === type && n.refId === (refId || '') && !n.read)) return;
  notices.unshift({ id: 'nt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), uid, type, title: String(title).slice(0, 40), body: String(body || '').slice(0, 80), refId: refId || '', read: false, ts: Date.now() });
  if (notices.length > 20000) notices.length = 20000;
  db.save('notices', notices);
  // 服务号增强（配置齐全且学生绑定服务号才推；异步不阻塞）
  try {
    const sec = db.load('secrets') || {};
    const mp = sec.mp && sec.mp.appId && sec.mp.appSecret ? sec.mp : null;
    const u = db.load('users', []).find((x) => x.uid === uid);
    if (mp && mp.templateHomework && u && u.mpOpenId) {
      sendMpTemplate(mp, u.mpOpenId, mp.templateHomework,
        { thing1: { value: title.slice(0, 20) }, thing2: { value: (body || '').slice(0, 20) } },
        { appid: sec.wechat && sec.wechat.appId, pagepath: 'pages/homework/index' }).catch(() => {});
    }
  } catch (e) { /* 推送失败不影响站内通知 */ }
}

/**
 * 每日作业提醒（19 点档执行一次）：扫描 remind=true 且未截止的作业，未提交学生 -> 站内通知(+服务号)。
 * 24 小时内截止的作业推「即将截止」，否则推「记得完成」；同一作业未读通知不重复堆积。
 */
let lastRemindDate = '';
async function dailyHomeworkRemind() {
  const now = new Date(Date.now() + 8 * 3600000); // 北京时间
  const dateStr = now.toISOString().slice(0, 10);
  if (now.getUTCHours() !== 19 || lastRemindDate === dateStr) return;
  lastRemindDate = dateStr;
  const users = db.load('users', []);
  const subs = db.load('submissions', []);
  db.load('homeworks', []).forEach((hw) => {
    if (hw.status === 'off' || !hw.remind) return;
    if (hw.endAt && Date.now() > hw.endAt) return;
    const nearDue = hw.endAt && (hw.endAt - Date.now()) <= 24 * 3600000; // 24h 内截止
    const targets = hw.targetType === 'class'
      ? users.filter((u) => (u.classTag || '') === hw.classTag)
      : users.filter((u) => (hw.studentNos || []).map(String).includes(String(u.studentNo)));
    targets.forEach((u) => {
      if (subs.some((s) => s.hwId === hw.id && s.uid === u.uid)) return; // 已交跳过
      pushNotice(u.uid, nearDue ? 'hw_due' : 'hw_remind',
        nearDue ? '作业即将截止' : '作业待完成',
        `《${hw.title}》${nearDue ? '今天截止，记得提交' : '记得按时完成哦'}`,
        hw.id, true);
    });
  });
}
setInterval(dailyHomeworkRemind, 30 * 60 * 1000);

/**
 * 每日笔记提醒（20 点档执行一次）：
 * - 扫描已完成、但老师课后未上传专属笔记的课，按老师汇总"待补笔记"节数
 * - 服务号已配置（secrets.mp）且老师账号绑定服务号 openid -> 推模板消息催上传
 * - 未配置时仅记 remindLogs（教师工作台顶部红点用同源数据）
 */
let lastNoteRemindDate = '';
async function dailyNoteRemind() {
  const now = new Date(Date.now() + 8 * 3600000); // 北京时间
  const dateStr = now.toISOString().slice(0, 10);
  if (now.getUTCHours() !== 20 || lastNoteRemindDate === dateStr) return;
  lastNoteRemindDate = dateStr;
  const nowTs = Date.now();
  const notes = db.load('notes', []);
  const admins = loadAdmins();
  const sec = db.load('secrets') || {};
  const mp = sec.mp && sec.mp.appId && sec.mp.appSecret ? sec.mp : null;
  // 按老师汇总待补笔记节数
  const byTeacher = {};
  db.load('bookings', []).forEach((b) => {
    if (b.status === 'cancelled') return;
    const endTs = slotTs(b.date, b.end);
    if (endTs >= nowTs) return; // 未结束
    const hasNote = notes.some((n) => n.teacherId === b.teacherId && n.uid === b.uid && n.ts >= endTs);
    if (hasNote) return;
    byTeacher[b.teacherId] = (byTeacher[b.teacherId] || 0) + 1;
  });
  for (const tid of Object.keys(byTeacher)) {
    const cnt = byTeacher[tid];
    // 找绑定该老师的账号（用于服务号 openid / 留痕）
    const acct = admins.find((a) => a.teacherId === tid);
    let sent = false;
    if (mp && mp.templateNote && acct && acct.mpOpenId) {
      try {
        await sendMpTemplate(mp, acct.mpOpenId, mp.templateNote,
          { thing1: { value: '课堂笔记待上传' }, thing2: { value: `你有 ${cnt} 节课还没上传笔记，记得补充` } },
          { appid: sec.wechat && sec.wechat.appId });
        sent = true;
      } catch (e) { /* 单条失败不阻塞 */ }
    }
    db.append('remindLogs', [{ type: 'note', teacherId: tid, pending: cnt, sent, date: dateStr, ts: Date.now() }], 100000);
  }
}
setInterval(dailyNoteRemind, 30 * 60 * 1000);

/** 老师时段冲突检测：同老师时间区间重叠（忽略已取消） */
function teacherConflict(teacherId, date, start, end, exceptSlotId) {
  const s1 = slotTs(date, start);
  const e1 = slotTs(date, end);
  return db.load('schedule', []).some((sl) =>
    sl.teacherId === teacherId && sl.date === date && sl.id !== exceptSlotId &&
    sl.status !== 'closed' && s1 < slotTs(date, sl.end) && e1 > slotTs(date, sl.start)
  );
}

/* ---------- 路由 ---------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });

  try {
    /* 学生端 */
    if (req.method === 'GET' && p === '/api/health') {
      return sendJson(res, 200, { ok: true, time: Date.now(), version: '0.1.0' });
    }
    if (req.method === 'GET' && p === '/api/levels') {
      return sendJson(res, 200, { ok: true, data: studentLevels() });
    }
    if (req.method === 'GET' && p === '/api/questions') {
      return sendJson(res, 200, { ok: true, data: studentQuestions(url.searchParams.get('levelId')) });
    }
    if (req.method === 'POST' && p === '/api/results') {
      const body = await readBody(req);
      db.append('results', [{ ...body, ts: Date.now() }], 100000);
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/logs') {
      const body = await readBody(req);
      const logs = Array.isArray(body.logs) ? body.logs : [];
      db.append('logs', logs.map((l) => ({ ...l, deviceId: body.deviceId || '' })), 500000);
      return sendJson(res, 200, { ok: true, count: logs.length });
    }
    if (req.method === 'GET' && p === '/api/courses') {
      // 学生端课程列表（仅上架）+ 真实观看统计 + 付费门槛（付费未购课剥离视频地址）
      const watch = db.load('courseWatch', []);
      const uid = verifyUserToken(url.searchParams.get('token')) || '';
      const data = db.load('courses', []).filter((c) => c.status === 'online').map((c) => {
        const ws = watch.filter((w) => w.courseId === c.id);
        const price = c.price || 0;
        const owned = hasCourseAccess(uid, c);
        const item = { ...c, price, views: ws.length, finished: ws.filter((w) => w.pct >= 95).length, owned, locked: price > 0 && !owned };
        // 安全：付费且未购的课，不下发真实视频地址/fileId（防明文盗链）
        if (item.locked) { item.videoUrl = ''; item.fileId = ''; }
        return item;
      });
      return sendJson(res, 200, { ok: true, data });
    }

    /* 课程分类（学生端顶部滑动栏 + 后台下拉共用数据源） */
    if (req.method === 'GET' && p === '/api/course/categories') {
      return sendJson(res, 200, { ok: true, data: db.load('courseCategories', ['发音入门', '词汇拓展', '商务粤语']) });
    }

    /* 观看进度上报（游客按设备、登录按账号，账号优先合并设备记录） */
    if (req.method === 'POST' && p === '/api/course/watch') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token) || '';
      const who = uid || String(body.deviceId || '');
      if (!who || !body.courseId) return sendJson(res, 400, { ok: false, error: '参数不全' });
      const seconds = Math.max(0, parseInt(body.seconds, 10) || 0);
      const duration = Math.max(0, parseInt(body.duration, 10) || 0);
      const pct = duration ? Math.min(100, Math.round((seconds / duration) * 100)) : 0;
      const list = db.load('courseWatch', []);
      const rec = list.find((w) => w.courseId === body.courseId && w.who === who);
      if (rec) {
        rec.seconds = seconds;
        rec.duration = duration || rec.duration;
        rec.pct = Math.max(rec.pct || 0, body.ended ? 100 : pct); // 完成度只增不减
        rec.ts = Date.now();
      } else {
        list.push({ courseId: body.courseId, who, uid, seconds, duration, pct: body.ended ? 100 : pct, ts: Date.now() });
      }
      if (list.length > 100000) list.splice(0, list.length - 100000);
      db.save('courseWatch', list);
      return sendJson(res, 200, { ok: true });
    }

    /* 我的观看进度（列表页进度条/续播） */
    if (req.method === 'GET' && p === '/api/course/watch') {
      const uid = verifyUserToken(url.searchParams.get('token')) || '';
      const who = uid || String(url.searchParams.get('deviceId') || '');
      const mine = {};
      db.load('courseWatch', []).forEach((w) => {
        if (w.who === who) mine[w.courseId] = { seconds: w.seconds, pct: w.pct, ts: w.ts };
      });
      return sendJson(res, 200, { ok: true, data: mine });
    }

    /* ===== 录播课付费（学生端） ===== */

    /* 每日学习打卡（上云）：POST 打卡 / GET 查状态 */
    if (req.method === 'POST' && p === '/api/checkin') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const r = doCheckin(uid);
      if (!r) return sendJson(res, 404, { ok: false, error: '用户不存在' });
      return sendJson(res, 200, { ok: true, data: r });
    }
    if (req.method === 'GET' && p === '/api/my/checkin') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      return sendJson(res, 200, { ok: true, data: checkinStatus(uid) });
    }

    /* 取播放地址（鉴权）：免费/会员/已买断才返回真实 videoUrl，否则 402 提示购买 */
    if (req.method === 'GET' && p === '/api/course/play') {
      const uid = verifyUserToken(url.searchParams.get('token')) || '';
      const course = db.load('courses', []).find((c) => c.id === url.searchParams.get('courseId'));
      if (!course || course.status !== 'online') return sendJson(res, 404, { ok: false, error: '课程不存在或已下架' });
      if (!hasCourseAccess(uid, course)) return sendJson(res, 402, { ok: false, error: '该课程需购买后观看', data: { price: course.price || 0 } });
      if (!course.videoUrl) return sendJson(res, 404, { ok: false, error: '视频待上传' });
      return sendJson(res, 200, { ok: true, data: { videoUrl: course.videoUrl, name: course.name } });
    }

    /* 会员状态 + 定价（学生端会员页展示） */
    if (req.method === 'GET' && p === '/api/membership') {
      const uid = verifyUserToken(url.searchParams.get('token')) || '';
      const u = uid ? db.load('users', []).find((x) => x.uid === uid) : null;
      const cfg = membershipConfig();
      return sendJson(res, 200, { ok: true, data: {
        isMember: isActiveMember(uid),
        expireAt: (u && u.memberExpireAt) || 0,
        enabled: cfg.enabled,
        monthFen: cfg.monthFen,
        yearFen: cfg.yearFen,
      } });
    }

    /* 我的订单 */
    if (req.method === 'GET' && p === '/api/my/orders') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const list = db.load('orders', []).filter((o) => o.uid === uid)
        .sort((a, b) => b.createdAt - a.createdAt).slice(0, 100)
        .map((o) => ({ id: o.id, type: o.type, title: o.title, amountFen: o.amountFen, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || 0 }));
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* 下单：type=course(courseId) / member(plan=month|year)。返回小程序支付参数；未配置支付则 needConfig */
    if (req.method === 'POST' && p === '/api/course/order') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const sec = db.load('secrets') || {};
      let type = body.type === 'member' ? 'member' : 'course';
      let amountFen = 0; let title = ''; let courseId = ''; let months = 0;
      if (type === 'course') {
        const course = db.load('courses', []).find((c) => c.id === body.courseId && c.status === 'online');
        if (!course) return sendJson(res, 404, { ok: false, error: '课程不存在' });
        if (!course.price || course.price <= 0) return sendJson(res, 400, { ok: false, error: '该课程免费，无需购买' });
        if (hasCourseAccess(uid, course)) return sendJson(res, 400, { ok: false, error: '你已可观看该课程' });
        amountFen = course.price; title = '录播课：' + course.name; courseId = course.id;
      } else {
        const cfg = membershipConfig();
        if (!cfg.enabled) return sendJson(res, 400, { ok: false, error: '会员暂未开放' });
        months = body.plan === 'year' ? 12 : 1;
        amountFen = months === 12 ? cfg.yearFen : cfg.monthFen;
        title = months === 12 ? '会员年卡' : '会员月卡';
      }
      // 建 pending 订单
      const order = {
        id: 'od' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        uid, type, courseId, months, title, amountFen, status: 'pending', createdAt: Date.now(),
      };
      const orders = db.load('orders', []);
      orders.push(order);
      db.save('orders', orders);
      // 未配置微信支付：返回结构，支付环节停用（拿到商户号后此分支自动走真实下单）
      if (!wxpay.isConfigured(sec)) {
        return sendJson(res, 200, { ok: true, data: { orderId: order.id, amountFen, needConfig: true, message: '支付通道未开通（待配置微信支付商户号）' } });
      }
      // 已配置：调微信支付 JSAPI 下单，返回小程序调起参数
      try {
        const u = db.load('users', []).find((x) => x.uid === uid);
        const { prepayId } = await wxpay.createJsapiTransaction(sec, {
          description: title, outTradeNo: order.id, amountFen, openid: u.openid,
          notifyUrl: `${resBase().replace(/\/$/, '')}/api/pay/notify`.replace(COS_HOST, 'yy.fla.wang'),
        });
        const payParams = wxpay.buildMiniPayParams(sec, prepayId);
        return sendJson(res, 200, { ok: true, data: { orderId: order.id, amountFen, needConfig: false, payParams } });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: '下单失败：' + String(e.message || e).slice(0, 100) });
      }
    }

    /* 微信支付回调（v3）：验签解密 -> 幂等发放权益。返回 200/{code:SUCCESS} 通知微信不再重推 */
    if (req.method === 'POST' && p === '/api/pay/notify') {
      const sec = db.load('secrets') || {};
      try {
        const evt = await readBody(req); // 微信回调体（JSON）
        const info = wxpay.decryptNotifyResource(sec, evt.resource);
        if (info.trade_state === 'SUCCESS') {
          const orders = db.load('orders', []);
          const order = orders.find((o) => o.id === info.out_trade_no);
          if (order && order.status !== 'paid' && info.amount && info.amount.total === order.amountFen) {
            order.transactionId = info.transaction_id;
            fulfillOrder(order);
            db.save('orders', orders);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 'SUCCESS', message: '成功' }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ code: 'FAIL', message: '处理失败' }));
      }
    }


    /* 学生微信登录：手机号一键登录（获取失败自动降级为微信身份登录） */
    if (req.method === 'POST' && p === '/api/auth/login') {
      const body = await readBody(req);
      const sec = db.load('secrets');
      if (!sec || !sec.wechat || !sec.wechat.appSecret) {
        return sendJson(res, 500, { ok: false, error: '服务器未配置微信密钥' });
      }
      const { appId, appSecret } = sec.wechat;
      if (!body.loginCode) return sendJson(res, 400, { ok: false, error: '缺少登录凭证' });
      let openid = '';
      try {
        const s = await code2Session(appId, appSecret, body.loginCode);
        openid = s.openid;
      } catch (e) {
        db.append('logs', [{ event: 'login_error', step: 'code2session', err: e.message, ts: Date.now() }], 500000);
        // 凭证无效/已过期（40029/40163 等）属客户端问题，返回 400 引导重试；其余为服务异常 500
        if (/4002|4016|4012|invalid code|code been used/i.test(e.message)) {
          return sendJson(res, 400, { ok: false, error: '登录凭证已失效，请重新进入小程序' });
        }
        return sendJson(res, 500, { ok: false, error: '微信登录失败，请稍后再试' });
      }
      // 手机号（可选：能力未开通或用户拒绝时降级）
      let phone = '';
      if (body.phoneCode) {
        try {
          phone = await getPhoneNumber(appId, appSecret, body.phoneCode);
        } catch (e) {
          db.append('logs', [{ event: 'login_error', step: 'phone', err: e.message, ts: Date.now() }], 500000);
        }
      }
      const users = db.load('users', []);
      let user = users.find((u) => u.openid === openid);
      const AVATAR_EMOJIS = ['🦁', '🐯', '🐼', '🐸', '🐥', '🦊', '🐨', '🐰', '🐮', '🐷', '🦄', '🐙'];
      /** 学号：从 100001 递增 */
      const nextStudentNo = () => users.reduce((mx, u) => Math.max(mx, u.studentNo || 0), 100000) + 1;
      if (!user) {
        user = {
          uid: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          studentNo: nextStudentNo(),
          openid,
          phone: phone || '',
          nickname: '粤语学习者',
          avatarEmoji: AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)],
          deviceId: body.deviceId || '',
          createdAt: Date.now(),
        };
        users.push(user);
      } else {
        if (!user.studentNo) user.studentNo = nextStudentNo(); // 老用户补发学号
        if (phone) user.phone = phone;
        if (body.deviceId) user.deviceId = body.deviceId;
        user.lastLoginAt = Date.now();
      }
      db.save('users', users);
      // 无状态用户凭证：uid.ts.hmac（学生端弱鉴权够用）
      const ts = Date.now();
      const sig = crypto.createHmac('sha256', sec.wechat.appSecret).update(`${user.uid}.${ts}`).digest('hex').slice(0, 32);
      const userToken = `${user.uid}.${ts}.${sig}`;
      const phoneMasked = user.phone ? user.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '';
      return sendJson(res, 200, {
        ok: true,
        data: { token: userToken, user: { uid: user.uid, studentNo: user.studentNo, nickname: user.nickname, avatarEmoji: user.avatarEmoji, phone: phoneMasked, hasPhone: !!user.phone } },
      });
    }

    /* 学生进度云同步：验签 userToken（uid.ts.sig） */
    function verifyUserToken(token) {
      const sec2 = db.load('secrets');
      if (!sec2 || !sec2.wechat) return null;
      const parts = String(token || '').split('.');
      if (parts.length !== 3) return null;
      const [uid, ts0, sig] = parts;
      const expect = crypto.createHmac('sha256', sec2.wechat.appSecret).update(`${uid}.${ts0}`).digest('hex').slice(0, 32);
      if (sig !== expect) return null;
      if (Date.now() - Number(ts0) > 90 * 86400000) return null; // 90 天有效
      return uid;
    }

    /* 上传进度快照（退出登录前 / 关卡结算后调用） */
    if (req.method === 'POST' && p === '/api/user/progress') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '登录已失效，请重新登录' });
      const users = db.load('users', []);
      const user = users.find((u) => u.uid === uid);
      if (!user) return sendJson(res, 404, { ok: false, error: '用户不存在' });
      user.progress = body.progress || {};
      user.progressAt = Date.now();
      db.save('users', users);
      return sendJson(res, 200, { ok: true });
    }

    /* 拉取进度快照（登录成功后恢复） */
    if (req.method === 'GET' && p === '/api/user/progress') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '登录已失效，请重新登录' });
      const user = db.load('users', []).find((u) => u.uid === uid);
      if (!user) return sendJson(res, 404, { ok: false, error: '用户不存在' });
      return sendJson(res, 200, { ok: true, data: { progress: user.progress || null, progressAt: user.progressAt || 0 } });
    }

    /* 小程序全局配置（公开）：版本切换开关 + 协议链接 */
    if (req.method === 'GET' && p === '/api/app/config') {
      const cfg = db.load('appconfig', { versionSwitch: false });
      const bc = db.load('adminconfig', {});
      return sendJson(res, 200, { ok: true, data: {
        versionSwitch: !!cfg.versionSwitch,
        uaUrl: bc.uaUrl || '',
        privacyUrl: bc.privacyUrl || '',
        bookAheadDays: bookAheadDays(),
      } });
    }

    /* 后台外观配置（公开读）：logo 图 / 系统名称，登录页与侧栏展示 */
    if (req.method === 'GET' && p === '/api/admin/branding') {
      const bc = db.load('adminconfig', {});
      return sendJson(res, 200, { ok: true, data: { logo: bc.logo || '', title: bc.title || '粤语学习后台', subtitle: bc.subtitle || '教务管理平台' } });
    }

    /* ===== 约课模块（学生端） ===== */

    /* 可约时段（未来 bookAheadDays 天内，按日期分组，含老师名） */
    if (req.method === 'GET' && p === '/api/schedule/open') {
      const teachers = db.load('teachers', []);
      const now = Date.now();
      const maxTs = now + bookAheadDays() * 86400000;
      // 关闭"接受约课"的老师，其时段不放给学生（已约的不受影响）
      const blocked = new Set(teachers.filter((t) => t.acceptBooking === false).map((t) => t.id));
      const list = db.load('schedule', [])
        .filter((sl) => sl.status === 'open' && !blocked.has(sl.teacherId) && slotTs(sl.date, sl.start) > now && slotTs(sl.date, sl.start) < maxTs)
        .sort((a, b) => slotTs(a.date, a.start) - slotTs(b.date, b.start))
        .map((sl) => {
          const t = teachers.find((x) => x.id === sl.teacherId) || {};
          return { id: sl.id, date: sl.date, start: sl.start, end: sl.end, teacherId: sl.teacherId, teacherName: t.name || '老师' };
        });
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* 学生约课：校验课时余量 + 时段可约 */
    if (req.method === 'POST' && p === '/api/booking/create') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      if (packSummary(uid).remain <= 0) return sendJson(res, 400, { ok: false, error: '课时不足，请联系老师充值课时包' });
      const schedule = db.load('schedule', []);
      const sl = schedule.find((x) => x.id === body.slotId);
      if (!sl || sl.status !== 'open') return sendJson(res, 400, { ok: false, error: '该时段已被约走，请选择其他时间' });
      if (slotTs(sl.date, sl.start) < Date.now()) return sendJson(res, 400, { ok: false, error: '该时段已过期' });
      const user = db.load('users', []).find((u) => u.uid === uid) || {};
      const teacher = db.load('teachers', []).find((t) => t.id === sl.teacherId) || {};
      const bookings = db.load('bookings', []);
      const bk = {
        id: 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        slotId: sl.id, teacherId: sl.teacherId, teacherName: teacher.name || '老师',
        uid, studentNo: user.studentNo || '', date: sl.date, start: sl.start, end: sl.end,
        status: 'booked', createdAt: Date.now(),
      };
      sl.status = 'booked';
      sl.bookingId = bk.id;
      bookings.unshift(bk);
      db.save('schedule', schedule);
      db.save('bookings', bookings);
      return sendJson(res, 200, { ok: true, data: { id: bk.id } });
    }

    /* 学生取消预约（开课前均可）：释放时段 */
    if (req.method === 'POST' && p === '/api/booking/cancel') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const bookings = db.load('bookings', []);
      const bk = bookings.find((b) => b.id === body.id && b.uid === uid);
      if (!bk || bk.status !== 'booked') return sendJson(res, 400, { ok: false, error: '该预约不可取消' });
      if (slotTs(bk.date, bk.start) < Date.now()) return sendJson(res, 400, { ok: false, error: '课程已开始，无法取消' });
      bk.status = 'cancelled';
      bk.cancelledAt = Date.now();
      const schedule = db.load('schedule', []);
      const sl = schedule.find((x) => x.id === bk.slotId);
      if (sl) { sl.status = 'open'; delete sl.bookingId; }
      db.save('bookings', bookings);
      db.save('schedule', schedule);
      return sendJson(res, 200, { ok: true });
    }

    /* 我的课堂笔记（学生端）：老师发给我的 + 公开笔记 */
    if (req.method === 'GET' && p === '/api/my/notes') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const list = db.load('notes', [])
        .filter((n) => n.uid === uid || n.uid === '')
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 100)
        .map((n) => ({ id: n.id, title: n.title, text: n.text, images: n.images, teacherName: n.teacherName, ts: n.ts, mine: n.uid === uid }));
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* 我的课程聚合：课时包 + 约课列表（含会议号时间窗控制） */
    if (req.method === 'GET' && p === '/api/my/course') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const teachers = db.load('teachers', []);
      const now = Date.now();
      const list = db.load('bookings', [])
        .filter((b) => b.uid === uid && b.status !== 'cancelled')
        .sort((a, b) => slotTs(b.date, b.start) - slotTs(a.date, a.start))
        .slice(0, 60)
        .map((b) => {
          const startTs = slotTs(b.date, b.start);
          const endTs = slotTs(b.date, b.end);
          // 时间窗：开课前 5 分钟 ~ 课程结束，才下发会议号（防串场第一道防线）
          const inWindow = b.status === 'booked' && now >= startTs - 5 * 60000 && now <= endTs;
          const t = teachers.find((x) => x.id === b.teacherId) || {};
          return {
            id: b.id, date: b.date, start: b.start, end: b.end,
            teacherName: b.teacherName, status: b.status,
            attend: b.attend || (b.status === 'done' ? 'none' : ''), // 出勤态：present/leave/absent/none(待点名)
            meetingUrl: inWindow ? t.pmiUrl || '' : '',
            meetingCode: inWindow ? t.pmiCode || '' : '',
            linkAt: startTs - 5 * 60000,
          };
        });
      // 出勤考核汇总（以已结束的课为口径）
      const done = db.load('bookings', []).filter((b) => b.uid === uid && b.status === 'done');
      const present = done.filter((b) => b.attend === 'present').length;
      const leave = done.filter((b) => b.attend === 'leave').length;
      const absent = done.filter((b) => b.attend === 'absent').length;
      const counted = present + leave + absent; // 已点名的
      const attendStat = {
        totalDone: done.length,
        present, leave, absent,
        rate: counted ? Math.round((present / counted) * 100) : 0, // 出勤率=签到/(签到+请假+缺课)
      };
      return sendJson(res, 200, { ok: true, data: { pack: packSummary(uid), bookings: list, attendStat } });
    }

    /* ===== 课后作业（学生端） ===== */

    /** 作业是否面向该学生 */
    const hwTargetsUser = (hw, user) => {
      if (!user) return false;
      if (hw.targetType === 'class') return (user.classTag || '') === hw.classTag;
      return (hw.studentNos || []).map(String).includes(String(user.studentNo));
    };

    /* 学生上传作业图片（逐张，压缩后 base64 -> COS） */
    if (req.method === 'POST' && p === '/api/homework/upload') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/.exec(body.dataUrl || '');
      if (!m) return sendJson(res, 400, { ok: false, error: '图片格式不支持' });
      const sec = db.load('secrets');
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const key = `/hw/${uid}/${Date.now().toString(36)}.${ext}`;
      try {
        await cosPutObject(sec.tencent.secretId, sec.tencent.secretKey, COS_HOST, key, Buffer.from(m[2], 'base64'), 'image/' + m[1]);
        return sendJson(res, 200, { ok: true, data: { url: `${resBase()}${key}` } });
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: '上传失败：' + e.message.slice(0, 80) });
      }
    }

    /* 我的站内通知（作业提醒/批改结果）：列表 + 未读数 */
    if (req.method === 'GET' && p === '/api/my/notices') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const mine = db.load('notices', []).filter((n) => n.uid === uid).slice(0, 50);
      const unread = mine.filter((n) => !n.read).length;
      return sendJson(res, 200, { ok: true, data: { unread, list: mine } });
    }

    /* 标记通知已读（id 指定单条 / all=1 全部；refId 指定某作业相关全部） */
    if (req.method === 'POST' && p === '/api/notices/read') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const notices = db.load('notices', []);
      let changed = false;
      notices.forEach((n) => {
        if (n.uid !== uid || n.read) return;
        if (body.all || n.id === body.id || (body.refId && n.refId === body.refId)) { n.read = true; changed = true; }
      });
      if (changed) db.save('notices', notices);
      return sendJson(res, 200, { ok: true });
    }

    /* 我的作业列表（含提交/批改状态） */
    if (req.method === 'GET' && p === '/api/homework/list') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const user = db.load('users', []).find((u) => u.uid === uid);
      const subs = db.load('submissions', []).filter((s) => s.uid === uid);
      const now = Date.now();
      const list = db.load('homeworks', [])
        .filter((hw) => hw.status !== 'off' && hwTargetsUser(hw, user))
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 50)
        .map((hw) => {
          const sub = subs.find((s) => s.hwId === hw.id);
          return {
            id: hw.id, title: hw.title, content: hw.content, images: hw.images || [],
            startAt: hw.startAt, endAt: hw.endAt,
            expired: hw.endAt ? now > hw.endAt : false,
            sub: sub ? {
              id: sub.id, status: sub.status, ts: sub.ts, text: sub.text, images: sub.images,
              score: sub.score, comment: sub.comment, markImages: sub.markImages || [],
            } : null,
          };
        });
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* 提交作业 */
    if (req.method === 'POST' && p === '/api/homework/submit') {
      const body = await readBody(req);
      const uid = verifyUserToken(body.token);
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const user = db.load('users', []).find((u) => u.uid === uid);
      const hw = db.load('homeworks', []).find((h) => h.id === body.hwId && h.status !== 'off');
      if (!hw || !hwTargetsUser(hw, user)) return sendJson(res, 404, { ok: false, error: '作业不存在' });
      if (hw.endAt && Date.now() > hw.endAt) return sendJson(res, 400, { ok: false, error: '作业已截止，请联系老师' });
      const subs = db.load('submissions', []);
      const exist = subs.find((s) => s.hwId === hw.id && s.uid === uid);
      if (exist && exist.status === 'graded') return sendJson(res, 400, { ok: false, error: '该作业已批改，无法重新提交' });
      const images = (Array.isArray(body.images) ? body.images : []).slice(0, 6).filter((u) => /^https:\/\//.test(u));
      const data = { text: String(body.text || '').slice(0, 1000), images, ts: Date.now(), status: 'submitted' };
      if (exist) Object.assign(exist, data);
      else subs.unshift({ id: 'sub' + Date.now().toString(36), hwId: hw.id, uid, studentNo: user.studentNo || '', ...data });
      db.save('submissions', subs);
      return sendJson(res, 200, { ok: true });
    }

    /* ===== 教材体系（学生端）=====
       解锁规则：学生可见 = 本类中 order <= 当前本序号；若当前本进度 chapter >= 该本 unlockChapter，
       则下一本自动解锁（教材自动、作业老师手动的"双轨制"） */
    if (req.method === 'GET' && p === '/api/materials/mine') {
      const uid = verifyUserToken(url.searchParams.get('token'));
      if (!uid) return sendJson(res, 401, { ok: false, error: '请先登录' });
      const user = db.load('users', []).find((u) => u.uid === uid) || {};
      const tag = user.classTag || 'A'; // 未分类默认 A 类
      const curBook = user.matBook || 1;
      const curChapter = user.matChapter || 1;
      const books = db.load('materials', [])
        .filter((mt) => (mt.category || '') === tag)
        .sort((a, b) => (a.order || 99) - (b.order || 99));
      let maxVisible = curBook;
      const cur = books.find((b) => (b.order || 99) === curBook);
      if (cur && cur.unlockChapter && curChapter >= cur.unlockChapter) maxVisible = curBook + 1; // 自动解锁下一本
      const data = books.map((mt) => ({
        id: mt.id, name: mt.name, pages: mt.pages,
        order: mt.order || 99, chapterCount: mt.chapterCount || 0,
        unlocked: (mt.order || 99) <= maxVisible,
        current: (mt.order || 99) === curBook,
        myChapter: (mt.order || 99) === curBook ? curChapter : 0,
      }));
      return sendJson(res, 200, { ok: true, data: { classTag: tag, curBook, curChapter, books: data } });
    }

    /* 教材详情（需学生登录态或后台会话，防止内容被外部拉取） */
    if (req.method === 'GET' && p === '/api/material') {
      if (!verifyUserToken(url.searchParams.get('token')) && !checkAuth(req)) {
        return sendJson(res, 401, { ok: false, error: '请先登录' });
      }
      const id = url.searchParams.get('id') || '';
      const mat = db.load('materials', []).find((x) => x.id === id);
      if (!mat) return sendJson(res, 404, { ok: false, error: '教材不存在' });
      return sendJson(res, 200, { ok: true, data: { id: mat.id, name: mat.name, pages: mat.pages, base: `/materials/${mat.id}/` } });
    }

    /* 教材批注增量拉取：?id=xx&since=seq[&wait=1][&stu=uid] -> wait=1 时无新数据挂起（长轮询，最长 25s） */
    if (req.method === 'GET' && p === '/api/material/strokes') {
      const stuTok = verifyUserToken(url.searchParams.get('token'));
      if (!stuTok && !checkAuth(req)) {
        return sendJson(res, 401, { ok: false, error: '请先登录' });
      }
      const id = url.searchParams.get('id') || '';
      // 学生只能读自己专属频道；后台老师可用 stu 指定学生频道，否则公共频道
      const chan = stuTok ? annoChan(id, stuTok) : annoChan(id, url.searchParams.get('stu') || '');
      const since = parseInt(url.searchParams.get('since') || '0', 10) || 0;
      const anno = db.load(annoKey(chan), { seq: 0, items: [] });
      const fresh = anno.items.filter((it) => it.seq > since);
      const liveNow = annoLive.get(annoKey(chan)) || null;
      // 有正式增量、或有进行中的实时笔画（rev 变化）时立即返回
      const liveRev = parseInt(url.searchParams.get('liverev') || '0', 10) || 0;
      const liveChanged = liveNow && liveNow.rev !== liveRev;
      if (url.searchParams.get('wait') !== '1' || fresh.length || liveChanged) {
        return sendJson(res, 200, { ok: true, data: { seq: anno.seq, items: fresh, live: liveNow } });
      }
      // 挂起等新笔画；25s 无动静返回空增量（客户端随即重连）
      const waiter = { res, since, timer: null };
      waiter.timer = setTimeout(() => {
        const list = annoWaiters.get(chan) || [];
        annoWaiters.set(chan, list.filter((w) => w !== waiter));
        const cur = db.load(annoKey(chan), { seq: 0, items: [] });
        try { sendJson(res, 200, { ok: true, data: { seq: cur.seq, items: [], live: annoLive.get(annoKey(chan)) || null } }); } catch (e) { /* noop */ }
      }, 25000);
      const list = annoWaiters.get(chan) || [];
      list.push(waiter);
      annoWaiters.set(chan, list);
      req.on('close', () => {
        clearTimeout(waiter.timer);
        const l = annoWaiters.get(chan) || [];
        annoWaiters.set(chan, l.filter((w) => w !== waiter));
      });
      return;
    }

    /* AI 纠音评分：学生录音（base64 mp3）-> 粤语识别 -> 逐字比对 */
    if (req.method === 'POST' && p === '/api/speaking/assess') {
      const body = await readBody(req);
      // 防刷限流：每设备每日上限（ASR 按次计费）
      const dayKey = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
      const devKey = `${body.deviceId || 'anon'}:${dayKey}`;
      assessQuota.set(devKey, (assessQuota.get(devKey) || 0) + 1);
      if (assessQuota.size > 5000) assessQuota.clear(); // 粗放清理，跨天自然重置
      if (assessQuota.get(devKey) > 150) {
        return sendJson(res, 429, { ok: false, error: '今日评分次数已达上限，明天再来练习吧' });
      }
      const q = db.load('questions', []).find((x) => x.id === body.questionId);
      if (!q) return sendJson(res, 400, { ok: false, error: '题目不存在' });
      const refText = (q.stem && q.stem.text) || '';
      if (!refText) return sendJson(res, 400, { ok: false, error: '该题无目标文本' });
      const audio = Buffer.from(String(body.audio || ''), 'base64');
      if (!audio.length) return sendJson(res, 400, { ok: false, error: '缺少录音数据' });
      if (audio.length > 2 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: '录音过大' });
      const sec = db.load('secrets');
      if (!sec || !sec.tencent) return sendJson(res, 500, { ok: false, error: '服务器未配置云 API 密钥' });
      let hyp = '';
      try {
        hyp = await recognizeCantonese(sec.tencent.secretId, sec.tencent.secretKey, audio, sec.tencent.region);
      } catch (e) {
        db.append('logs', [{ event: 'asr_error', questionId: body.questionId, deviceId: body.deviceId || '', err: e.message, ts: Date.now() }], 500000);
        // 音频无效（如开发者工具的非标准录音）给出可理解的提示
        if (/audio data empty|4008|format/i.test(e.message)) {
          return sendJson(res, 400, { ok: false, error: '录音无法识别，请重新录制（开发者工具请改用真机）' });
        }
        return sendJson(res, 500, { ok: false, error: '识别服务开小差，请再试一次' });
      }
      const result = assessByCompare(refText, hyp);
      if (!result) return sendJson(res, 400, { ok: false, error: '题目文本异常' });
      // 识别为空（没听清/没说话）时 score 自然为 0
      db.append('logs', [{ event: 'speaking_assess', questionId: body.questionId, deviceId: body.deviceId || '', score: result.score, ref: refText, hyp, ts: Date.now() }], 500000);
      return sendJson(res, 200, { ok: true, data: result });
    }

    /* 管理端登录（免鉴权） */
    if (req.method === 'POST' && p === '/api/admin/login') {
      const body = await readBody(req);
      const account = loadAdmins().find(
        (a) => a.username === body.username && sha256(String(body.password || '')) === a.passHash
      );
      if (account) {
        return sendJson(res, 200, {
          ok: true,
          data: { token: issueToken(account), role: account.role, name: account.name, username: account.username, teacherId: account.teacherId || '' },
        });
      }
      return sendJson(res, 401, { ok: false, error: '账号或密码错误' });
    }

    /* 其余 /api/admin/* 一律鉴权 + 角色权限校验 + 写操作审计 */
    let session = null;
    if (p.startsWith('/api/admin/')) {
      session = checkAuth(req);
      if (!session) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      if (!roleAllowed(session.role, p, req.method)) {
        return sendJson(res, 403, { ok: false, error: `当前角色（${ROLE_NAMES[session.role] || session.role}）无此模块权限` });
      }
      if (req.method !== 'GET' && p !== '/api/admin/material/op') {
        // 工作留痕：预读请求体生成业务摘要（批注笔画 op 高频且属教学行为，不入审计）
        let detail = '';
        try { detail = auditDetail(await readBody(req)); } catch (e) { /* 空体或非JSON */ }
        db.append('audit', [{ user: session.username, name: session.name, role: session.role, method: req.method, path: p, detail, ts: Date.now() }], 100000);
      }
    }

    /* 管理端 */
    if (p === '/api/admin/questions') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: db.load('questions', []) });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const incoming = Array.isArray(body.data) ? body.data : [];
        const list = db.load('questions', []);
        incoming.forEach((item) => {
          const idx = list.findIndex((q) => q.id === item.id);
          if (idx >= 0) list[idx] = { ...list[idx], ...item }; // 按 id 浅合并，保留题目完整结构
          else list.push(item);
        });
        db.save('questions', list);
        return sendJson(res, 200, { ok: true, total: list.length });
      }
    }
    let m = p.match(/^\/api\/admin\/questions\/([\w-]+)$/);
    if (m && req.method === 'DELETE') {
      const list = db.load('questions', []).filter((q) => q.id !== m[1]);
      db.save('questions', list);
      // 同步从关卡中移除引用
      const levels = db.load('levels', []);
      levels.forEach((lv) => (lv.questionIds = lv.questionIds.filter((id) => id !== m[1])));
      db.save('levels', levels);
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/admin/levels') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: db.load('levels', []) });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        db.save('levels', Array.isArray(body.data) ? body.data : []);
        return sendJson(res, 200, { ok: true });
      }
    }
    m = p.match(/^\/api\/admin\/levels\/([\w-]+)$/);
    if (m && req.method === 'DELETE') {
      db.save('levels', db.load('levels', []).filter((lv) => lv.id !== m[1]));
      return sendJson(res, 200, { ok: true });
    }

    if (p === '/api/admin/courses') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: db.load('courses', []) });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        db.save('courses', Array.isArray(body.data) ? body.data : []);
        return sendJson(res, 200, { ok: true });
      }
    }

    /* 订单列表（付费录播/会员）：挂 courses 段，超管/内容编辑可查 */
    if (req.method === 'GET' && p === '/api/admin/orders') {
      const users = db.load('users', []);
      const status = url.searchParams.get('status') || '';
      let list = db.load('orders', []);
      if (status) list = list.filter((o) => o.status === status);
      const data = list.sort((a, b) => b.createdAt - a.createdAt).slice(0, 500).map((o) => {
        const u = users.find((x) => x.uid === o.uid) || {};
        return { id: o.id, studentNo: u.studentNo || '', nickname: u.nickname || '', type: o.type, title: o.title, amountFen: o.amountFen, status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || 0, transactionId: o.transactionId || '' };
      });
      const paidOrders = db.load('orders', []).filter((o) => o.status === 'paid');
      const gmvFen = paidOrders.reduce((s, o) => s + (o.amountFen || 0), 0);
      return sendJson(res, 200, { ok: true, data: { list: data, stat: { total: db.load('orders', []).length, paid: paidOrders.length, gmvFen } } });
    }

    /* 会员定价配置：挂 courses 段。GET 读 / PUT 存（月卡/年卡价格·分，开关） */
    if (p === '/api/admin/membership-config') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: membershipConfig() });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const bc = db.load('adminconfig', {});
        bc.membership = {
          enabled: body.enabled !== false,
          monthFen: Math.max(0, parseInt(body.monthFen, 10) || 0),
          yearFen: Math.max(0, parseInt(body.yearFen, 10) || 0),
        };
        db.save('adminconfig', bc);
        return sendJson(res, 200, { ok: true, data: membershipConfig() });
      }
    }

    /* 课程分类管理（超管/内容编辑）：增删改，去重去空 */
    if (p === '/api/admin/courses/categories') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: db.load('courseCategories', ['发音入门', '词汇拓展', '商务粤语']) });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const cats = (Array.isArray(body.categories) ? body.categories : [])
          .map((c) => String(c).trim().slice(0, 12))
          .filter((c, i, arr) => c && arr.indexOf(c) === i)
          .slice(0, 20);
        if (!cats.length) return sendJson(res, 400, { ok: false, error: '至少保留一个分类' });
        db.save('courseCategories', cats);
        return sendJson(res, 200, { ok: true, data: cats });
      }
    }
    m = p.match(/^\/api\/admin\/courses\/([\w-]+)$/);
    if (m && req.method === 'DELETE') {
      db.save('courses', db.load('courses', []).filter((c) => c.id !== m[1]));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/api/admin/overview') {
      return sendJson(res, 200, { ok: true, data: adminOverview() });
    }

    /* VOD 客户端上传签名（后台传视频用） */
    if (req.method === 'GET' && p === '/api/admin/vod/signature') {
      const sig = vodUploadSignature();
      if (!sig) return sendJson(res, 500, { ok: false, error: '服务器未配置云 API 密钥' });
      return sendJson(res, 200, { ok: true, data: { signature: sig } });
    }

    /* TTS：单题生成（body: { questionId } 或 { text }） */
    if (req.method === 'POST' && p === '/api/admin/tts') {
      const body = await readBody(req);
      let q = null;
      if (body.questionId) q = db.load('questions', []).find((x) => x.id === body.questionId);
      if (!q && body.text) q = { id: 'tmp_' + Date.now(), stem: { text: body.text } };
      if (!q) return sendJson(res, 400, { ok: false, error: '题目不存在' });
      const audioUrl = await ttsForQuestion(q);
      // 写回题目
      if (body.questionId) {
        const list = db.load('questions', []);
        const item = list.find((x) => x.id === body.questionId);
        if (item) {
          item.stem = item.stem || {};
          item.stem.audioUrl = audioUrl;
          item.hasAudio = true;
          db.save('questions', list);
        }
      }
      return sendJson(res, 200, { ok: true, data: { audioUrl } });
    }

    /* TTS：批量生成全部题目音频（串行，避免频率限制） */
    if (req.method === 'POST' && p === '/api/admin/tts/batch') {
      const list = db.load('questions', []);
      const result = { done: 0, skipped: 0, failed: [] };
      for (const q of list) {
        if (!speakableText(q)) {
          result.skipped += 1;
          continue;
        }
        try {
          const audioUrl = await ttsForQuestion(q);
          q.stem = q.stem || {};
          q.stem.audioUrl = audioUrl;
          q.hasAudio = true;
          result.done += 1;
        } catch (e) {
          result.failed.push({ id: q.id, error: e.message });
        }
        await new Promise((r) => setTimeout(r, 120)); // 限频保护
      }
      db.save('questions', list);
      return sendJson(res, 200, { ok: true, data: result });
    }

    /* TTS：返回需要生成音频的题目清单（供前端逐题驱动进度条；已生成的自动跳过） */
    if (req.method === 'GET' && p === '/api/admin/tts/pending') {
      const list = db.load('questions', []);
      const speakable = list.filter((q) => speakableText(q));
      // 已生成 = 有 audioUrl 且音频文件确实存在（防 audioUrl 残留但文件丢失）
      const hasAudioFile = (q) => !!(q.stem && q.stem.audioUrl) && fs.existsSync(path.join(AUDIO_DIR, q.id + '.mp3'));
      const items = speakable
        .filter((q) => !hasAudioFile(q))
        .map((q) => ({ id: q.id, text: speakableText(q).slice(0, 20) }));
      const skipped = speakable.length - items.length;
      return sendJson(res, 200, { ok: true, data: { items, total: items.length, skipped } });
    }

    /* 学生管理：按设备聚合学习数据 */
    if (req.method === 'GET' && p === '/api/admin/students') {
      const results = db.load('results', []);
      const logs = db.load('logs', []);
      const map = new Map();
      const ensure = (id) => {
        if (!map.has(id)) {
          map.set(id, {
            deviceId: id, levels: 0, passed: 0, answered: 0, seconds: 0,
            firstCorrect: 0, total: 0, assessCount: 0, avgScoreSum: 0, avgScoreN: 0, lastActive: 0,
          });
        }
        return map.get(id);
      };
      results.forEach((r) => {
        const s = ensure(r.deviceId || '未知设备');
        s.levels += 1;
        if (r.passed) s.passed += 1;
        s.answered += r.answeredCount || 0;
        s.seconds += r.seconds || 0;
        s.firstCorrect += r.firstCorrect || 0;
        s.total += r.total || 0;
        if ((r.ts || 0) > s.lastActive) s.lastActive = r.ts || 0;
      });
      logs.forEach((l) => {
        if (!l.deviceId) return;
        const s = ensure(l.deviceId);
        if (l.event === 'speaking_assess') {
          s.assessCount += 1;
          s.avgScoreSum += l.score || 0;
          s.avgScoreN += 1;
        }
        if ((l.ts || 0) > s.lastActive) s.lastActive = l.ts || 0;
      });
      const students = [...map.values()]
        .map((s) => ({
          deviceId: s.deviceId,
          levels: s.levels,
          passed: s.passed,
          answered: s.answered,
          minutes: Math.round(s.seconds / 60),
          firstRate: s.total ? Math.round((s.firstCorrect / s.total) * 100) : 0,
          assessCount: s.assessCount,
          avgAssessScore: s.avgScoreN ? Math.round(s.avgScoreSum / s.avgScoreN) : null,
          lastActive: s.lastActive,
        }))
        .sort((a, b) => b.lastActive - a.lastActive);
      // 关联注册用户：设备绑定了账号则展示学号与手机号
      const users = db.load('users', []);
      const byDevice = new Map(users.filter((u) => u.deviceId).map((u) => [u.deviceId, u]));
      students.forEach((s) => {
        const u = byDevice.get(s.deviceId);
        if (u) {
          s.studentNo = u.studentNo || null;
          s.nickname = u.nickname || '';
          s.phone = u.phone ? u.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '';
          s.registered = true;
        } else {
          s.registered = false;
        }
      });
      return sendJson(res, 200, { ok: true, data: students });
    }

    /* 修改自己的密码 */
    if (req.method === 'POST' && p === '/api/admin/password') {
      const body = await readBody(req);
      const admins = loadAdmins();
      const me = admins.find((a) => a.username === session.username);
      if (!me || sha256(String(body.oldPassword || '')) !== me.passHash) {
        return sendJson(res, 400, { ok: false, error: '当前密码不正确' });
      }
      const np = String(body.newPassword || '');
      if (np.length < 8) return sendJson(res, 400, { ok: false, error: '新密码至少 8 位' });
      me.passHash = sha256(np);
      db.save('admins', admins);
      [...sessions.entries()].forEach(([t, s]) => { if (s.username === me.username) sessions.delete(t); });
      return sendJson(res, 200, { ok: true });
    }

    /* 账号管理（仅超管，roleAllowed 已拦截其他角色） */
    if (p === '/api/admin/accounts' && req.method === 'GET') {
      const admins = loadAdmins().map((a) => ({ username: a.username, name: a.name, role: a.role, roleName: ROLE_NAMES[a.role] || a.role, teacherId: a.teacherId || '', createdAt: a.createdAt }));
      return sendJson(res, 200, { ok: true, data: admins });
    }
    if (p === '/api/admin/accounts' && req.method === 'POST') {
      const body = await readBody(req);
      const admins = loadAdmins();
      const username = String(body.username || '').trim();
      if (!/^[\w-]{3,20}$/.test(username)) return sendJson(res, 400, { ok: false, error: '用户名需 3-20 位字母数字' });
      if (admins.some((a) => a.username === username)) return sendJson(res, 400, { ok: false, error: '用户名已存在' });
      if (!ROLE_NAMES[body.role]) return sendJson(res, 400, { ok: false, error: '角色无效' });
      const pw = String(body.password || '');
      if (pw.length < 8) return sendJson(res, 400, { ok: false, error: '密码至少 8 位' });
      admins.push({ username, passHash: sha256(pw), role: body.role, name: String(body.name || username), teacherId: ['teacher', 'tutor'].includes(body.role) ? String(body.teacherId || '') : '', createdAt: Date.now() });
      db.save('admins', admins);
      return sendJson(res, 200, { ok: true });
    }
    /* 更新账号绑定的授课老师（超管；教师账号才有意义） */
    if (p === '/api/admin/accounts/bind' && req.method === 'PUT') {
      const body = await readBody(req);
      const admins = loadAdmins();
      const a = admins.find((x) => x.username === body.username);
      if (!a) return sendJson(res, 404, { ok: false, error: '账号不存在' });
      a.teacherId = String(body.teacherId || '');
      db.save('admins', admins);
      sessions.forEach((s) => { if (s.username === a.username) s.teacherId = a.teacherId; });
      return sendJson(res, 200, { ok: true });
    }
    m = p.match(/^\/api\/admin\/accounts\/([\w-]+)$/);
    if (m && req.method === 'DELETE') {
      const admins = loadAdmins();
      const target = admins.find((a) => a.username === m[1]);
      if (!target) return sendJson(res, 404, { ok: false, error: '账号不存在' });
      if (target.username === session.username) return sendJson(res, 400, { ok: false, error: '不能删除自己' });
      if (target.role === 'super' && admins.filter((a) => a.role === 'super').length <= 1) {
        return sendJson(res, 400, { ok: false, error: '至少保留一个超级管理员' });
      }
      db.save('admins', admins.filter((a) => a.username !== m[1]));
      [...sessions.entries()].forEach(([t, s]) => { if (s.username === m[1]) sessions.delete(t); });
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/admin/accounts/reset' && req.method === 'POST') {
      const body = await readBody(req);
      const admins = loadAdmins();
      const target = admins.find((a) => a.username === body.username);
      if (!target) return sendJson(res, 404, { ok: false, error: '账号不存在' });
      const pw = String(body.password || '');
      if (pw.length < 8) return sendJson(res, 400, { ok: false, error: '密码至少 8 位' });
      target.passHash = sha256(pw);
      db.save('admins', admins);
      [...sessions.entries()].forEach(([t, s]) => { if (s.username === target.username) sessions.delete(t); });
      return sendJson(res, 200, { ok: true });
    }

    /* 小程序版本开关（仅超管；非 super 无 settings scope 自动 403） */
    if (p === '/api/admin/settings/appconfig') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: db.load('appconfig', { versionSwitch: false }) });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const cfg = db.load('appconfig', { versionSwitch: false });
        cfg.versionSwitch = !!body.versionSwitch;
        db.save('appconfig', cfg);
        return sendJson(res, 200, { ok: true, data: cfg });
      }
    }

    /* 后台外观设置（仅超管写）：logo / 标题 / 副标题 */
    if (p === '/api/admin/settings/branding' && req.method === 'PUT') {
      const body = await readBody(req);
      const bc = db.load('adminconfig', {});
      if (typeof body.logo === 'string') bc.logo = body.logo.slice(0, 500);
      if (typeof body.title === 'string') bc.title = body.title.trim().slice(0, 20);
      if (typeof body.subtitle === 'string') bc.subtitle = body.subtitle.trim().slice(0, 30);
      db.save('adminconfig', bc);
      return sendJson(res, 200, { ok: true, data: bc });
    }

    /* 协议链接配置（超管）：用户协议 / 隐私政策 的 HTTPS 链接 */
    if (p === '/api/admin/settings/legal') {
      const bc = db.load('adminconfig', {});
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: { uaUrl: bc.uaUrl || '', privacyUrl: bc.privacyUrl || '' } });
      if (req.method === 'PUT') {
        const body = await readBody(req);
        // 只接受 https 链接或留空；限本站域名以便小程序 web-view 白名单
        const chk = (u) => {
          u = String(u || '').trim();
          if (!u) return '';
          if (!/^https:\/\//i.test(u)) throw new Error('链接必须以 https:// 开头');
          return u.slice(0, 200);
        };
        try {
          bc.uaUrl = chk(body.uaUrl);
          bc.privacyUrl = chk(body.privacyUrl);
        } catch (e) { return sendJson(res, 400, { ok: false, error: e.message }); }
        db.save('adminconfig', bc);
        return sendJson(res, 200, { ok: true, data: { uaUrl: bc.uaUrl, privacyUrl: bc.privacyUrl } });
      }
    }

    /* 操作日志（仅超管）：支持按操作人/模块/日期筛选（工作留痕追溯） */
    if (p === '/api/admin/audit' && req.method === 'GET') {
      const fUser = url.searchParams.get('user') || '';
      const fModule = url.searchParams.get('module') || '';
      const fDay = url.searchParams.get('day') || ''; // YYYY-MM-DD（北京时间）
      const limit = Math.min(parseInt(url.searchParams.get('limit'), 10) || 200, 1000);
      let list = db.load('audit', []);
      if (fUser) list = list.filter((a) => a.user === fUser);
      if (fModule) list = list.filter((a) => (a.path || '').replace('/api/admin/', '').split('/')[0] === fModule);
      if (fDay) {
        list = list.filter((a) => new Date(a.ts + 8 * 3600000).toISOString().slice(0, 10) === fDay);
      }
      return sendJson(res, 200, { ok: true, data: list.slice(-limit).reverse() });
    }

    /* 题目批量导入（Excel 前端解析后提交 JSON） */
    if (req.method === 'POST' && p === '/api/admin/questions/import') {
      const body = await readBody(req);
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) return sendJson(res, 400, { ok: false, error: '没有可导入的数据' });
      if (items.length > 500) return sendJson(res, 400, { ok: false, error: '单次最多导入 500 题' });
      const list = db.load('questions', []);
      let nextNum = list.reduce((mx, q) => Math.max(mx, parseInt(String(q.id).replace(/\D/g, ''), 10) || 0), 0) + 1;
      const failed = [];
      let done = 0;
      const VALID_TYPES = ['pic_choice', 'choice', 'sentence_order', 'speaking'];
      items.forEach((it, idx) => {
        const row = idx + 2; // Excel 行号（含表头）
        if (!VALID_TYPES.includes(it.type)) return failed.push({ row, error: '题型无效：' + it.type });
        if (!it.text && it.type !== 'sentence_order') return failed.push({ row, error: '缺少题干' });
        const id = 'q' + nextNum;
        const q = {
          id,
          type: it.type,
          title: it.title || '',
          stem: { text: it.text || '', jyut: it.jyut || '' },
          status: it.status === 'published' ? 'published' : 'draft',
          version: 1,
          text: it.text || '',
          jyut: it.jyut || '',
          hasAudio: false,
          stats: { answerUsers: 0, attempts: 0, rate: 0, firstRate: 0, reviewRate: 0, avgMs: 0, skipRate: 0, repeatWrongRate: 0, optionDist: [0, 0, 0, 0], discrimination: '-', audioFailRate: '-', imgFailRate: '-', asrFailRate: '-' },
        };
        if (it.type === 'choice' || it.type === 'pic_choice') {
          const opts = ['a', 'b', 'c', 'd']
            .map((k, i2) => ({ id: k, text: (it['option' + 'ABCD'[i2]] || '').trim(), label: (it['option' + 'ABCD'[i2]] || '').trim() }))
            .filter((o) => o.text);
          if (opts.length < 2) return failed.push({ row, error: '至少需要 2 个选项' });
          q.options = opts;
          q.answer = String(it.answer || 'a').toLowerCase();
          if (!opts.some((o) => o.id === q.answer)) return failed.push({ row, error: '正确答案超出选项范围' });
        }
        if (it.type === 'sentence_order') {
          const tokens = String(it.tokens || '').split('/').map((t) => t.trim()).filter(Boolean);
          if (tokens.length < 2) return failed.push({ row, error: '组句题需至少 2 个词块（用 / 分隔）' });
          q.tokens = tokens.map((t) => ({ text: t, jyut: '' }));
          q.distractors = String(it.distractors || '').split('/').map((t) => t.trim()).filter(Boolean).map((t) => ({ text: t, jyut: '' }));
          q.prompt = it.prompt || '';
          q.stem.text = tokens.join('');
          q.text = q.stem.text;
        }
        if (it.type === 'speaking') q.subtype = it.subtype || '跟读单词';
        list.push(q);
        nextNum += 1;
        done += 1;
      });
      db.save('questions', list);
      return sendJson(res, 200, { ok: true, data: { done, failed } });
    }

    /* 用量监控：本地埋点 + 腾讯云账单/CDN 流量（云端失败不影响本地数据） */
    if (req.method === 'GET' && p === '/api/admin/usage') {
      const logs = db.load('logs', []);
      const results = db.load('results', []);
      const day0 = new Date();
      day0.setHours(0, 0, 0, 0);
      const t0 = day0.getTime();
      const t7 = t0 - 6 * 86400000;
      const cnt = (arr, from) => arr.filter((x) => (x.ts || 0) >= from).length;
      const assessLogs = logs.filter((l) => l.event === 'speaking_assess');
      const asrErrs = logs.filter((l) => l.event === 'asr_error');
      let audioFiles = 0;
      let audioBytes = 0;
      try {
        fs.readdirSync(AUDIO_DIR).forEach((f) => {
          audioFiles += 1;
          audioBytes += fs.statSync(path.join(AUDIO_DIR, f)).size;
        });
      } catch (e) { /* 目录不存在则为 0 */ }
      const local = {
        assess: { today: cnt(assessLogs, t0), week: cnt(assessLogs, t7), total: assessLogs.length, failed: asrErrs.length },
        tts: { files: audioFiles, sizeMB: Math.round((audioBytes / 1048576) * 10) / 10 },
        results: { today: cnt(results, t0), week: cnt(results, t7), total: results.length },
        logs: { total: logs.length },
      };

      /* 云端数据：账单按产品汇总 + CDN 本月流量（协作者若无财务权限则单项降级） */
      const sec = db.load('secrets');
      const cloud = { bill: null, billError: '', cdn: null, cdnError: '' };
      /* 配额进度（总量/已用）：默认值可被 config.quotas 覆盖 */
      const cfg = db.load('config') || {};
      const quotas = Object.assign(
        { ttsChars: 8000000, asrMonthly: 5000, cdnPkgGB: 1024, vodPkgGB: 1024, cosGB: 50 },
        cfg.quotas || {}
      );
      const monthStart0 = new Date();
      monthStart0.setDate(1);
      monthStart0.setHours(0, 0, 0, 0);
      const tM = monthStart0.getTime();
      const ttsCalls = logs.filter((l) => l.event === 'tts_call');
      const asrMonthCount = logs.filter((l) => (l.event === 'speaking_assess' || l.event === 'asr_error') && (l.ts || 0) >= tM).length;
      const quota = {
        tts: { label: 'TTS 合成字符（免费资源包）', used: ttsCalls.reduce((s, l) => s + (l.chars || 0), 0), total: quotas.ttsChars, unit: '字符' },
        asr: { label: 'ASR 识别次数（本月）', used: asrMonthCount, total: quotas.asrMonthly, unit: '次' },
        cdn: { label: 'CDN 流量包', used: 0, total: quotas.cdnPkgGB * 1024, unit: 'MB' },
        vod: { label: 'VOD 流量包', used: 0, total: quotas.vodPkgGB * 1024, unit: 'MB' },
        cos: { label: 'COS 存储空间', used: 0, total: quotas.cosGB * 1024, unit: 'MB' },
        svr: { label: '服务器月流量包', used: 0, total: 0, unit: 'MB', pending: true },
      };
      if (sec && sec.tencent) {
        const { secretId, secretKey } = sec.tencent;
        const now = new Date();
        const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const monthStart = `${ym}-01 00:00:00`;
        const monthEnd = `${ym}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')} 23:59:59`;
        const [billR, cdnR, lhR, vodR, cosR] = await Promise.allSettled([
          tcRequest({
            secretId, secretKey, service: 'billing', host: 'billing.tencentcloudapi.com',
            action: 'DescribeBillSummaryByProduct', version: '2018-07-09', region: 'ap-guangzhou',
            payloadObj: { BeginTime: monthStart, EndTime: monthEnd },
          }),
          tcRequest({
            secretId, secretKey, service: 'cdn', host: 'cdn.tencentcloudapi.com',
            action: 'DescribeCdnData', version: '2018-06-06', region: 'ap-guangzhou',
            payloadObj: { StartTime: monthStart, EndTime: monthEnd, Metric: 'flux', Interval: 'day' },
          }),
          tcRequest({
            secretId, secretKey, service: 'lighthouse', host: 'lighthouse.tencentcloudapi.com',
            action: 'DescribeInstancesTrafficPackages', version: '2020-03-24', region: 'ap-guangzhou',
            payloadObj: {},
          }),
          tcRequest({
            secretId, secretKey, service: 'vod', host: 'vod.tencentcloudapi.com',
            action: 'DescribeCDNUsageData', version: '2018-07-17', region: 'ap-guangzhou',
            payloadObj: { StartTime: `${ym}-01T00:00:00+08:00`, EndTime: `${monthEnd.slice(0, 10)}T23:59:59+08:00`, DataType: 'Flux' },
          }),
          cosListUsage(secretId, secretKey, COS_HOST),
        ]);
        if (billR.status === 'fulfilled') {
          cloud.bill = (billR.value.SummaryOverview || []).map((x) => ({
            name: x.BusinessCodeName,
            cost: x.RealTotalCost,
            ratio: x.RealTotalCostRatio,
          }));
        } else cloud.billError = billR.reason.message;
        if (cdnR.status === 'fulfilled') {
          let flux = 0;
          (cdnR.value.Data || []).forEach((d) => (d.CdnData || []).forEach((m) => {
            if (m.Metric === 'flux') (m.DetailData || []).forEach((pt) => (flux += pt.Value || 0));
          }));
          cloud.cdn = { monthFluxMB: Math.round(flux / 1048576) };
          quota.cdn.used = Math.round(flux / 1048576);
        } else cloud.cdnError = cdnR.reason.message;
        if (lhR.status === 'fulfilled') {
          const pkgs = [];
          (lhR.value.InstanceTrafficPackageSet || []).forEach((i) => (i.TrafficPackageSet || []).forEach((pk) => pkgs.push(pk)));
          if (pkgs.length) {
            quota.svr.total = Math.round(pkgs.reduce((s, pk) => s + (pk.TrafficPackageTotal || 0), 0) / 1048576);
            quota.svr.used = Math.round(pkgs.reduce((s, pk) => s + (pk.TrafficUsed || 0), 0) / 1048576);
            quota.svr.pending = false;
          }
        } else quota.svr.error = lhR.reason.message;
        if (vodR.status === 'fulfilled') {
          const vFlux = (vodR.value.Data || []).reduce((s, d) => s + (d.Value || 0), 0);
          quota.vod.used = Math.round(vFlux / 1048576);
        } else quota.vod.error = vodR.reason.message;
        if (cosR.status === 'fulfilled') {
          quota.cos.used = Math.round((cosR.value.bytes / 1048576) * 100) / 100;
          quota.cos.objects = cosR.value.objects;
        } else quota.cos.error = cosR.reason.message;
      }
      return sendJson(res, 200, { ok: true, data: { local, cloud, quota, ts: Date.now() } });
    }

    /* 备份监控：GET 查状态列表；POST 立即手动备份（仅超管，见 ROLE_SCOPES 无 backup 段自动挡住其他角色） */
    if (p === '/api/admin/backup') {
      if (req.method === 'GET') {
        const logs = db.load('backupLogs', []);
        const data = { ...backupStatus(), lastAuto: logs.filter((l) => l.trigger === 'auto' && !l.error).slice(-1)[0] || null, recent: logs.slice(-10).reverse(), cos: { enabled: false, count: 0, totalSize: 0, latest: null, keepDays: COS_BACKUP_KEEP_DAYS } };
        // COS 异地备份状态（云端失败降级，不影响本地状态）
        try {
          const sec = db.load('secrets');
          if (sec && sec.tencent) {
            const objs = await cosListPrefix(sec.tencent.secretId, sec.tencent.secretKey, COS_HOST, 'backups/');
            objs.sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
            data.cos = {
              enabled: true, count: objs.length,
              totalSize: objs.reduce((s, o) => s + o.size, 0),
              latest: objs[0] ? { name: objs[0].key.replace('backups/', ''), size: objs[0].size, ts: new Date(objs[0].lastModified).getTime() } : null,
              keepDays: COS_BACKUP_KEEP_DAYS,
            };
          }
        } catch (e) { data.cos.error = String(e.message || e).slice(0, 80); }
        return sendJson(res, 200, { ok: true, data });
      }
      if (req.method === 'POST') {
        try {
          const r = await runBackup('manual');
          return sendJson(res, 200, { ok: true, data: r });
        } catch (e) {
          db.append('backupLogs', [{ name: '', size: 0, trigger: 'manual', error: String(e.message || e).slice(0, 120), ts: Date.now() }], 1000);
          return sendJson(res, 500, { ok: false, error: '备份失败：' + String(e.message || e).slice(0, 100) });
        }
      }
    }

    /* ===== 约课模块（管理端） ===== */

    /* 教师档案：含腾讯会议个人会议室（PMI）固定链接 */
    if (p === '/api/admin/teachers') {
      if (req.method === 'GET') return sendJson(res, 200, { ok: true, data: db.load('teachers', []) });
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return sendJson(res, 400, { ok: false, error: '老师姓名必填' });
        const list = db.load('teachers', []);
        list.push({
          id: 't' + Date.now().toString(36),
          name: String(body.name).slice(0, 20),
          pmiUrl: String(body.pmiUrl || '').slice(0, 120),
          pmiCode: String(body.pmiCode || '').slice(0, 20),
          status: 'on', createdAt: Date.now(),
        });
        db.save('teachers', list);
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const list = db.load('teachers', []);
        const t = list.find((x) => x.id === body.id);
        if (!t) return sendJson(res, 404, { ok: false, error: '老师不存在' });
        if (body.name) t.name = String(body.name).slice(0, 20);
        if (body.pmiUrl !== undefined) t.pmiUrl = String(body.pmiUrl).slice(0, 120);
        if (body.pmiCode !== undefined) t.pmiCode = String(body.pmiCode).slice(0, 20);
        if (body.status) t.status = body.status === 'off' ? 'off' : 'on';
        db.save('teachers', list);
        return sendJson(res, 200, { ok: true });
      }
    }

    /* 排班：教务批量加时段（自动冲突检测）/ 查看 / 删除空闲时段 */
    /* 约课设置（教务，挂 schedule 段复用权限）：提前几天开放预约。GET 读 / POST 存并即时重排 */
    if (p === '/api/admin/schedule/config') {
      if (req.method === 'GET') {
        return sendJson(res, 200, { ok: true, data: { bookAheadDays: bookAheadDays() } });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const n = parseInt(body.bookAheadDays, 10);
        if (!(n >= 1 && n <= 90)) return sendJson(res, 400, { ok: false, error: '提前天数需在 1~90 之间' });
        const bc = db.load('adminconfig', {});
        bc.bookAheadDays = n;
        db.save('adminconfig', bc);
        rollGenerate(true); // 窗口变化后立即按新窗重排（补齐或不再新增）
        db.append('audit', [{ user: session.username, name: session.name, role: session.role, method: 'POST', path: '/api/admin/schedule/config', detail: `bookAheadDays=${n}`, ts: Date.now() }], 100000);
        return sendJson(res, 200, { ok: true, data: { bookAheadDays: n } });
      }
    }

    if (p === '/api/admin/schedule') {
      if (req.method === 'GET') {
        const teachers = db.load('teachers', []);
        const from = url.searchParams.get('from') || '';
        const to = url.searchParams.get('to') || '9999';
        const data = db.load('schedule', [])
          .filter((sl) => sl.date >= from && sl.date <= to)
          .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
          .map((sl) => ({ ...sl, teacherName: (teachers.find((t) => t.id === sl.teacherId) || {}).name || '?' }));
        return sendJson(res, 200, { ok: true, data });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const { teacherId, date, slots } = body; // slots: [{start,end}]
        if (!teacherId || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !Array.isArray(slots) || !slots.length) {
          return sendJson(res, 400, { ok: false, error: '参数不完整' });
        }
        const schedule = db.load('schedule', []);
        const added = [];
        const skipped = [];
        slots.forEach((s) => {
          if (!/^\d{2}:\d{2}$/.test(s.start) || !/^\d{2}:\d{2}$/.test(s.end) || s.start >= s.end) return skipped.push(`${s.start}-${s.end} 格式错误`);
          if (teacherConflict(teacherId, date, s.start, s.end)) return skipped.push(`${s.start}-${s.end} 与已有时段冲突`);
          const slot = { id: 'sl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), teacherId, date, start: s.start, end: s.end, status: 'open' };
          schedule.push(slot);
          added.push(slot.id);
        });
        db.save('schedule', schedule);
        return sendJson(res, 200, { ok: true, data: { added: added.length, skipped } });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const schedule = db.load('schedule', []);
        const sl = schedule.find((x) => x.id === id);
        if (!sl) return sendJson(res, 404, { ok: false, error: '时段不存在' });
        if (sl.status === 'booked') return sendJson(res, 400, { ok: false, error: '该时段已被预约，请先取消对应约课' });
        db.save('schedule', schedule.filter((x) => x.id !== id));
        return sendJson(res, 200, { ok: true });
      }
    }

    /* 约课管理：列表 / 状态操作（取消、补录完成） */
    if (p === '/api/admin/bookings') {
      if (req.method === 'GET') {
        const users = db.load('users', []);
        const data = db.load('bookings', [])
          .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))
          .slice(0, 300)
          .map((b) => {
            const u = users.find((x) => x.uid === b.uid) || {};
            return { ...b, phone: u.phone || '', avatar: u.avatar || '' };
          });
        return sendJson(res, 200, { ok: true, data });
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const bookings = db.load('bookings', []);
        const bk = bookings.find((x) => x.id === body.id);
        if (!bk) return sendJson(res, 404, { ok: false, error: '约课不存在' });
        if (body.action === 'cancel' && bk.status === 'booked') {
          bk.status = 'cancelled';
          bk.cancelledAt = Date.now();
          const schedule = db.load('schedule', []);
          const sl = schedule.find((x) => x.id === bk.slotId);
          if (sl) { sl.status = 'open'; delete sl.bookingId; }
          db.save('schedule', schedule);
        } else if (body.action === 'done' && bk.status === 'booked') {
          bk.status = 'done';
          bk.doneAt = Date.now();
          bk.consumed = consumeLesson(bk.uid, `1对1课程 ${bk.date} ${bk.start}（教务确认）`, session.username);
        } else {
          return sendJson(res, 400, { ok: false, error: '当前状态不支持该操作' });
        }
        db.save('bookings', bookings);
        return sendJson(res, 200, { ok: true });
      }
      /* 补录系统外课程（线下/其他渠道）：直接生成已完成记录并消课 */
      if (req.method === 'POST') {
        const body = await readBody(req);
        const user = db.load('users', []).find((u) => String(u.studentNo) === String(body.studentNo));
        if (!user) return sendJson(res, 404, { ok: false, error: '学号不存在' });
        const teacher = db.load('teachers', []).find((t) => t.id === body.teacherId) || {};
        const bookings = db.load('bookings', []);
        const bk = {
          id: 'bk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          slotId: '', teacherId: body.teacherId || '', teacherName: teacher.name || String(body.teacherName || '外部'),
          uid: user.uid, studentNo: user.studentNo,
          date: body.date, start: body.start || '00:00', end: body.end || '00:00',
          status: 'done', external: true, note: String(body.note || '').slice(0, 100),
          createdAt: Date.now(), doneAt: Date.now(),
        };
        bk.consumed = consumeLesson(user.uid, `补录课程 ${bk.date}（${bk.note || '系统外'}）`, session.username);
        bookings.unshift(bk);
        db.save('bookings', bookings);
        return sendJson(res, 200, { ok: true, data: { consumed: bk.consumed } });
      }
    }

    /* 课时包：开包 / 调整 / 列表 / 流水 */
    if (p === '/api/admin/packs') {
      if (req.method === 'GET') {
        const users = db.load('users', []);
        const packs = db.load('packs', []);
        // 按学生聚合
        const byUid = {};
        packs.forEach((pk) => {
          const g = (byUid[pk.uid] = byUid[pk.uid] || { packs: [] });
          g.packs.push(pk);
        });
        const data = Object.keys(byUid).map((uid) => {
          const u = users.find((x) => x.uid === uid) || {};
          return { uid, studentNo: u.studentNo || '', phone: u.phone || '', ...packSummary(uid), packs: byUid[uid].packs };
        }).sort((a, b) => String(a.studentNo).localeCompare(String(b.studentNo)));
        return sendJson(res, 200, { ok: true, data });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const user = db.load('users', []).find((u) => String(u.studentNo) === String(body.studentNo));
        if (!user) return sendJson(res, 404, { ok: false, error: '学号不存在（学生需先登录小程序注册）' });
        const total = parseInt(body.total, 10);
        if (!total || total < 1 || total > 500) return sendJson(res, 400, { ok: false, error: '课时数需为 1-500' });
        const months = parseInt(body.months, 10) || 12;
        const packs = db.load('packs', []);
        const pk = {
          id: 'pk' + Date.now().toString(36),
          uid: user.uid, studentNo: user.studentNo,
          total, used: 0,
          expireAt: Date.now() + months * 30 * 86400000,
          note: String(body.note || '').slice(0, 60),
          createdBy: session.username, createdAt: Date.now(),
        };
        packs.push(pk);
        db.save('packs', packs);
        db.append('packLogs', [{ uid: user.uid, packId: pk.id, type: 'grant', n: total, note: pk.note, by: session.username, ts: Date.now() }], 200000);
        return sendJson(res, 200, { ok: true, data: pk });
      }
      if (req.method === 'PUT') {
        // 调整：delta 正=赠课/冲正，负=扣减
        const body = await readBody(req);
        const user = db.load('users', []).find((u) => String(u.studentNo) === String(body.studentNo));
        if (!user) return sendJson(res, 404, { ok: false, error: '学号不存在' });
        const delta = parseInt(body.delta, 10) || 0;
        if (!delta) return sendJson(res, 400, { ok: false, error: '调整数不能为 0' });
        let okFlag = true;
        if (delta > 0) {
          for (let i = 0; i < delta; i++) refundLesson(user.uid, body.note || '教务调增', session.username);
        } else {
          for (let i = 0; i < -delta; i++) okFlag = consumeLesson(user.uid, body.note || '教务调减', session.username) && okFlag;
        }
        if (!okFlag) return sendJson(res, 400, { ok: false, error: '剩余课时不足，部分扣减未执行' });
        return sendJson(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && p === '/api/admin/packs/logs') {
      const studentNo = url.searchParams.get('studentNo') || '';
      const user = db.load('users', []).find((u) => String(u.studentNo) === String(studentNo));
      if (!user) return sendJson(res, 404, { ok: false, error: '学号不存在' });
      const logs = db.load('packLogs', []).filter((l) => l.uid === user.uid).slice(-100).reverse();
      return sendJson(res, 200, { ok: true, data: logs });
    }

    /* 图片代理（批改画布合成用：规避 canvas 跨域污染；仅限自有资源域名） */
    if (req.method === 'GET' && p === '/api/admin/imgproxy') {
      const target = url.searchParams.get('url') || '';
      if (!/^https:\/\/(res\.fla\.wang|yy\.fla\.wang|canto-res-1385268704\.cos\.ap-guangzhou\.myqcloud\.com)\//.test(target)) {
        return sendJson(res, 400, { ok: false, error: '仅允许代理自有资源' });
      }
      https.get(target, (up) => {
        res.writeHead(up.statusCode || 200, { 'Content-Type': up.headers['content-type'] || 'image/jpeg' });
        up.pipe(res);
      }).on('error', () => sendJson(res, 502, { ok: false, error: '拉取失败' }));
      return;
    }

    /* ===== 课后作业（管理端） ===== */

    if (p === '/api/admin/homework') {
      if (req.method === 'GET') {
        const users = db.load('users', []);
        const subs = db.load('submissions', []);
        const data = db.load('homeworks', [])
          .filter((h) => h.status !== 'off')
          .sort((a, b) => b.ts - a.ts)
          .map((hw) => {
            const targetCount = hw.targetType === 'class'
              ? users.filter((u) => (u.classTag || '') === hw.classTag).length
              : (hw.studentNos || []).length;
            const hwSubs = subs.filter((s) => s.hwId === hw.id);
            return {
              ...hw, targetCount,
              submitted: hwSubs.length,
              graded: hwSubs.filter((s) => s.status === 'graded').length,
            };
          });
        return sendJson(res, 200, { ok: true, data });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        if (!body.title) return sendJson(res, 400, { ok: false, error: '标题必填' });
        const hw = {
          id: 'hw' + Date.now().toString(36),
          title: String(body.title).slice(0, 60),
          content: String(body.content || '').slice(0, 1500),
          images: (Array.isArray(body.images) ? body.images : []).slice(0, 9),
          targetType: body.targetType === 'class' ? 'class' : 'students',
          classTag: String(body.classTag || '').slice(0, 4),
          studentNos: (Array.isArray(body.studentNos) ? body.studentNos : []).map(String).slice(0, 200),
          startAt: parseInt(body.startAt, 10) || Date.now(),
          endAt: parseInt(body.endAt, 10) || 0,
          remind: !!body.remind,
          createdBy: session.username, ts: Date.now(), status: 'on',
        };
        if (hw.targetType === 'class' && !hw.classTag) return sendJson(res, 400, { ok: false, error: '请选择学生分类' });
        if (hw.targetType === 'students' && !hw.studentNos.length) return sendJson(res, 400, { ok: false, error: '请填写学号' });
        const list = db.load('homeworks', []);
        list.unshift(hw);
        db.save('homeworks', list);
        return sendJson(res, 200, { ok: true, data: hw });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const list = db.load('homeworks', []);
        const hw = list.find((h) => h.id === id);
        if (!hw) return sendJson(res, 404, { ok: false, error: '作业不存在' });
        hw.status = 'off';
        db.save('homeworks', list);
        return sendJson(res, 200, { ok: true });
      }
    }

    /* 某作业的提交列表 */
    if (req.method === 'GET' && p === '/api/admin/homework/subs') {
      const hwId = url.searchParams.get('hwId');
      const users = db.load('users', []);
      const data = db.load('submissions', [])
        .filter((s) => s.hwId === hwId)
        .map((s) => {
          const u = users.find((x) => x.uid === s.uid) || {};
          return { ...s, phone: u.phone || '' };
        });
      return sendJson(res, 200, { ok: true, data });
    }

    /* 批改：分数+评语+批改图（base64 合成图 -> COS） */
    if (req.method === 'POST' && p === '/api/admin/homework/grade') {
      const body = await readBody(req);
      const subs = db.load('submissions', []);
      const sub = subs.find((s) => s.id === body.subId);
      if (!sub) return sendJson(res, 404, { ok: false, error: '提交记录不存在' });
      const sec = db.load('secrets');
      const markImages = [];
      const marks = (Array.isArray(body.markImages) ? body.markImages : []).slice(0, 6);
      for (const dataUrl of marks) {
        if (/^https:\/\//.test(dataUrl)) { markImages.push(dataUrl); continue; } // 未改动的原图直接保留
        const m = /^data:image\/(png|jpe?g);base64,(.+)$/.exec(dataUrl || '');
        if (!m) continue;
        const key = `/hw/mark/${sub.id}-${markImages.length}.jpg`;
        await cosPutObject(sec.tencent.secretId, sec.tencent.secretKey, COS_HOST, key, Buffer.from(m[2], 'base64'), 'image/jpeg');
        markImages.push(`${resBase()}${key}?t=${Date.now()}`);
      }
      sub.status = 'graded';
      sub.score = Math.max(0, Math.min(100, parseInt(body.score, 10) || 0));
      sub.comment = String(body.comment || '').slice(0, 500);
      sub.markImages = markImages;
      sub.gradedBy = session.username;
      sub.gradedAt = Date.now();
      db.save('submissions', subs);
      // 通知学生：作业已批改（站内红点 + 服务号增强）
      const ghw = db.load('homeworks', []).find((h) => h.id === sub.hwId);
      pushNotice(sub.uid, 'hw_graded', '作业已批改', `《${(ghw && ghw.title) || '作业'}》得分 ${sub.score} 分，快看看老师的批改`, sub.hwId, false);
      return sendJson(res, 200, { ok: true });
    }

    /* 学生分类标注（A/B/C，教材与作业按类匹配） */
    if (req.method === 'PUT' && p === '/api/admin/students/class') {
      const body = await readBody(req);
      const users = db.load('users', []);
      const u = users.find((x) => String(x.studentNo) === String(body.studentNo));
      if (!u) return sendJson(res, 404, { ok: false, error: '学号不存在' });
      u.classTag = ['A', 'B', 'C', ''].includes(body.tag) ? body.tag : '';
      db.save('users', users);
      return sendJson(res, 200, { ok: true });
    }

    /* 教材 PDF 上传：base64 -> 落盘 -> pdftoppm 逐页转图 -> 登记 */
    if (req.method === 'POST' && p === '/api/admin/material/upload') {
      const body = await readBody(req);
      const m = /^data:application\/pdf;base64,(.+)$/.exec(body.dataUrl || '');
      if (!m) return sendJson(res, 400, { ok: false, error: '请上传 PDF 文件' });
      const id = 'm' + Date.now().toString(36);
      const pdfDir = path.join(__dirname, 'data', 'materials');
      const outDir = path.join(__dirname, 'public', 'materials', id);
      fs.mkdirSync(pdfDir, { recursive: true });
      fs.mkdirSync(outDir, { recursive: true });
      const pdfPath = path.join(pdfDir, id + '.pdf');
      fs.writeFileSync(pdfPath, Buffer.from(m[1], 'base64'));
      try {
        await execFileP('pdftoppm', ['-jpeg', '-jpegopt', 'quality=80', '-scale-to', '1400', pdfPath, path.join(outDir, 'pg')]);
      } catch (e) {
        return sendJson(res, 500, { ok: false, error: 'PDF 转换失败：' + e.message.slice(0, 100) });
      }
      // pdftoppm 输出 pg-1.jpg / pg-01.jpg（页数不同补零位数不同），统一重命名为 page-N.jpg
      const files = fs.readdirSync(outDir).filter((f) => f.startsWith('pg-')).sort();
      files.forEach((f) => {
        const n = parseInt(f.replace(/^pg-0*/, ''), 10);
        fs.renameSync(path.join(outDir, f), path.join(outDir, `page-${n}.jpg`));
      });
      const mats = db.load('materials', []);
      const mat = {
        id, name: String(body.name || 'unnamed').slice(0, 60), pages: files.length, createdAt: Date.now(),
        category: ['A', 'B', 'C'].includes(body.category) ? body.category : '',
        order: parseInt(body.order, 10) || 99,
        chapterCount: parseInt(body.chapterCount, 10) || 0,
        unlockChapter: parseInt(body.unlockChapter, 10) || 0,
      };
      mats.unshift(mat);
      db.save('materials', mats);
      return sendJson(res, 200, { ok: true, data: mat });
    }

    /* 教材属性更新（分类/顺序/章节/解锁规则） */
    if (req.method === 'PUT' && p === '/api/admin/material/meta') {
      const body = await readBody(req);
      const mats = db.load('materials', []);
      const mt = mats.find((x) => x.id === body.id);
      if (!mt) return sendJson(res, 404, { ok: false, error: '教材不存在' });
      if (body.name) mt.name = String(body.name).slice(0, 60);
      if (body.category !== undefined) mt.category = ['A', 'B', 'C'].includes(body.category) ? body.category : '';
      if (body.order !== undefined) mt.order = parseInt(body.order, 10) || 99;
      if (body.chapterCount !== undefined) mt.chapterCount = parseInt(body.chapterCount, 10) || 0;
      if (body.unlockChapter !== undefined) mt.unlockChapter = parseInt(body.unlockChapter, 10) || 0;
      db.save('materials', mats);
      return sendJson(res, 200, { ok: true });
    }

    /* 教材删除（移除记录 + 清理 PDF、页图目录、关联批注文件；仅超管/教务） */
    if (req.method === 'POST' && p === '/api/admin/material/delete') {
      const body = await readBody(req);
      const id = String(body.id || '');
      const mats = db.load('materials', []);
      const mt = mats.find((x) => x.id === id);
      if (!mt) return sendJson(res, 404, { ok: false, error: '教材不存在' });
      db.save('materials', mats.filter((x) => x.id !== id));
      // 清理物理文件（best-effort，不因单项失败中断）
      try { fs.rmSync(path.join(__dirname, 'data', 'materials', id + '.pdf'), { force: true }); } catch (e) { /* noop */ }
      try { fs.rmSync(path.join(__dirname, 'public', 'materials', id), { recursive: true, force: true }); } catch (e) { /* noop */ }
      // 清理该教材所有频道的批注文件（anno_{id} 及 anno_{id}{uid}）
      try {
        const prefix = 'anno_' + id.replace(/[^a-z0-9]/gi, '');
        fs.readdirSync(db.DATA_DIR)
          .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
          .forEach((f) => { try { fs.rmSync(path.join(db.DATA_DIR, f), { force: true }); } catch (e) { /* noop */ } });
      } catch (e) { /* noop */ }
      db.append('audit', [{ user: session.username, name: session.name, role: session.role, method: 'POST', path: '/api/admin/material/delete', detail: `id=${id} name=${mt.name}`, ts: Date.now() }], 100000);
      return sendJson(res, 200, { ok: true });
    }

    /* 学生清单（学号+姓名/昵称+手机，供后台各处「选择学生」下拉/弹窗，含搜索） */
    if (req.method === 'GET' && p === '/api/admin/students/list') {
      const kw = (url.searchParams.get('kw') || '').trim().toLowerCase();
      let list = db.load('users', [])
        .filter((u) => u.studentNo) // 只列已注册（有学号）的学生
        .map((u) => ({
          uid: u.uid,
          studentNo: u.studentNo,
          nickname: u.nickname || '',
          phone: u.phone ? u.phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2') : '',
          className: u.className || '',
        }));
      if (kw) list = list.filter((s) => String(s.studentNo).includes(kw) || s.nickname.toLowerCase().includes(kw));
      list.sort((a, b) => String(a.studentNo).localeCompare(String(b.studentNo)));
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* 出勤考核（教务/超管，挂 students 段）：按学生汇总出勤率/缺勤、打卡天数 */
    if (req.method === 'GET' && p === '/api/admin/attendance') {
      const users = db.load('users', []);
      const bookings = db.load('bookings', []).filter((b) => b.status === 'done');
      const byUid = {};
      bookings.forEach((b) => {
        const g = (byUid[b.uid] = byUid[b.uid] || { present: 0, leave: 0, absent: 0, none: 0 });
        const a = b.attend || 'none';
        if (a === 'present') g.present += 1; else if (a === 'leave') g.leave += 1; else if (a === 'absent') g.absent += 1; else g.none += 1;
      });
      const rows = users.filter((u) => u.studentNo).map((u) => {
        const g = byUid[u.uid] || { present: 0, leave: 0, absent: 0, none: 0 };
        const counted = g.present + g.leave + g.absent;
        const ck = (u.checkin || {});
        return {
          studentNo: u.studentNo, nickname: u.nickname || '',
          present: g.present, leave: g.leave, absent: g.absent, pending: g.none,
          totalDone: counted + g.none,
          rate: counted ? Math.round((g.present / counted) * 100) : 0,
          checkinTotal: ck.total || 0, checkinStreak: ck.streak || 0,
        };
      }).filter((r) => r.totalDone > 0 || r.checkinTotal > 0)
        .sort((a, b) => a.rate - b.rate); // 出勤率低的置顶，便于关注
      return sendJson(res, 200, { ok: true, data: rows });
    }

    /* 学生教材进度（老师标注：学到第几本第几章 -> 驱动自动解锁） */
    if (req.method === 'PUT' && p === '/api/admin/students/matprog') {
      const body = await readBody(req);
      const users = db.load('users', []);
      const u = users.find((x) => String(x.studentNo) === String(body.studentNo));
      if (!u) return sendJson(res, 404, { ok: false, error: '学号不存在' });
      u.matBook = Math.max(1, parseInt(body.matBook, 10) || 1);
      u.matChapter = Math.max(1, parseInt(body.matChapter, 10) || 1);
      db.save('users', users);
      return sendJson(res, 200, { ok: true });
    }

    /* 教材列表（老师批注页选择用） */
    if (req.method === 'GET' && p === '/api/admin/materials') {
      return sendJson(res, 200, { ok: true, data: db.load('materials', []) });
    }

    /* 教师端：我的课表（按会话绑定的 teacherId 过滤；未绑定则返回空引导） */
    if (req.method === 'GET' && p === '/api/admin/my/schedule') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 200, { ok: true, data: { bound: false, bookings: [], slots: [], pendingNotes: 0 } });
      const teachers = db.load('teachers', []);
      const t = teachers.find((x) => x.id === tid) || {};
      const now = Date.now();
      const notes = db.load('notes', []);
      let pendingNotes = 0;
      const bookings = db.load('bookings', [])
        .filter((b) => b.teacherId === tid && b.status !== 'cancelled')
        .sort((a, b) => slotTs(b.date, b.start) - slotTs(a.date, a.start))
        .slice(0, 100)
        .map((b) => {
          const done = b.status === 'done' || slotTs(b.date, b.end) < now;
          // 待补笔记：课已结束，但课后（endTs 之后）老师没给该生发过专属笔记
          const endTs = slotTs(b.date, b.end);
          const hasNote = notes.some((n) => n.teacherId === tid && n.uid === b.uid && n.ts >= endTs);
          const needNote = done && b.status !== 'cancelled' && !hasNote;
          if (needNote) pendingNotes += 1;
          return {
            id: b.id, date: b.date, start: b.start, end: b.end,
            studentNo: b.studentNo, uid: b.uid, status: b.status,
            upcoming: b.status === 'booked' && endTs >= now,
            needNote,
          };
        });
      const slots = db.load('schedule', [])
        .filter((sl) => sl.teacherId === tid && sl.status === 'open' && slotTs(sl.date, sl.start) > now)
        .sort((a, b) => slotTs(a.date, a.start) - slotTs(b.date, b.start))
        .map((sl) => ({ id: sl.id, date: sl.date, start: sl.start, end: sl.end }));
      return sendJson(res, 200, { ok: true, data: { bound: true, teacherName: t.name || '', pmiUrl: t.pmiUrl || '', pmiCode: t.pmiCode || '', acceptBooking: t.acceptBooking !== false, bookings, slots, pendingNotes } });
    }

    /* 教师端：接受约课总开关（关闭后学生约不到该老师任何时段，已约不受影响） */
    if (req.method === 'POST' && p === '/api/admin/my/accept') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 400, { ok: false, error: '账号未绑定授课老师' });
      const body = await readBody(req);
      const teachers = db.load('teachers', []);
      const t = teachers.find((x) => x.id === tid);
      if (!t) return sendJson(res, 404, { ok: false, error: '老师不存在' });
      t.acceptBooking = !!body.accept;
      db.save('teachers', teachers);
      return sendJson(res, 200, { ok: true, data: { acceptBooking: t.acceptBooking } });
    }

    /* 教师端：我的排课规则（GET 列表 / POST 新增并立即展开 / DELETE 删除+清未约时段） */
    if (p === '/api/admin/my/rules') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 400, { ok: false, error: '账号未绑定授课老师' });
      if (req.method === 'GET') {
        const rules = db.load('scheduleRules', []).filter((r) => r.teacherId === tid)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return sendJson(res, 200, { ok: true, data: rules });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        const mode = b.mode === 'free' ? 'free' : 'rule';
        if (!/^\d{2}:\d{2}$/.test(b.start || '') || !/^\d{2}:\d{2}$/.test(b.end || '') || b.start >= b.end) {
          return sendJson(res, 400, { ok: false, error: '时段格式错误（如 10:00-11:00）' });
        }
        const rule = {
          id: 'rl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          teacherId: tid, mode, start: b.start, end: b.end,
          weekdays: mode === 'rule' ? (Array.isArray(b.weekdays) ? b.weekdays.map(Number).filter((n) => n >= 0 && n <= 6) : []) : [],
          date: mode === 'free' ? String(b.date || '') : '',
          startDate: String(b.startDate || ymd(Date.now())),
          endType: ['none', 'count', 'date'].includes(b.endType) ? b.endType : 'none',
          count: parseInt(b.count, 10) || 0, endDate: String(b.endDate || ''),
          generated: 0, skipHoliday: b.skipHoliday !== false, status: 'on', createdAt: Date.now(),
        };
        if (mode === 'rule' && !rule.weekdays.length) return sendJson(res, 400, { ok: false, error: '请选择每周上课日' });
        if (mode === 'free' && !/^\d{4}-\d{2}-\d{2}$/.test(rule.date)) return sendJson(res, 400, { ok: false, error: '请选择上课日期' });
        const rules = db.load('scheduleRules', []);
        rules.push(rule);
        db.save('scheduleRules', rules);
        // 立即展开未来时段
        const schedule = db.load('schedule', []);
        const added = expandRule(rule, schedule, bookAheadDays());
        db.save('scheduleRules', rules); // expandRule 可能改了 generated/status
        db.save('schedule', schedule);
        return sendJson(res, 200, { ok: true, data: { id: rule.id, added } });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const rules = db.load('scheduleRules', []);
        const rule = rules.find((r) => r.id === id && r.teacherId === tid); // 归属校验，防越权
        if (!rule) return sendJson(res, 404, { ok: false, error: '规则不存在' });
        db.save('scheduleRules', rules.filter((r) => r.id !== id));
        // 清掉该规则生成的、尚未被约的 open 时段（已约的保留，不动学生的课）
        const schedule = db.load('schedule', []);
        db.save('schedule', schedule.filter((s) => !(s.fromRule === id && s.status === 'open')));
        return sendJson(res, 200, { ok: true });
      }
    }

    /* 教师端：休息时间（GET / POST 新增并清该时段未约 / DELETE） */
    if (p === '/api/admin/my/rest') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 400, { ok: false, error: '账号未绑定授课老师' });
      if (req.method === 'GET') {
        const list = db.load('teacherRest', []).filter((r) => r.teacherId === tid)
          .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
        return sendJson(res, 200, { ok: true, data: list });
      }
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !/^\d{2}:\d{2}$/.test(b.start || '') || !/^\d{2}:\d{2}$/.test(b.end || '') || b.start >= b.end) {
          return sendJson(res, 400, { ok: false, error: '日期或时段格式错误' });
        }
        const rest = { id: 'rs' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), teacherId: tid, date: b.date, start: b.start, end: b.end, note: String(b.note || '').slice(0, 50), createdAt: Date.now() };
        const list = db.load('teacherRest', []);
        list.push(rest);
        db.save('teacherRest', list);
        // 清掉落在休息时段内、未被约的 open 时段；已约的返回提示数
        const schedule = db.load('schedule', []);
        const conflictBooked = schedule.filter((s) => s.teacherId === tid && s.date === b.date && s.status === 'booked' && b.start < s.end && b.end > s.start);
        db.save('schedule', schedule.filter((s) => !(s.teacherId === tid && s.date === b.date && s.status === 'open' && b.start < s.end && b.end > s.start)));
        return sendJson(res, 200, { ok: true, data: { id: rest.id, bookedConflict: conflictBooked.length } });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const list = db.load('teacherRest', []);
        if (!list.find((r) => r.id === id && r.teacherId === tid)) return sendJson(res, 404, { ok: false, error: '休息时段不存在' });
        db.save('teacherRest', list.filter((r) => r.id !== id));
        return sendJson(res, 200, { ok: true });
      }
    }

    /* 教师端：自由排课单个时段（POST 加 / DELETE 删未约时段） */
    if (p === '/api/admin/my/slots') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 400, { ok: false, error: '账号未绑定授课老师' });
      if (req.method === 'POST') {
        const b = await readBody(req);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '') || !/^\d{2}:\d{2}$/.test(b.start || '') || !/^\d{2}:\d{2}$/.test(b.end || '') || b.start >= b.end) {
          return sendJson(res, 400, { ok: false, error: '日期或时段格式错误' });
        }
        if (slotTs(b.date, b.start) <= Date.now()) return sendJson(res, 400, { ok: false, error: '不能添加过去的时段' });
        if (teacherConflict(tid, b.date, b.start, b.end)) return sendJson(res, 400, { ok: false, error: '与已有时段冲突' });
        const schedule = db.load('schedule', []);
        const slot = { id: 'sl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), teacherId: tid, date: b.date, start: b.start, end: b.end, status: 'open' };
        schedule.push(slot);
        db.save('schedule', schedule);
        return sendJson(res, 200, { ok: true, data: { id: slot.id } });
      }
      if (req.method === 'DELETE') {
        const id = url.searchParams.get('id');
        const schedule = db.load('schedule', []);
        const sl = schedule.find((s) => s.id === id && s.teacherId === tid); // 归属校验
        if (!sl) return sendJson(res, 404, { ok: false, error: '时段不存在' });
        if (sl.status === 'booked') return sendJson(res, 400, { ok: false, error: '该时段已被学生预约，不能删除' });
        db.save('schedule', schedule.filter((s) => s.id !== id));
        return sendJson(res, 200, { ok: true });
      }
    }

    /* 教师端：周课表网格数据（?monday=YYYY-MM-DD 该周一；含已约课 booked/done + 开放空档 open） */
    if (req.method === 'GET' && p === '/api/admin/my/week') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 200, { ok: true, data: { days: [], items: [] } });
      let monday = url.searchParams.get('monday') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(monday)) {
        // 默认本周一
        const n = new Date(Date.now() + 8 * 3600000);
        const wd = n.getUTCDay() || 7; // 周日=7
        monday = ymd(Date.now() - (wd - 1) * 86400000);
      }
      const days = [];
      for (let i = 0; i < 7; i++) days.push(ymd(slotTs(monday, '00:00') + i * 86400000));
      const inWeek = (d) => d >= days[0] && d <= days[6];
      const users = db.load('users', []);
      const items = [];
      // 已约课（含已完成）
      db.load('bookings', []).filter((b) => b.teacherId === tid && b.status !== 'cancelled' && inWeek(b.date)).forEach((b) => {
        const u = users.find((x) => x.uid === b.uid) || {};
        items.push({ kind: 'booked', date: b.date, start: b.start, end: b.end, uid: b.uid, studentNo: b.studentNo, nickname: u.nickname || '', status: b.status, attend: b.attend || '' });
      });
      // 开放但未被约的空档
      db.load('schedule', []).filter((s) => s.teacherId === tid && s.status === 'open' && inWeek(s.date)).forEach((s) => {
        items.push({ kind: 'open', date: s.date, start: s.start, end: s.end });
      });
      return sendJson(res, 200, { ok: true, data: { monday, days, items } });
    }

    /* 教师端：今日课表（今天要上的课 + 点名态） */
    if (req.method === 'GET' && p === '/api/admin/my/today') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 200, { ok: true, data: [] });
      const today = ymd(Date.now());
      const users = db.load('users', []);
      const list = db.load('bookings', [])
        .filter((b) => b.teacherId === tid && b.date === today && b.status !== 'cancelled')
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((b) => {
          const u = users.find((x) => x.uid === b.uid) || {};
          return { id: b.id, start: b.start, end: b.end, uid: b.uid, studentNo: b.studentNo, nickname: u.nickname || '', status: b.status, attend: b.attend || (b.status === 'done' ? 'none' : ''), remain: packSummary(b.uid).remain };
        });
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* 教师端：点名（present 签到消课 / leave 请假不消 / absent 缺课消课；防重复消课） */
    if (req.method === 'POST' && p === '/api/admin/my/attend') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 400, { ok: false, error: '账号未绑定授课老师' });
      const b = await readBody(req);
      if (!['present', 'leave', 'absent'].includes(b.attend)) return sendJson(res, 400, { ok: false, error: '无效的点名类型' });
      const bookings = db.load('bookings', []);
      const bk = bookings.find((x) => x.id === b.id && x.teacherId === tid); // 归属校验，防越权点别人的名
      if (!bk) return sendJson(res, 404, { ok: false, error: '课程记录不存在' });
      if (bk.status === 'cancelled') return sendJson(res, 400, { ok: false, error: '已取消的课不能点名' });
      // 若之前点名已消课，改判时先退回再按新状态处理（简单起见：只在未扣时扣，不做退课）
      const prevDeducted = bk.deducted;
      bk.status = 'done';
      bk.attend = b.attend;
      bk.attendAt = Date.now();
      bk.attendBy = session.username;
      if ((b.attend === 'present' || b.attend === 'absent') && !prevDeducted) {
        // 签到、缺课都消课（缺课按机构惯例也扣课时）；请假不消
        bk.consumed = consumeLesson(bk.uid, `1对1课程 ${bk.date} ${bk.start}（${b.attend === 'present' ? '签到' : '缺课'}）`, session.username);
        bk.deducted = true;
      } else if (b.attend === 'leave') {
        bk.leaveMakeup = true; // 请假待补课
      }
      db.save('bookings', bookings);
      return sendJson(res, 200, { ok: true, data: { attend: bk.attend, deducted: !!bk.deducted, remain: packSummary(bk.uid).remain } });
    }

    /* 教师端：上课记录（区间统计 + 明细，默认本月） */
    if (req.method === 'GET' && p === '/api/admin/my/records') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 200, { ok: true, data: { stat: {}, list: [] } });
      const from = url.searchParams.get('from') || ymd(Date.now() - 30 * 86400000);
      const to = url.searchParams.get('to') || ymd(Date.now());
      const users = db.load('users', []);
      const rows = db.load('bookings', [])
        .filter((b) => b.teacherId === tid && b.status !== 'cancelled' && b.date >= from && b.date <= to)
        .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start));
      const stat = { total: rows.length, present: 0, leave: 0, absent: 0, pending: 0, consumed: 0 };
      const list = rows.map((b) => {
        const at = b.attend || (b.status === 'done' ? 'none' : 'booked');
        if (at === 'present') stat.present += 1;
        else if (at === 'leave') stat.leave += 1;
        else if (at === 'absent') stat.absent += 1;
        else if (at === 'none') stat.pending += 1;
        if (b.deducted) stat.consumed += 1;
        const u = users.find((x) => x.uid === b.uid) || {};
        return { id: b.id, date: b.date, start: b.start, end: b.end, studentNo: b.studentNo, nickname: u.nickname || '', attend: at, deducted: !!b.deducted };
      });
      return sendJson(res, 200, { ok: true, data: { stat, list, from, to } });
    }


    /* 教师端：我的学生（约过我课的学生去重，附课时余量） */
    if (req.method === 'GET' && p === '/api/admin/my/students') {
      const tid = session.teacherId;
      if (!tid) return sendJson(res, 200, { ok: true, data: [] });
      const users = db.load('users', []);
      const seen = {};
      db.load('bookings', []).filter((b) => b.teacherId === tid && b.status !== 'cancelled').forEach((b) => {
        if (!seen[b.uid]) seen[b.uid] = { uid: b.uid, studentNo: b.studentNo, lessons: 0, last: 0 };
        seen[b.uid].lessons += 1;
        seen[b.uid].last = Math.max(seen[b.uid].last, slotTs(b.date, b.start));
      });
      const list = Object.values(seen).map((s) => {
        const u = users.find((x) => x.uid === s.uid) || {};
        return { uid: s.uid, studentNo: s.studentNo, nickname: u.nickname || '', lessons: s.lessons, remain: packSummary(s.uid).remain, last: s.last };
      }).sort((a, b) => b.last - a.last);
      return sendJson(res, 200, { ok: true, data: list });
    }

    /* 教师端：某学生的课本（按学生分类匹配教材，标注当前在学册）+ 基本信息 */
    if (req.method === 'GET' && p === '/api/admin/my/student-books') {
      const uid = url.searchParams.get('uid') || '';
      const user = db.load('users', []).find((u) => u.uid === uid);
      if (!user) return sendJson(res, 404, { ok: false, error: '学生不存在' });
      const classTag = user.classTag || '';
      const curBook = parseInt(user.matBook, 10) || 1;
      const curChapter = parseInt(user.matChapter, 10) || 1;
      const books = db.load('materials', [])
        .filter((m) => !classTag || (m.category || 'A') === classTag)
        .sort((a, b) => (a.order || 99) - (b.order || 99))
        .map((m) => ({
          id: m.id, name: m.name, pages: m.pages,
          order: m.order || 0, category: m.category || 'A',
          current: (m.order || 0) === curBook, // 当前在学的课本
        }));
      return sendJson(res, 200, {
        ok: true,
        data: {
          uid, studentNo: user.studentNo || '', nickname: user.nickname || '',
          classTag, curBook, curChapter,
          remain: packSummary(uid).remain,
          books,
        },
      });
    }

    /* 批注操作（统一指令流）：type=stroke{page,s} / undo{target} / clear{page}；stu=uid 指定学生专属频道 */
    if (req.method === 'POST' && p === '/api/admin/material/op') {
      const body = await readBody(req);
      const id = String(body.id || '');
      if (!db.load('materials', []).find((x) => x.id === id)) return sendJson(res, 404, { ok: false, error: '教材不存在' });
      const chan = annoChan(id, body.stu || '');
      const anno = db.load(annoKey(chan), { seq: 0, items: [] });
      const type = body.type;
      const ck = annoKey(chan);
      // 实时进行中笔画（不落盘、不占 seq）：老师书写中增量推送，学生端秒级预览
      if (type === 'live') {
        const prev = annoLive.get(ck);
        if (body.start || !prev) {
          annoLive.set(ck, { page: parseInt(body.page, 10) || 1, pts: Array.isArray(body.seg) ? body.seg : [], c: body.c, w: body.w, mode: body.mode || 'pen', rev: (prev ? prev.rev : 0) + 1 });
        } else {
          if (Array.isArray(body.seg)) prev.pts = prev.pts.concat(body.seg);
          if (prev.pts.length > 5000) prev.pts = prev.pts.slice(-5000);
          prev.page = parseInt(body.page, 10) || prev.page;
          prev.rev += 1;
        }
        annoNotify(chan);
        return sendJson(res, 200, { ok: true, rev: annoLive.get(ck).rev });
      }
      if (!['stroke', 'undo', 'clear', 'text'].includes(type)) return sendJson(res, 400, { ok: false, error: '未知操作' });
      anno.seq += 1;
      const item = { seq: anno.seq, type, page: parseInt(body.page, 10) || 1, by: session.username, ts: Date.now() };
      if (type === 'stroke') item.s = body.s; // {c,w,mode,pts:[[x,y],...]}
      if (type === 'text' && body.t) item.t = { x: body.t.x, y: body.t.y, text: String(body.t.text || '').slice(0, 200), c: body.t.c, size: body.t.size }; // 文字批注（归一化坐标）
      if (type === 'undo') item.target = parseInt(body.target, 10) || 0;
      anno.items.push(item);
      if (anno.items.length > 20000) anno.items = anno.items.slice(-20000);
      db.save(annoKey(chan), anno);
      // 正式笔画落地：清空该频道进行中的 live，避免与正式笔画重影
      const lv = annoLive.get(ck);
      if (lv && lv.pts.length) { lv.pts = []; lv.rev += 1; }
      annoNotify(chan); // 唤醒长轮询等待者（学生端秒级收到）
      return sendJson(res, 200, { ok: true, seq: anno.seq });
    }

    /* 批注管理式删除：清空某教材某频道（学生）的全部批注（老师/超管撤回） */
    if (req.method === 'POST' && p === '/api/admin/material/anno-reset') {
      const body = await readBody(req);
      const id = String(body.id || '');
      const chan = annoChan(id, body.stu || '');
      // 追加一条全局 clear-all 指令（回放时清空该频道所有页），保持 append-only 且可被学生端增量感知
      const anno = db.load(annoKey(chan), { seq: 0, items: [] });
      anno.seq += 1;
      anno.items.push({ seq: anno.seq, type: 'clearAll', by: session.username, ts: Date.now() });
      if (anno.items.length > 20000) anno.items = anno.items.slice(-20000);
      db.save(annoKey(chan), anno);
      annoNotify(chan);
      db.append('audit', [{ user: session.username, name: session.name, role: session.role, method: 'POST', path: '/api/admin/material/anno-reset', detail: `id=${id} stu=${body.stu || '(公共)'}`, ts: Date.now() }], 100000);
      return sendJson(res, 200, { ok: true, seq: anno.seq });
    }

    /* 课堂笔记：老师发布（notes 段，teacher rw）/ 列表按 teacherId 或学生 */
    if (p === '/api/admin/notes') {
      if (req.method === 'GET') {
        const forUid = url.searchParams.get('uid') || '';
        const tid = session.teacherId || url.searchParams.get('teacherId') || '';
        let list = db.load('notes', []);
        if (forUid) list = list.filter((n) => n.uid === forUid || n.uid === '');
        else if (tid && session.role !== 'super') list = list.filter((n) => n.teacherId === tid);
        list = list.sort((a, b) => b.ts - a.ts).slice(0, 200);
        return sendJson(res, 200, { ok: true, data: list });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const title = String(body.title || '').trim().slice(0, 60);
        if (!title) return sendJson(res, 400, { ok: false, error: '笔记标题必填' });
        const notes = db.load('notes', []);
        const note = {
          id: 'nt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          teacherId: session.teacherId || '',
          teacherName: session.name || '',
          uid: String(body.uid || ''),          // 空 = 发给全体（公开笔记）
          studentNo: String(body.studentNo || ''),
          title,
          text: String(body.text || '').slice(0, 2000),
          images: Array.isArray(body.images) ? body.images.slice(0, 20) : [],
          ts: Date.now(),
        };
        notes.unshift(note);
        if (notes.length > 50000) notes.length = 50000;
        db.save('notes', notes);
        return sendJson(res, 200, { ok: true, data: { id: note.id } });
      }
    }
    const mNote = p.match(/^\/api\/admin\/notes\/([\w-]+)$/);
    if (mNote && req.method === 'DELETE') {
      db.save('notes', db.load('notes', []).filter((n) => n.id !== mNote[1]));
      return sendJson(res, 200, { ok: true });
    }

    /* 图片上传：base64 -> COS（题图/封面等） */
    if (req.method === 'POST' && p === '/api/admin/upload/image') {
      const body = await readBody(req);
      const m = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/.exec(body.dataUrl || '');
      if (!m) return sendJson(res, 400, { ok: false, error: '图片格式不支持（png/jpg/gif/webp）' });
      const sec = db.load('secrets');
      if (!sec || !sec.tencent) return sendJson(res, 500, { ok: false, error: '服务器未配置云 API 密钥' });
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 5 * 1024 * 1024) return sendJson(res, 400, { ok: false, error: '图片超过 5MB' });
      const key = `/img/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await cosPutObject(sec.tencent.secretId, sec.tencent.secretKey, COS_HOST, key, buf, `image/${m[1]}`);
      return sendJson(res, 200, { ok: true, data: { url: resBase() + key } });
    }

    /* 静态资源 */
    if (req.method === 'GET' && !p.startsWith('/api/')) {
      if (p === '/') {
        res.writeHead(302, { Location: '/admin/' });
        return res.end();
      }
      return serveStatic(req, res, p);
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`[canto-server] running at http://127.0.0.1:${PORT}`);
  console.log(`[canto-server] admin console: http://127.0.0.1:${PORT}/admin/`);
});
