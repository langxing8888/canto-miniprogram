/**
 * 粤语学习后台 · 管理端（已接入后端 API）
 * 数据读写走 /api/admin/*，由 server/app.js 提供，存储于服务器 JSON 数据库
 */

/* ============ 数据层（REST API + Token 鉴权） ============ */
const API_BASE = '';

/* 题型元数据（题库/统计渲染用的功能常量，与业务数据无关） */
const TYPE_META = {
  pic_choice: { label: '图片选择题', color: '#1cb0f6' },
  choice: { label: '文字选择题', color: '#58cc02' },
  sentence_order: { label: '选词组句', color: '#ff9600' },
  speaking: { label: 'AI纠音题', color: '#ce82ff' },
};

function getToken() {
  return sessionStorage.getItem('cantoToken') || '';
}

async function api(path, method = 'GET', body) {
  const res = await fetch(API_BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && path !== '/api/admin/login') {
    showLogin();
    throw new Error('登录已过期，请重新登录');
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || '请求失败');
  return json.data;
}

/* ============ 登录 ============ */
function showLogin() {
  document.getElementById('loginMask').classList.remove('hidden');
  const lay = document.getElementById('appLayout');
  if (lay) lay.classList.add('hidden'); // 未登录/登出：隐藏后台，只留登录页
}

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  if (!username || !password) return toast('请输入账号和密码');
  const btn = document.getElementById('loginBtn');
  btn.textContent = '登录中…';
  try {
    const data = await api('/api/admin/login', 'POST', { username, password });
    // 授课老师没有管理后台权限，引导去教师工作台
    if (data.role === 'tutor') {
      btn.textContent = '登 录';
      if (confirm('你是「授课老师」账号，请使用教师工作台。是否现在前往？')) location.href = '/teacher/';
      return;
    }
    sessionStorage.setItem('cantoToken', data.token);
    sessionStorage.setItem('cantoRole', data.role || 'super');
    sessionStorage.setItem('cantoName', data.name || data.username || '管理员');
    document.getElementById('loginMask').classList.add('hidden');
    document.getElementById('appLayout').classList.remove('hidden'); // 登录成功才显示后台
    toast(`欢迎回来，${data.name || data.username}！`);
    applyRole();
    await bootData();
  } catch (e) {
    toast(e.message);
  }
  btn.textContent = '登 录';
}

/* ============ 主题切换（日间 / 夜间） ============ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  localStorage.setItem('cantoTheme', theme);
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}
// 启动即应用（避免闪烁）
applyTheme(localStorage.getItem('cantoTheme') || 'light');

// 启动即加载后台外观（登录页与侧栏 logo/标题）
loadBranding();

/* ============ 超管身份下拉 ============ */
function toggleAdminMenu(e) {
  e.stopPropagation();
  document.getElementById('adminMenu').classList.toggle('open');
}
document.addEventListener('click', () => {
  const m = document.getElementById('adminMenu');
  if (m) m.classList.remove('open');
});

/* ============ 退出登录 ============ */
function logoutAdmin() {
  if (!confirm('确定退出后台登录？')) return;
  sessionStorage.removeItem('cantoToken');
  sessionStorage.removeItem('cantoRole');
  sessionStorage.removeItem('cantoName');
  sessionStorage.removeItem('previewRole');
  location.reload(); // 刷新后自动弹出登录页
}

/* ============ 小程序版本开关（超管） ============ */
async function loadAppConfig() {
  try {
    const cfg = await api('/api/admin/settings/appconfig');
    document.getElementById('cfgVersionSwitch').checked = !!cfg.versionSwitch;
  } catch (e) { /* 非超管忽略 */ }
}

async function saveAppConfig() {
  const on = document.getElementById('cfgVersionSwitch').checked;
  try {
    await api('/api/admin/settings/appconfig', 'PUT', { versionSwitch: on });
    toast(on ? '已开启双版本选择（小程序下次启动生效）' : '已关闭，全员学员版');
  } catch (e) {
    toast(e.message);
    loadAppConfig();
  }
}

/* ============ 后台外观 · Logo / 名称 ============ */
let brandingCache = { logo: '', title: '粤语学习后台', subtitle: '教务管理平台' };

/** 把外观应用到侧栏 + 登录页（logo 有图用图，无图用「粤」字块） */
function applyBranding(b) {
  brandingCache = Object.assign(brandingCache, b || {});
  const logo = brandingCache.logo;
  const title = brandingCache.title || '粤语学习后台';
  const subtitle = brandingCache.subtitle || '教务管理平台';
  const logoHtml = logo ? `<img src="${logo}" alt="logo">` : '粤';
  const set = (id, html, isText) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isText) { el.textContent = html; return; }
    el.innerHTML = html;
    el.classList.toggle('has-logo', !!logo); // 有图 = 去掉橙底/阴影，透明承托
  };
  set('sideLogo', logoHtml);
  set('sideTitle', title, true);
  set('sideSubtitle', subtitle, true);
  set('loginLogo', logoHtml);
  set('loginTitle', title + ' · 管理后台', true);
  document.title = title + ' · 后台管理';
}

async function loadBranding() {
  try {
    const b = await api('/api/admin/branding');
    applyBranding(b);
    const t = document.getElementById('brandTitle'); if (t) t.value = b.title || '';
    const s = document.getElementById('brandSubtitle'); if (s) s.value = b.subtitle || '';
    const prev = document.getElementById('brandPreview');
    if (prev) setBrandPreview(b.logo);
    const rb = document.getElementById('brandResetBtn'); if (rb) rb.style.display = b.logo ? '' : 'none';
  } catch (e) { /* 公开接口，忽略 */ }
}

/** 预览框：有 logo 去橙底显示图，无 logo 显示「粤」字 */
function setBrandPreview(logo) {
  const prev = document.getElementById('brandPreview');
  if (!prev) return;
  prev.innerHTML = logo ? `<img src="${logo}" style="width:100%;height:100%;object-fit:contain;border-radius:inherit">` : '粤';
  prev.classList.toggle('has-logo', !!logo);
}

// Logo 文件选择 -> 上传 COS -> 预览
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('brandLogoFile');
  if (inp) inp.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 500 * 1024) return toast('Logo 请控制在 500KB 内');
    const rd = new FileReader();
    rd.onload = async () => {
      try {
        toast('上传中…');
        let url = rd.result;
        // SVG 直接内联 dataURL；位图走 COS
        if (file.type !== 'image/svg+xml') {
          const d = await api('/api/admin/upload/image', 'POST', { dataUrl: rd.result });
          url = d.url;
        }
        brandingCache.logo = url;
        setBrandPreview(url);
        document.getElementById('brandResetBtn').style.display = '';
        toast('已上传，点「保存外观」生效');
      } catch (err) { toast('上传失败：' + err.message); }
    };
    rd.readAsDataURL(file);
  });
});

function resetBrandLogo() {
  brandingCache.logo = '';
  setBrandPreview('');
  document.getElementById('brandResetBtn').style.display = 'none';
  toast('已清除，点「保存外观」生效');
}

async function saveBranding() {
  const title = document.getElementById('brandTitle').value.trim();
  const subtitle = document.getElementById('brandSubtitle').value.trim();
  try {
    const b = await api('/api/admin/settings/branding', 'PUT', { logo: brandingCache.logo || '', title, subtitle });
    applyBranding(b);
    toast('外观已保存并生效');
  } catch (e) { toast(e.message); }
}

/* ============ 协议链接（超管） ============ */
async function loadLegal() {
  try {
    const d = await api('/api/admin/settings/legal');
    const ua = document.getElementById('uaUrl'); if (ua) ua.value = d.uaUrl || '';
    const pv = document.getElementById('privacyUrl'); if (pv) pv.value = d.privacyUrl || '';
  } catch (e) { /* 非超管忽略 */ }
}

async function saveLegal() {
  const uaUrl = document.getElementById('uaUrl').value.trim();
  const privacyUrl = document.getElementById('privacyUrl').value.trim();
  try {
    await api('/api/admin/settings/legal', 'PUT', { uaUrl, privacyUrl });
    toast('协议链接已保存（小程序下次启动生效）');
  } catch (e) { toast(e.message); }
}

/* ============ 题库列表音频试听（共享单个播放器） ============ */
let rowAudio = null;
let rowAudioEl = null;

function playRowAudio(el) {
  const src = el.dataset.src;
  if (!rowAudio) {
    rowAudio = new Audio();
    rowAudio.onended = () => {
      if (rowAudioEl) rowAudioEl.classList.remove('playing');
      rowAudioEl = null;
    };
    rowAudio.onerror = () => {
      toast('音频加载失败');
      if (rowAudioEl) rowAudioEl.classList.remove('playing');
      rowAudioEl = null;
    };
  }
  // 再点同一个 = 停止
  if (rowAudioEl === el && !rowAudio.paused) {
    rowAudio.pause();
    el.classList.remove('playing');
    rowAudioEl = null;
    return;
  }
  if (rowAudioEl) rowAudioEl.classList.remove('playing');
  rowAudioEl = el;
  el.classList.add('playing');
  rowAudio.src = src + '?t=' + Date.now();
  rowAudio.play().catch(() => {
    toast('播放失败，请重试');
    el.classList.remove('playing');
    rowAudioEl = null;
  });
}

/* ============ 约课管理（约课/排班/教师/课时包） ============ */
let teacherCache = [];

/* Tab 级角色可见性（与后端 ROLE_SCOPES 对齐，避免点开即 403） */
const BK_TAB_ROLES = {
  bookings: ['super', 'teacher', 'finance'],
  schedule: ['super', 'teacher'],
  teachers: ['super', 'teacher'],
  packs: ['super', 'teacher', 'finance'],
  homework: ['super', 'teacher'],
  mats: ['super', 'teacher', 'editor'],
};

function switchBkTab(el) {
  document.querySelectorAll('.bk-tab').forEach((t) => t.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.bk-pane').forEach((p) => p.classList.add('hidden'));
  document.getElementById('bk-' + el.dataset.bk).classList.remove('hidden');
  const loaders = { bookings: loadBookings, schedule: loadSchedule, teachers: loadTeachers, packs: loadPacks, homework: loadHomework, mats: loadMats };
  loaders[el.dataset.bk]();
}

function loadBookingPage() {
  const role = myRole();
  let first = null;
  document.querySelectorAll('.bk-tab').forEach((t) => {
    const ok = (BK_TAB_ROLES[t.dataset.bk] || []).includes(role);
    t.style.display = ok ? '' : 'none';
    if (ok && !first) first = t;
  });
  if (first) switchBkTab(first);
}

async function loadTeacherCache() {
  try {
    teacherCache = await api('/api/admin/teachers');
  } catch (e) { teacherCache = []; }
}

const BK_STATUS = { booked: '<span class="status-dot published">已预约</span>', done: '<span class="status-dot" style="color:#8a94a3">已完成</span>', cancelled: '<span class="status-dot draft">已取消</span>' };

async function loadBookings() {
  try {
    await loadTeacherCache();
    const rows = (await api('/api/admin/bookings')).map((b) => `<tr>
      <td>${b.date}${b.external ? ' <span class="stu-guest">补录</span>' : ''}</td>
      <td>${b.start}-${b.end}</td>
      <td><b>${b.studentNo || '?'}</b>${b.phone ? ' · ' + b.phone : ''}</td>
      <td>${b.teacherName}</td>
      <td>${BK_STATUS[b.status] || b.status}</td>
      <td>${b.status === 'done' ? (b.consumed ? '✓ 已消课' : '<span style="color:#e5342e">未消课(课时不足)</span>') : '—'}</td>
      <td>${b.status === 'booked' ? `<span class="op-link" onclick="bookingAction('${b.id}','done')">确认完成</span>
        <span class="op-link del" onclick="bookingAction('${b.id}','cancel')">取消</span>` : ''}</td>
    </tr>`).join('');
    document.getElementById('bookingRows').innerHTML = rows || '<tr><td colspan="7" style="color:#8a94a3">暂无约课记录</td></tr>';
  } catch (e) { toast(e.message); }
}

async function bookingAction(id, action) {
  if (action === 'cancel' && !confirm('取消该预约？时段将重新开放')) return;
  if (action === 'done' && !confirm('确认该课程已完成？将自动消课 1 节')) return;
  try {
    await api('/api/admin/bookings', 'PUT', { id, action });
    toast('操作成功');
    loadBookings();
  } catch (e) { toast(e.message); }
}

async function openOfflineModal() {
  // 填充老师下拉
  await loadTeacherCache();
  const sel = document.getElementById('ofTeacher');
  sel.innerHTML = teacherCache.length
    ? teacherCache.map((t) => `<option value="${t.id}">${t.name}</option>`).join('')
    : '<option value="">（暂无老师，可留空）</option>';
  // 重置字段
  document.getElementById('ofStudentNo').value = '';
  document.getElementById('ofStudentNo_txt').textContent = '选择学生';
  document.getElementById('ofStudentNo_txt').classList.remove('has');
  document.getElementById('ofDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('ofNote').value = '';
  document.getElementById('offlineMask').classList.remove('hidden');
}

function closeOffline() { document.getElementById('offlineMask').classList.add('hidden'); }

async function submitOffline() {
  const studentNo = document.getElementById('ofStudentNo').value.trim();
  if (!studentNo) return toast('请选择学生');
  const date = document.getElementById('ofDate').value;
  if (!date) return toast('请选择上课日期');
  const note = document.getElementById('ofNote').value.trim() || '线下补录';
  const teacherId = document.getElementById('ofTeacher').value || (teacherCache[0] ? teacherCache[0].id : '');
  try {
    const r = await api('/api/admin/bookings', 'POST', { studentNo, date, teacherId, note });
    toast(r.data.consumed ? '补录成功，已消课 1 节' : '补录成功，但该生课时不足未消课');
    closeOffline();
    loadBookings();
  } catch (e) { toast(e.message); }
}

/* ================= 通用学生选择器（学号/姓名搜索 + 网格单/多选） ================= */
let stuPickerCache = [];      // 学生清单缓存
let stuPickerTarget = '';     // 目标 hidden input id（或特殊标记）
let stuPickerMulti = false;   // 是否多选
let stuPickerSel = new Set();  // 已选 studentNo

async function openStudentPicker(targetId, multi) {
  stuPickerTarget = targetId;
  stuPickerMulti = !!multi;
  stuPickerSel = new Set();
  // 预填：已选值回显（逗号分隔）
  const hid = document.getElementById(targetId);
  if (hid && hid.value) hid.value.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => stuPickerSel.add(s));
  document.getElementById('stuPickerTitle').textContent = multi ? '选择学生（可多选）' : '选择学生';
  document.getElementById('stuPickerSearch').value = '';
  document.getElementById('stuPickerOk').style.display = multi ? '' : 'none'; // 单选点击即选，无需确定
  document.getElementById('stuPickerMask').classList.remove('hidden');
  document.getElementById('stuPickerGrid').innerHTML = '<div class="stu-empty">加载中…</div>';
  try {
    stuPickerCache = await api('/api/admin/students/list');
  } catch (e) {
    stuPickerCache = [];
    document.getElementById('stuPickerGrid').innerHTML = '<div class="stu-empty">加载失败：' + e.message + '</div>';
    return;
  }
  renderStuPicker();
}

function renderStuPicker() {
  const kw = (document.getElementById('stuPickerSearch').value || '').trim().toLowerCase();
  let list = stuPickerCache;
  if (kw) list = list.filter((s) => String(s.studentNo).includes(kw) || (s.nickname || '').toLowerCase().includes(kw));
  const grid = document.getElementById('stuPickerGrid');
  if (!stuPickerCache.length) { grid.innerHTML = '<div class="stu-empty">暂无已注册学生</div>'; }
  else if (!list.length) { grid.innerHTML = '<div class="stu-empty">没有匹配的学生</div>'; }
  else {
    grid.innerHTML = list.map((s) => {
      const on = stuPickerSel.has(String(s.studentNo));
      const nm = s.nickname || '未设昵称';
      return `<div class="stu-cell${on ? ' on' : ''}" onclick="pickStu('${s.studentNo}')">
        <div class="stu-no">${s.studentNo}</div>
        <div class="stu-nm">${nm}</div>
        ${s.phone ? `<div class="stu-ph">${s.phone}</div>` : ''}
        ${on ? '<span class="stu-check">✓</span>' : ''}
      </div>`;
    }).join('');
  }
  const cnt = document.getElementById('stuPickerCount');
  cnt.textContent = stuPickerMulti && stuPickerSel.size ? `已选 ${stuPickerSel.size} 人` : '';
}

function pickStu(no) {
  no = String(no);
  if (stuPickerMulti) {
    if (stuPickerSel.has(no)) stuPickerSel.delete(no); else stuPickerSel.add(no);
    renderStuPicker();
  } else {
    stuPickerSel = new Set([no]);
    applyStuPicker(); // 单选：选中即应用并关闭
  }
}

function confirmStudentPicker() { applyStuPicker(); }

function applyStuPicker() {
  const nos = [...stuPickerSel];
  const target = stuPickerTarget;
  closeStudentPicker();
  const hid = document.getElementById(target);
  const txt = document.getElementById(target + '_txt');
  if (hid) hid.value = nos.join(',');
  if (txt) {
    if (!nos.length) { txt.textContent = stuPickerMulti ? '选择学生（可多选）' : '选择学生'; txt.classList.remove('has'); }
    else {
      const label = (no) => { const s = stuPickerCache.find((x) => String(x.studentNo) === no); return s ? `${no}${s.nickname ? ' ' + s.nickname : ''}` : no; };
      txt.textContent = nos.length === 1 ? label(nos[0]) : `${label(nos[0])} 等 ${nos.length} 人`;
      txt.classList.add('has');
    }
  }
}

function closeStudentPicker() { document.getElementById('stuPickerMask').classList.add('hidden'); }

/* ================= 时段选择器（一天整点时段，多选，排班用） ================= */
const DAY_SLOTS = [];
for (let h = 8; h < 22; h++) DAY_SLOTS.push(`${String(h).padStart(2, '0')}:00-${String(h + 1).padStart(2, '0')}:00`); // 08:00-09:00 … 21:00-22:00
let slotSel = new Set();

function openSlotPicker() {
  slotSel = new Set();
  const hid = document.getElementById('schSlots');
  if (hid && hid.value) hid.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean).forEach((s) => slotSel.add(s));
  renderSlotPicker();
  document.getElementById('slotPickerMask').classList.remove('hidden');
}
function renderSlotPicker() {
  document.getElementById('slotPickerGrid').innerHTML = DAY_SLOTS.map((s) => {
    const on = slotSel.has(s);
    return `<div class="stu-cell${on ? ' on' : ''}" onclick="toggleSlot('${s}')"><div class="stu-no" style="font-size:13px">${s}</div>${on ? '<span class="stu-check">✓</span>' : ''}</div>`;
  }).join('');
  document.getElementById('slotPickerCount').textContent = slotSel.size ? `已选 ${slotSel.size} 个时段` : '';
}
function toggleSlot(s) { if (slotSel.has(s)) slotSel.delete(s); else slotSel.add(s); renderSlotPicker(); }
function confirmSlotPicker() {
  const arr = [...slotSel].sort();
  const hid = document.getElementById('schSlots');
  const txt = document.getElementById('schSlots_txt');
  if (hid) hid.value = arr.join(', ');
  if (txt) {
    if (arr.length) { txt.textContent = arr.length <= 3 ? arr.join('、') : `${arr.slice(0, 3).join('、')} 等 ${arr.length} 个`; txt.classList.add('has'); }
    else { txt.textContent = '选择时段（可多选整点课）'; txt.classList.remove('has'); }
  }
  closeSlotPicker();
}
function closeSlotPicker() { document.getElementById('slotPickerMask').classList.add('hidden'); }

/* ---- 排班 ---- */
async function loadSchedule() {
  await loadTeacherCache();
  document.getElementById('schTeacher').innerHTML = teacherCache
    .filter((t) => t.status === 'on')
    .map((t) => `<option value="${t.id}">${t.name}</option>`).join('') || '<option value="">请先添加教师</option>';
  if (!document.getElementById('schDate').value) {
    document.getElementById('schDate').value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  }
  // 载入约课设置（提前几天开放预约）
  try {
    const cfg = await api('/api/admin/schedule/config');
    document.getElementById('bkAheadDays').value = cfg.bookAheadDays;
  } catch (e) { /* 忽略 */ }
  try {
    const today = new Date().toISOString().slice(0, 10);
    const rows = (await api('/api/admin/schedule?from=' + today)).map((sl) => `<tr>
      <td>${sl.date}</td><td>${sl.start}-${sl.end}</td><td>${sl.teacherName}</td>
      <td>${sl.status === 'open' ? '<span class="status-dot published">可预约</span>' : '<span class="status-dot" style="color:#1467ff">已被约</span>'}</td>
      <td>${sl.status === 'open' ? `<span class="op-link del" onclick="delSlot('${sl.id}')">删除</span>` : ''}</td>
    </tr>`).join('');
    document.getElementById('scheduleRows').innerHTML = rows || '<tr><td colspan="5" style="color:#8a94a3">近期暂无排班</td></tr>';
  } catch (e) { toast(e.message); }
}

async function addSchedule() {
  const teacherId = document.getElementById('schTeacher').value;
  const date = document.getElementById('schDate').value;
  const raw = document.getElementById('schSlots').value.trim();
  if (!teacherId || !date || !raw) return toast('请选择老师、日期并填写时段');
  const slots = raw.split(/[,，]/).map((s) => {
    const m = /^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(s);
    return m ? { start: m[1].padStart(5, '0'), end: m[2].padStart(5, '0') } : null;
  }).filter(Boolean);
  if (!slots.length) return toast('时段格式：10:00-11:00, 15:00-16:00');
  try {
    const r = await api('/api/admin/schedule', 'POST', { teacherId, date, slots });
    toast(`已添加 ${r.added} 个时段${r.skipped.length ? '；跳过：' + r.skipped.join('、') : ''}`);
    document.getElementById('schSlots').value = '';
    const st = document.getElementById('schSlots_txt');
    if (st) { st.textContent = '选择时段（可多选整点课）'; st.classList.remove('has'); }
    loadSchedule();
  } catch (e) { toast(e.message); }
}

async function delSlot(id) {
  try {
    await api('/api/admin/schedule?id=' + id, 'DELETE');
    loadSchedule();
  } catch (e) { toast(e.message); }
}

/* 保存约课设置：提前几天开放预约 */
async function saveBookingConfig() {
  const n = parseInt(document.getElementById('bkAheadDays').value, 10);
  if (!(n >= 1 && n <= 90)) return toast('请输入 1~90 之间的天数');
  try {
    await api('/api/admin/schedule/config', 'POST', { bookAheadDays: n });
    toast(`已设置：学生可预约未来 ${n} 天内的时段`);
    loadSchedule();
  } catch (e) { toast(e.message); }
}

/* ---- 教师 ---- */
async function loadTeachers() {
  await loadTeacherCache();
  const rows = teacherCache.map((t) => `<tr>
    <td><b>${t.name}</b></td>
    <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis">${t.pmiUrl || '<span style="color:#e5342e">未录入</span>'}</td>
    <td>${t.pmiCode || '—'}</td>
    <td>${t.status === 'on' ? '<span class="status-dot published">在职</span>' : '<span class="status-dot draft">停用</span>'}</td>
    <td>
      <span class="op-link" onclick="editTeacherPmi('${t.id}')">改会议链接</span>
      <span class="op-link ${t.status === 'on' ? 'del' : ''}" onclick="toggleTeacher('${t.id}','${t.status === 'on' ? 'off' : 'on'}')">${t.status === 'on' ? '停用' : '启用'}</span>
    </td>
  </tr>`).join('');
  document.getElementById('teacherRows').innerHTML = rows || '<tr><td colspan="5" style="color:#8a94a3">暂无教师</td></tr>';
}

async function addTeacher() {
  const name = document.getElementById('tchName').value.trim();
  if (!name) return toast('请填写老师姓名');
  try {
    await api('/api/admin/teachers', 'POST', {
      name,
      pmiUrl: document.getElementById('tchPmiUrl').value.trim(),
      pmiCode: document.getElementById('tchPmiCode').value.trim(),
    });
    toast('已添加');
    ['tchName', 'tchPmiUrl', 'tchPmiCode'].forEach((id) => (document.getElementById(id).value = ''));
    loadTeachers();
  } catch (e) { toast(e.message); }
}

async function editTeacherPmi(id) {
  const t = teacherCache.find((x) => x.id === id);
  const pmiUrl = prompt('个人会议链接：', t.pmiUrl || '');
  if (pmiUrl === null) return;
  const pmiCode = prompt('会议号：', t.pmiCode || '');
  if (pmiCode === null) return;
  try {
    await api('/api/admin/teachers', 'PUT', { id, pmiUrl: pmiUrl.trim(), pmiCode: pmiCode.trim() });
    toast('已更新');
    loadTeachers();
  } catch (e) { toast(e.message); }
}

async function toggleTeacher(id, status) {
  try {
    await api('/api/admin/teachers', 'PUT', { id, status });
    loadTeachers();
  } catch (e) { toast(e.message); }
}

/* ---- 课时包 ---- */
async function loadPacks() {
  try {
    const rows = (await api('/api/admin/packs')).map((g) => `<tr>
      <td><b>${g.studentNo || '?'}</b></td>
      <td>${g.phone || '—'}</td>
      <td>${g.total}</td>
      <td>${g.used}</td>
      <td style="color:${g.remain <= 3 ? '#e5342e' : '#12a150'};font-weight:700">${g.remain}</td>
      <td>${g.expireAt ? new Date(g.expireAt).toLocaleDateString() : '—'}</td>
      <td><span class="op-link" onclick="showPackLogs('${g.studentNo}')">流水</span></td>
    </tr>`).join('');
    document.getElementById('packRows').innerHTML = rows || '<tr><td colspan="7" style="color:#8a94a3">暂无课时包，用上方表单开通</td></tr>';
  } catch (e) { toast(e.message); }
}

async function grantPack() {
  const studentNo = document.getElementById('pkStudentNo').value.trim();
  const total = document.getElementById('pkTotal').value;
  if (!studentNo || !total) return toast('请填写学号与课时数');
  try {
    await api('/api/admin/packs', 'POST', {
      studentNo, total,
      months: document.getElementById('pkMonths').value || 12,
      note: document.getElementById('pkNote').value.trim(),
    });
    toast('课时包已开通');
    loadPacks();
  } catch (e) { toast(e.message); }
}

async function adjustPack(delta) {
  const studentNo = document.getElementById('pkStudentNo').value.trim();
  if (!studentNo) return toast('请先在左侧填写学号');
  try {
    await api('/api/admin/packs', 'PUT', { studentNo, delta, note: document.getElementById('pkNote').value.trim() || (delta > 0 ? '教务调增' : '教务调减') });
    toast(delta > 0 ? '已 +1 节' : '已 -1 节');
    loadPacks();
  } catch (e) { toast(e.message); }
}

const PACK_LOG_TYPES = { grant: '开通', consume: '消课', refund: '退还/调增' };

async function showPackLogs(studentNo) {
  try {
    const logs = await api('/api/admin/packs/logs?studentNo=' + studentNo);
    alert(`学号 ${studentNo} 最近课时流水：\n\n` + (logs.map((l) =>
      `${new Date(l.ts).toLocaleString()}  ${PACK_LOG_TYPES[l.type] || l.type} ${l.n} 节  ${l.note || ''}（${l.by}）`).join('\n') || '暂无记录'));
  } catch (e) { toast(e.message); }
}

/* ---- 课后作业 ---- */
function hwTargetSwitch() {
  const isClass = document.getElementById('hwTargetType').value === 'class';
  document.getElementById('hwStudentNos_pick').classList.toggle('hidden', isClass);
  document.getElementById('hwClassTag').classList.toggle('hidden', !isClass);
}

async function publishHomework() {
  const title = document.getElementById('hwTitle').value.trim();
  if (!title) return toast('请填写作业标题');
  const targetType = document.getElementById('hwTargetType').value;
  const days = parseInt(document.getElementById('hwDays').value, 10);
  const payload = {
    title,
    content: document.getElementById('hwContent').value.trim(),
    targetType,
    classTag: document.getElementById('hwClassTag').value,
    studentNos: document.getElementById('hwStudentNos').value.split(/[,，\s]+/).filter(Boolean),
    startAt: Date.now(),
    endAt: days ? Date.now() + days * 86400000 : 0,
    remind: document.getElementById('hwRemind').checked,
  };
  try {
    await api('/api/admin/homework', 'POST', payload);
    toast('作业已发布');
    document.getElementById('hwTitle').value = '';
    document.getElementById('hwContent').value = '';
    loadHomework();
  } catch (e) { toast(e.message); }
}

async function loadHomework() {
  try {
    const rows = (await api('/api/admin/homework')).map((hw) => `<tr>
      <td><b>${hw.title}</b></td>
      <td>${hw.targetType === 'class' ? hw.classTag + ' 类（' + hw.targetCount + '人）' : hw.studentNos.join('、')}</td>
      <td>${hw.endAt ? new Date(hw.endAt).toLocaleDateString() : '不限'}</td>
      <td><b style="color:${hw.submitted ? '#1467ff' : '#8a94a3'}">${hw.submitted}</b>/${hw.targetCount} 交 · <b style="color:${hw.graded ? '#12a150' : '#8a94a3'}">${hw.graded}</b> 批</td>
      <td>${hw.createdBy}</td>
      <td>
        <span class="op-link" onclick="viewSubs('${hw.id}','${hw.title.replace(/'/g, '')}')">查看提交</span>
        <span class="op-link del" onclick="offHomework('${hw.id}')">下架</span>
      </td>
    </tr>`).join('');
    document.getElementById('hwRows').innerHTML = rows || '<tr><td colspan="6" style="color:#8a94a3">暂无作业，用上方表单发布</td></tr>';
  } catch (e) { toast(e.message); }
}

async function offHomework(id) {
  if (!confirm('下架该作业？学生端将不再显示')) return;
  await api('/api/admin/homework?id=' + id, 'DELETE');
  loadHomework();
}

/* 提交列表：展开为浮层列表 */
let currentSubs = [];

async function viewSubs(hwId, title) {
  try {
    currentSubs = await api('/api/admin/homework/subs?hwId=' + hwId);
    if (!currentSubs.length) return toast('暂无学生提交');
    const lines = currentSubs.map((s, i) =>
      `${i + 1}. 学号${s.studentNo}  ${s.status === 'graded' ? '已批改 ' + s.score + '分' : '待批改'}  图${(s.images || []).length}张  ${new Date(s.ts).toLocaleString()}`).join('\n');
    const pick = prompt(`「${title}」提交列表：\n${lines}\n\n输入序号打开批改：`, '1');
    const idx = parseInt(pick, 10) - 1;
    if (currentSubs[idx]) openGrade(currentSubs[idx]);
  } catch (e) { toast(e.message); }
}

/* ---- 图上批改（红笔 canvas） ---- */
let gradeSub = null;
let gradeIdx = 0;
let gradeInks = []; // 每张图的笔画 [{pts:[[x,y]...]}]
let gradeDrawing = null;

const gImg = () => document.getElementById('gradeImg');
const gCv = () => document.getElementById('gradeInk');

function openGrade(sub) {
  gradeSub = sub;
  gradeIdx = 0;
  gradeInks = (sub.images || []).map(() => []);
  document.getElementById('gradeTitle').textContent = `批改 · 学号 ${sub.studentNo}`;
  document.getElementById('gradeScore').value = sub.score || '';
  document.getElementById('gradeComment').value = sub.comment || '';
  document.getElementById('gradeText').textContent = sub.text ? '学生留言：' + sub.text : '';
  document.getElementById('gradeModal').classList.remove('hidden');
  loadGradeImg();
}

function loadGradeImg() {
  const imgs = gradeSub.images || [];
  document.getElementById('gradeImgInd').textContent = imgs.length ? `${gradeIdx + 1} / ${imgs.length}` : '无图片';
  if (!imgs.length) return;
  const img = gImg();
  img.onload = () => {
    const cv = gCv();
    cv.width = img.clientWidth * devicePixelRatio;
    cv.height = img.clientHeight * devicePixelRatio;
    cv.style.width = img.clientWidth + 'px';
    cv.style.height = img.clientHeight + 'px';
    gradeRedraw();
  };
  // 走同域代理，canvas 合成不受跨域污染限制
  img.src = '/api/admin/imgproxy?url=' + encodeURIComponent(imgs[gradeIdx]);
}

function gradeRedraw() {
  const cv = gCv();
  const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#e5342e';
  ctx.lineWidth = cv.width * 0.006;
  const paint = (pts) => {
    ctx.beginPath();
    pts.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt[0] * cv.width, pt[1] * cv.height) : ctx.lineTo(pt[0] * cv.width, pt[1] * cv.height)));
    ctx.stroke();
  };
  (gradeInks[gradeIdx] || []).forEach((s) => paint(s.pts));
  if (gradeDrawing) paint(gradeDrawing.pts);
}

function bindGradeInk() {
  const cv = gCv();
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };
  cv.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    gradeDrawing = { pts: [pos(e)] };
  });
  cv.addEventListener('pointermove', (e) => {
    if (!gradeDrawing) return;
    e.preventDefault();
    gradeDrawing.pts.push(pos(e));
    gradeRedraw();
  });
  const up = () => {
    if (!gradeDrawing) return;
    if (gradeDrawing.pts.length > 1) gradeInks[gradeIdx].push(gradeDrawing);
    gradeDrawing = null;
    gradeRedraw();
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
}
bindGradeInk();

function gradePrevImg() { if (gradeIdx > 0) { gradeIdx -= 1; loadGradeImg(); } }
function gradeNextImg() { if (gradeSub && gradeIdx < (gradeSub.images || []).length - 1) { gradeIdx += 1; loadGradeImg(); } }
function gradeClearInk() { gradeInks[gradeIdx] = []; gradeRedraw(); }

/** 合成批改图：底图 + 红笔层 -> jpeg dataURL（无笔迹的保留原 URL 省流量） */
async function composeMarkImages() {
  const imgs = gradeSub.images || [];
  const out = [];
  for (let i = 0; i < imgs.length; i++) {
    if (!(gradeInks[i] || []).length) { out.push(imgs[i]); continue; }
    const im = new Image();
    im.src = '/api/admin/imgproxy?url=' + encodeURIComponent(imgs[i]);
    await new Promise((ok, bad) => { im.onload = ok; im.onerror = bad; });
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth;
    cv.height = im.naturalHeight;
    const ctx = cv.getContext('2d');
    ctx.drawImage(im, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#e5342e';
    ctx.lineWidth = cv.width * 0.006;
    gradeInks[i].forEach((s) => {
      ctx.beginPath();
      s.pts.forEach((pt, j) => (j === 0 ? ctx.moveTo(pt[0] * cv.width, pt[1] * cv.height) : ctx.lineTo(pt[0] * cv.width, pt[1] * cv.height)));
      ctx.stroke();
    });
    out.push(cv.toDataURL('image/jpeg', 0.82));
  }
  return out;
}

async function saveGrade() {
  const score = document.getElementById('gradeScore').value;
  if (score === '') return toast('请填写分数');
  try {
    toast('正在合成批改图…');
    const markImages = await composeMarkImages();
    await api('/api/admin/homework/grade', 'POST', {
      subId: gradeSub.id, score,
      comment: document.getElementById('gradeComment').value.trim(),
      markImages,
    });
    toast('批改已保存');
    closeModal('gradeModal');
    loadHomework();
  } catch (e) { toast('保存失败：' + e.message); }
}

/* ---- 教材管理（分类/册序/自动解锁规则） ---- */
async function loadMats() {
  try {
    const rows = (await api('/api/admin/materials')).map((mt) => `<tr>
      <td><b>${mt.name}</b></td>
      <td>${mt.category ? mt.category + ' 类' : '<span style="color:#e5a11c">未分类</span>'}</td>
      <td>第 ${mt.order || '?'} 册</td>
      <td>${mt.chapterCount || '?'} 章</td>
      <td>${mt.unlockChapter ? '学到第 ' + mt.unlockChapter + ' 章解锁下册' : '—'}</td>
      <td>${mt.pages} 页</td>
      <td>
        <span class="op-link" onclick="previewMat('${mt.id}', ${mt.pages || 0}, '${(mt.name || '').replace(/'/g, "\\'")}')">预览</span>
        <span class="op-link del" onclick="delMat('${mt.id}', '${(mt.name || '').replace(/'/g, "\\'")}')">删除</span>
      </td>
    </tr>`).join('');
    document.getElementById('matRows').innerHTML = rows || '<tr><td colspan="7" style="color:#8a94a3">暂无教材，用上方表单上传 PDF</td></tr>';
  } catch (e) { toast(e.message); }
}

/* 教材预览：只读查看各页（不含批注，批注是一对一到学生的） */
function previewMat(id, pages, name) {
  let box = document.getElementById('matPreviewMask');
  if (!box) {
    box = document.createElement('div');
    box.id = 'matPreviewMask';
    box.className = 'mat-prev-mask';
    box.onclick = (e) => { if (e.target === box) box.classList.add('hidden'); };
    document.body.appendChild(box);
  }
  const n = pages || 0;
  let imgs = '';
  for (let i = 1; i <= n; i++) imgs += `<img loading="lazy" src="/materials/${id}/page-${i}.jpg" alt="第${i}页">`;
  box.innerHTML = `<div class="mat-prev-box">
      <div class="mat-prev-head"><b>${name || '教材预览'}</b><span>共 ${n} 页</span>
        <button class="mat-prev-close" onclick="document.getElementById('matPreviewMask').classList.add('hidden')">✕</button></div>
      <div class="mat-prev-body">${imgs || '<div style="padding:40px;color:#8a94a3">该教材暂无页面</div>'}</div>
    </div>`;
  box.classList.remove('hidden');
}

/* 教材删除：二次确认后删除记录与关联文件 */
async function delMat(id, name) {
  if (!confirm(`确定删除教材「${name}」？\n将同时清除它的 PDF、页面图片和相关批注，且不可恢复。`)) return;
  try {
    await api('/api/admin/material/delete', 'POST', { id });
    toast('已删除教材');
    loadMats();
  } catch (e) { toast('删除失败：' + e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('matPdf');
  if (!el) return;
  el.onchange = function () {
    const f = this.files[0];
    if (!f) return;
    if (f.size > 7 * 1024 * 1024) return toast('PDF 请控制在 7MB 内');
    const name = document.getElementById('matName').value.trim() || f.name.replace(/\.pdf$/i, '');
    const rd = new FileReader();
    rd.onload = async () => {
      toast('上传转换中，约几秒…');
      try {
        await api('/api/admin/material/upload', 'POST', {
          name, dataUrl: rd.result,
          category: document.getElementById('matCategory').value,
          order: document.getElementById('matOrder').value,
          chapterCount: document.getElementById('matChapters').value,
          unlockChapter: document.getElementById('matUnlock').value,
        });
        toast('教材已上传');
        document.getElementById('matName').value = '';
        loadMats();
      } catch (e) { toast(e.message); }
      this.value = '';
    };
    rd.readAsDataURL(f);
  };
});

let matCache = [];

async function editMatMeta(id) {
  if (!matCache.length) matCache = await api('/api/admin/materials');
  const mt = matCache.find((x) => x.id === id) || {};
  const category = prompt('分类（A/B/C）：', mt.category || 'A');
  if (category === null) return;
  const order = prompt('第几册：', mt.order || 1);
  if (order === null) return;
  const chapterCount = prompt('共几章：', mt.chapterCount || '');
  if (chapterCount === null) return;
  const unlockChapter = prompt('学到第几章自动解锁下一册（0=不自动）：', mt.unlockChapter || '');
  if (unlockChapter === null) return;
  try {
    await api('/api/admin/material/meta', 'PUT', { id, category: category.toUpperCase(), order, chapterCount, unlockChapter });
    toast('已更新');
    matCache = [];
    loadMats();
  } catch (e) { toast(e.message); }
}

async function setMatProg() {
  const studentNo = document.getElementById('mpStudentNo').value.trim();
  if (!studentNo) return toast('请填写学号');
  try {
    await api('/api/admin/students/matprog', 'PUT', {
      studentNo,
      matBook: document.getElementById('mpBook').value || 1,
      matChapter: document.getElementById('mpChapter').value || 1,
    });
    toast('学生进度已更新（教材解锁自动生效）');
  } catch (e) { toast(e.message); }
}

/* ============ 角色权限（前端菜单可见性；后端接口另有强校验） ============ */
const PAGE_ROLES = {
  dashboard: ['super', 'teacher'],
  questions: ['super', 'editor'],
  qstats: ['super', 'editor', 'teacher'],
  levels: ['super', 'editor'],
  courses: ['super', 'editor'],
  students: ['super', 'teacher'],
  booking: ['super', 'teacher', 'finance', 'editor'],
  usage: ['super', 'finance'],
  settings: ['super', 'editor', 'teacher', 'finance'],
};

function myRole() {
  // 超管可临时以其他角色视角预览（previewRole）；真实身份始终存 cantoRole
  const real = sessionStorage.getItem('cantoRole') || 'super';
  if (real === 'super') {
    const pv = sessionStorage.getItem('previewRole');
    if (pv && pv !== 'super') return pv;
  }
  return real;
}

/** 真实登录身份（不受预览影响） */
function realRole() {
  return sessionStorage.getItem('cantoRole') || 'super';
}

/** 超管切换角色视角（纯前端预览：菜单/权限按目标角色渲染，token 不变） */
function switchRole(role) {
  if (realRole() !== 'super') return;
  document.getElementById('adminMenu').classList.remove('open');
  // 授课老师只在教师工作台工作，后台没有其页面，引导过去预览而非切空视角
  if (role === 'tutor') {
    if (confirm('「授课老师」的功能在教师工作台（课表 / 学生 / 批注 / 笔记）。是否打开教师工作台预览？')) {
      window.open('/teacher/', '_blank');
    }
    return;
  }
  if (role === 'super') sessionStorage.removeItem('previewRole');
  else sessionStorage.setItem('previewRole', role);
  applyRole();
  toast(role === 'super' ? '已恢复超级管理员视角' : `已切换到「${ROLE_LABELS[role]}」视角预览`);
}

const ROLE_LABELS = { super: '超级管理员', editor: '内容编辑', teacher: '教务', tutor: '授课老师', finance: '财务审核' };

/** 按角色隐藏菜单并跳到第一个可见页；super 额外显示账号管理/操作日志 */
function applyRole() {
  const role = myRole();
  const name = sessionStorage.getItem('cantoName') || '';
  const previewing = realRole() === 'super' && role !== 'super';
  const chip = document.getElementById('adminChip');
  const label = previewing
    ? `预览：${ROLE_LABELS[role] || role}`
    : `${ROLE_LABELS[role] || role}${name && name !== '超级管理员' ? ' · ' + name : ''}`;
  if (chip) chip.innerHTML = `${label} <span class="caret">▾</span>`;
  const ddName = document.getElementById('ddName');
  if (ddName) ddName.textContent = previewing ? `超级管理员（预览 ${ROLE_LABELS[role]} 视角）` : label;
  // 切换角色块仅真实超管可见，并高亮当前视角
  const rsb = document.getElementById('roleSwitchBlock');
  if (rsb) {
    rsb.style.display = realRole() === 'super' ? '' : 'none';
    document.querySelectorAll('.role-item').forEach((it) => it.classList.toggle('cur', it.dataset.role === role));
  }
  let first = null;
  $$('.menu-item').forEach((item) => {
    const ok = (PAGE_ROLES[item.dataset.page] || []).includes(role);
    item.style.display = ok ? '' : 'none';
    if (ok && !first) first = item;
  });
  const superBlocks = document.getElementById('superOnlyBlocks');
  if (superBlocks) superBlocks.classList.toggle('hidden', role !== 'super');
  if (role !== 'super' && first) first.click();
}

const EMPTY_STATS = { answerUsers: 0, attempts: 0, rate: 0, firstRate: 0, reviewRate: 0, avgMs: 0, skipRate: 0, repeatWrongRate: 0, optionDist: [0, 0, 0, 0], discrimination: '-', audioFailRate: '-', imgFailRate: '-', asrFailRate: '-' };

/** 服务器题目为小程序完整格式，这里补齐后台展示用的派生字段 + 真实作答统计 */
function decorateQuestion(q, per) {
  const text = q.text || (q.stem && q.stem.text) || q.prompt || (q.tokens ? q.tokens.map((t) => t.text).join('') : '');
  const jyut = q.jyut || (q.stem && q.stem.jyut) || (q.tokens ? q.tokens.map((t) => t.jyut).join(' ') : '');
  const hasAudio = q.hasAudio !== undefined ? q.hasAudio : !!(q.stem && q.stem.audioUrl);
  const stats = { ...EMPTY_STATS, ...(q.stats || {}) };
  const s = per && per[q.id];
  if (s) {
    stats.answerUsers = s.first;
    stats.attempts = s.attempts;
    stats.rate = s.attempts ? Math.round((s.correct / s.attempts) * 100) : 0;
    stats.firstRate = s.first ? Math.round((s.firstCorrect / s.first) * 100) : 0;
    stats.avgMs = s.attempts ? Math.round(s.ms / s.attempts) : 0;
    stats.skipRate = s.attempts ? Math.round((s.skip / s.attempts) * 100) : 0;
  }
  return { ...q, text, jyut, hasAudio, stats };
}

let questions = [];
let levels = [];
let courses = [];

async function loadAll() {
  let per = {};
  try {
    const ov = await api('/api/admin/overview');
    per = ov.perQuestion || {};
  } catch (e) {
    /* 统计不可用不阻塞主数据 */
  }
  // 各角色权限不同，无权模块降级为空（页面本身也已按角色隐藏）
  const safe = (p2) => api(p2).catch(() => []);
  const [qs, lvs, cs] = await Promise.all([
    safe('/api/admin/questions'),
    safe('/api/admin/levels'),
    safe('/api/admin/courses'),
  ]);
  questions = qs.map((q) => decorateQuestion(q, per));
  levels = lvs;
  courses = cs;
}

/** 保存到服务器（题目按 id 合并，关卡/课程全量覆盖） */
function persist() {
  Promise.all([
    api('/api/admin/questions', 'PUT', { data: questions }),
    api('/api/admin/levels', 'PUT', { data: levels }),
    api('/api/admin/courses', 'PUT', { data: courses }),
  ]).catch((e) => toast('保存到服务器失败：' + e.message));
}

/* ============ 通用 ============ */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2200);
}

function closeModal(id) {
  $('#' + id).classList.add('hidden');
}

function rateClass(v) {
  if (v >= 75) return 'rate-good';
  if (v >= 55) return 'rate-mid';
  return 'rate-bad';
}

function typeTag(type) {
  const m = TYPE_META[type] || { label: type, color: '#999' };
  return `<span class="tag" style="background:${m.color}">${m.label}</span>`;
}

function levelRefCount(qid) {
  return levels.filter((lv) => lv.questionIds.includes(qid)).length;
}

/* Mock 动作 */
function mockExport(name) { toast(`已导出「${name}」（原型演示）`); }
function mockRemind(who) { toast(`已向${who}发送学习提醒（原型演示）`); }
function mockUpload(what) { toast(`${what} 上传成功（原型演示）`); if ($('#fAudioName')) $('#fAudioName').textContent = '已上传'; }

/* 真实 TTS：粤语合成（腾讯云智彤音色） */
let pendingAudioUrl = '';
async function mockTts() {
  const text = $('#fText').value.trim();
  if (!text) return toast('请先填写题干文字');
  $('#fAudioName').textContent = '合成中…';
  try {
    const body = editingQid ? { questionId: editingQid } : { text };
    const d = await api('/api/admin/tts', 'POST', body);
    pendingAudioUrl = d.audioUrl;
    $('#fAudioName').textContent = '已生成粤语发音 ✓';
    toast('TTS 合成成功');
    // 当场试听
    new Audio(d.audioUrl + '?t=' + Date.now()).play().catch(() => {});
  } catch (e) {
    $('#fAudioName').textContent = '生成失败';
    toast('TTS 失败：' + e.message);
  }
}

/* 一键为全部题目生成粤语音频 */
async function ttsBatch() {
  let items = [], skipped = 0;
  try {
    const pd = await api('/api/admin/tts/pending');
    items = pd.items || [];
    skipped = pd.skipped || 0;
  } catch (e) {
    return toast('获取待生成清单失败：' + e.message);
  }
  if (!items.length) {
    return toast(skipped ? `全部 ${skipped} 题音频已生成，无需重复生成` : '没有需要生成音频的题目');
  }
  const tip = `将为 ${items.length} 道未生成音频的题目调用粤语 TTS${skipped ? `（已生成的 ${skipped} 题自动跳过）` : ''}，确定？`;
  if (!confirm(tip)) return;

  openTtsProgress(items.length);
  let done = 0, failed = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    updateTtsProgress(done + failed, items.length, `正在生成：${it.text || it.id}`);
    try {
      await api('/api/admin/tts', 'POST', { questionId: it.id });
      done += 1;
    } catch (e) {
      failed += 1;
    }
    updateTtsProgress(done + failed, items.length, `正在生成：${it.text || it.id}`);
  }
  finishTtsProgress(done, failed);
  await bootData();
}

/* ---- 一键生成音频：进度弹窗 ---- */
function openTtsProgress(total) {
  let box = document.getElementById('ttsProgressMask');
  if (!box) {
    box = document.createElement('div');
    box.id = 'ttsProgressMask';
    box.className = 'tts-mask';
    box.innerHTML = `
      <div class="tts-modal">
        <div class="tts-title">正在生成音频</div>
        <div class="tts-warn">⚠️ 请勿关闭该页面，正在生成中…</div>
        <div class="tts-bar"><div class="tts-bar-fill" id="ttsBarFill"></div></div>
        <div class="tts-meta"><span id="ttsPercent">0%</span><span id="ttsCount">0 / ${total}</span></div>
        <div class="tts-cur" id="ttsCur">准备中…</div>
      </div>`;
    document.body.appendChild(box);
  }
  box.classList.remove('hidden');
  updateTtsProgress(0, total, '准备中…');
}
function updateTtsProgress(done, total, cur) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const fill = document.getElementById('ttsBarFill');
  if (fill) fill.style.width = pct + '%';
  const p = document.getElementById('ttsPercent'); if (p) p.textContent = pct + '%';
  const c = document.getElementById('ttsCount'); if (c) c.textContent = `${done} / ${total}`;
  const cr = document.getElementById('ttsCur'); if (cr && cur) cr.textContent = cur;
}
function finishTtsProgress(done, failed) {
  const fill = document.getElementById('ttsBarFill'); if (fill) fill.style.width = '100%';
  const p = document.getElementById('ttsPercent'); if (p) p.textContent = '100%';
  const cr = document.getElementById('ttsCur');
  if (cr) cr.innerHTML = `<b style="color:#12a150">✓ 完成</b>　成功 ${done} 题${failed ? `，失败 ${failed} 题` : ''}`;
  const warn = document.querySelector('#ttsProgressMask .tts-warn');
  if (warn) { warn.textContent = '生成完成，可关闭'; warn.style.color = '#12a150'; }
  const modal = document.querySelector('#ttsProgressMask .tts-modal');
  if (modal && !document.getElementById('ttsCloseBtn')) {
    const btn = document.createElement('button');
    btn.id = 'ttsCloseBtn'; btn.className = 'btn primary'; btn.textContent = '完成'; btn.style.marginTop = '14px'; btn.style.width = '100%';
    btn.onclick = () => document.getElementById('ttsProgressMask').classList.add('hidden');
    modal.appendChild(btn);
  }
  toast(`音频生成完成：成功 ${done} 题${failed ? `，失败 ${failed}` : ''}`);
}

/* ============ 页面切换 ============ */
const PAGE_TITLES = {
  dashboard: '数据概览',
  questions: '题库管理',
  qstats: '题目统计',
  levels: '关卡组装',
  courses: '录播课管理',
  students: '学生管理',
  booking: '约课管理',
  usage: '用量监控',
  settings: '系统设置',
};

$$('.menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    $$('.menu-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    $$('.page').forEach((p) => p.classList.add('hidden'));
    $('#page-' + page).classList.remove('hidden');
    $('#pageTitle').textContent = PAGE_TITLES[page];
    if (page === 'usage') loadUsage();
    if (page === 'students') loadStudents();
    if (page === 'booking') loadBookingPage();
    if (page === 'courses') loadMembership();
    if (page === 'settings' && myRole() === 'super') {
      loadAccounts();
      loadAudit();
      loadAppConfig();
      loadBranding();
      loadLegal();
    }
  });
});

/* ============ 账号与角色管理（超管） ============ */
async function loadAccounts() {
  try {
    const list = await api('/api/admin/accounts');
    // 老师名映射，用于显示账号绑定的授课老师
    let teachers = [];
    try { teachers = await api('/api/admin/teachers'); } catch (e) { /* ignore */ }
    const tName = (id) => (teachers.find((t) => t.id === id) || {}).name || '';
    window._acctTeachers = teachers;
    $('#acctBody').innerHTML = list
      .map((a) => `<tr>
        <td><b>${a.username}</b></td>
        <td>${a.name || '-'}</td>
        <td>${a.roleName}${['teacher', 'tutor'].includes(a.role) ? `<br><span style="font-size:11px;color:${a.teacherId ? '#12a150' : '#e5342e'}">${a.teacherId ? '授课：' + (tName(a.teacherId) || a.teacherId) : '未绑定老师'}</span>` : ''}</td>
        <td>${a.createdAt ? new Date(a.createdAt).toLocaleDateString() : '-'}</td>
        <td>
          ${['teacher', 'tutor'].includes(a.role) ? `<a class="link" onclick="bindTeacher('${a.username}','${a.teacherId || ''}')">绑定老师</a>` : ''}
          <a class="link" onclick="resetAccountPwd('${a.username}')">重置密码</a>
          <a class="link danger" onclick="deleteAccount('${a.username}')">删除</a>
        </td>
      </tr>`)
      .join('');
  } catch (e) {
    $('#acctBody').innerHTML = `<tr><td colspan="5" class="hint">${e.message}</td></tr>`;
  }
}

/** 绑定/更换账号的授课老师（决定该账号登录教师工作台后看到谁的课表） */
async function bindTeacher(username, cur) {
  const teachers = window._acctTeachers || [];
  if (!teachers.length) return toast('请先在「约课管理 → 教师」里添加老师');
  const menu = teachers.map((t, i) => `${i + 1}. ${t.name}`).join('\n');
  const pick = prompt(`把账号「${username}」绑定到哪位授课老师？\n输入序号（输入 0 解除绑定）：\n${menu}`, '1');
  if (pick === null) return;
  const n = parseInt(pick, 10);
  let teacherId = '';
  if (n === 0) teacherId = '';
  else if (n >= 1 && n <= teachers.length) teacherId = teachers[n - 1].id;
  else return toast('序号无效');
  try {
    await api('/api/admin/accounts/bind', 'PUT', { username, teacherId });
    toast(teacherId ? '已绑定授课老师' : '已解除绑定');
    loadAccounts();
  } catch (e) { toast(e.message); }
}

async function createAccount() {
  const username = $('#accUser').value.trim();
  const name = $('#accName').value.trim();
  const role = $('#accRole').value;
  const password = $('#accPwd').value;
  if (!username || !password) return toast('请填写用户名和初始密码');
  try {
    await api('/api/admin/accounts', 'POST', { username, name, role, password });
    toast(`账号 ${username} 已创建`);
    $('#accUser').value = '';
    $('#accName').value = '';
    $('#accPwd').value = '';
    loadAccounts();
  } catch (e) {
    toast(e.message);
  }
}

async function deleteAccount(username) {
  if (!confirm(`确定删除账号「${username}」？`)) return;
  try {
    await api('/api/admin/accounts/' + username, 'DELETE');
    toast('已删除');
    loadAccounts();
  } catch (e) {
    toast(e.message);
  }
}

async function resetAccountPwd(username) {
  const pw = prompt(`为「${username}」设置新密码（至少 8 位）：`);
  if (!pw) return;
  try {
    await api('/api/admin/accounts/reset', 'POST', { username, password: pw });
    toast('密码已重置，该账号需重新登录');
  } catch (e) {
    toast(e.message);
  }
}

/* ============ 操作日志（超管） ============ */
const AUDIT_MODULES = {
  questions: '题库', levels: '关卡', courses: '课程', tts: '语音合成', upload: '资源上传',
  vod: '视频', accounts: '账号管理', password: '密码', students: '学生', usage: '用量',
  material: '教材/批注', homework: '课后作业', schedule: '排班', bookings: '约课',
  packs: '课时包', teachers: '教师',
};

function auditAction(a) {
  const seg = a.path.replace('/api/admin/', '').split('/');
  const verb = { POST: '新增/执行', PUT: '保存', DELETE: '删除' }[a.method] || a.method;
  if (a.path.includes('tts/batch')) return '批量生成音频';
  if (seg[0] === 'tts') return '生成语音';
  if (seg[0] === 'password') return '修改自己密码';
  if (seg[0] === 'accounts' && seg[1] === 'reset') return '重置他人密码';
  if (seg[0] === 'accounts' && a.method === 'DELETE') return '删除账号 ' + (seg[1] || '');
  if (seg[0] === 'accounts') return '新增账号';
  if (seg[0] === 'questions' && seg[1] === 'import') return '批量导入题目';
  if (seg[0] === 'homework' && seg[1] === 'grade') return '批改作业';
  if (seg[0] === 'homework' && a.method === 'POST') return '布置作业';
  if (seg[0] === 'homework' && a.method === 'DELETE') return '下架作业';
  if (seg[0] === 'packs' && a.method === 'POST') return '开通课时包';
  if (seg[0] === 'packs' && a.method === 'PUT') return '调整课时';
  if (seg[0] === 'schedule' && a.method === 'POST') return '批量排班';
  if (seg[0] === 'schedule' && a.method === 'DELETE') return '删除时段';
  if (seg[0] === 'bookings' && a.method === 'POST') return '补录课程';
  if (seg[0] === 'bookings' && a.method === 'PUT') return '约课状态操作';
  if (seg[0] === 'teachers') return `${verb} 教师`.trim();
  if (seg[0] === 'material' && seg[1] === 'upload') return '上传教材';
  if (seg[0] === 'material' && seg[1] === 'meta') return '修改教材属性';
  if (seg[0] === 'students' && seg[1] === 'class') return '学生分类标注';
  if (seg[0] === 'students' && seg[1] === 'matprog') return '更新学生教材进度';
  return `${verb} ${seg[1] || ''}`.trim();
}

function clearAuditFilter() {
  $('#adUser').value = '';
  $('#adModule').value = '';
  $('#adDay').value = '';
  loadAudit();
}

async function loadAudit() {
  try {
    // 操作人下拉懒加载（用后台账号列表）
    const sel = $('#adUser');
    if (sel && sel.options.length <= 1) {
      try {
        const accs = await api('/api/admin/accounts');
        accs.forEach((a) => {
          const o = document.createElement('option');
          o.value = a.username;
          o.textContent = `${a.name}（${a.username}）`;
          sel.appendChild(o);
        });
      } catch (e) { /* 非超管无账号列表 */ }
    }
    const qs = new URLSearchParams();
    if ($('#adUser') && $('#adUser').value) qs.set('user', $('#adUser').value);
    if ($('#adModule') && $('#adModule').value) qs.set('module', $('#adModule').value);
    if ($('#adDay') && $('#adDay').value) qs.set('day', $('#adDay').value);
    qs.set('limit', '300');
    const list = await api('/api/admin/audit?' + qs.toString());
    if (!list.length) {
      $('#auditBody').innerHTML = '<tr><td colspan="6" class="hint">无匹配的操作记录</td></tr>';
      return;
    }
    $('#auditBody').innerHTML = list
      .map((a) => {
        const seg = a.path.replace('/api/admin/', '').split('/')[0];
        return `<tr>
          <td>${new Date(a.ts).toLocaleString()}</td>
          <td>${a.name || a.user}</td>
          <td>${{ super: '超级管理员', editor: '内容编辑', teacher: '教务老师', finance: '财务审核' }[a.role] || a.role}</td>
          <td>${AUDIT_MODULES[seg] || seg}</td>
          <td>${auditAction(a)}</td>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b7684" title="${(a.detail || '').replace(/"/g, '&quot;')}">${a.detail || '—'}</td>
        </tr>`;
      })
      .join('');
  } catch (e) {
    $('#auditBody').innerHTML = `<tr><td colspan="6" class="hint">${e.message}</td></tr>`;
  }
}

/* ============ 学生管理 ============ */
let studentList = [];

/* ---- 出勤考核 ---- */
function toggleAttendance() {
  const panel = document.getElementById('attendPanel');
  const show = panel.style.display === 'none';
  panel.style.display = show ? '' : 'none';
  document.getElementById('attToggleBtn').textContent = show ? '收起考核' : '出勤考核';
  if (show) loadAttendance();
}
async function loadAttendance() {
  try {
    const rows = await api('/api/admin/attendance');
    document.getElementById('attendBody').innerHTML = rows.length
      ? rows.map((r) => `<tr><td>${r.studentNo}</td><td>${r.nickname || '—'}</td>`
        + `<td><b style="color:${r.rate >= 80 ? '#12a150' : r.rate >= 60 ? '#e8930c' : '#e5342e'}">${r.rate}%</b></td>`
        + `<td>${r.present}</td><td>${r.leave}</td><td style="color:#e5342e">${r.absent}</td><td>${r.pending}</td>`
        + `<td>${r.checkinTotal}</td><td>${r.checkinStreak} 天</td></tr>`).join('')
      : '<tr><td colspan="9" class="hint">暂无出勤/打卡数据</td></tr>';
  } catch (e) { toast(e.message); }
}

async function loadStudents() {
  $('#stuBody').innerHTML = '<tr><td colspan="10" class="hint">加载中…</td></tr>';
  try {
    studentList = await api('/api/admin/students');
    renderStudents();
  } catch (e) {
    $('#stuBody').innerHTML = `<tr><td colspan="10" class="hint">加载失败：${e.message}</td></tr>`;
  }
}

function fmtTime(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return sameDay ? `今天 ${hm}` : `${d.getMonth() + 1}-${d.getDate()} ${hm}`;
}

function renderStudents() {
  const kw = ($('#stuSearch').value || '').trim().toLowerCase();
  const rows = studentList.filter((s) => {
    if (!kw) return true;
    return s.deviceId.toLowerCase().includes(kw) || String(s.studentNo || '').includes(kw) || (s.phone || '').includes(kw);
  });
  if (!rows.length) {
    $('#stuBody').innerHTML = '<tr><td colspan="10" class="hint">暂无学生数据（学生使用小程序后自动出现）</td></tr>';
    return;
  }
  $('#stuBody').innerHTML = rows
    .map((s) => `<tr>
      <td>${s.registered
        ? `<b>${s.studentNo || '-'}</b>`
        : `<span class="stu-guest">游客</span><br><span class="hint">${s.deviceId.slice(0, 12)}…</span>`}</td>
      <td>${s.registered ? (s.nickname || '<span class="hint">未设置</span>') : '<span class="hint">—</span>'}</td>
      <td>${s.registered ? (s.phone || '<span class="hint">未留手机号</span>') : '<span class="hint">—</span>'}</td>
      <td>${s.levels} / ${s.passed}</td>
      <td>${s.answered}</td>
      <td>${s.firstRate}%</td>
      <td>${s.assessCount}</td>
      <td>${s.avgAssessScore === null ? '-' : s.avgAssessScore + ' 分'}</td>
      <td>${s.minutes} 分钟</td>
      <td>${fmtTime(s.lastActive)}</td>
    </tr>`)
    .join('');
}

/* ============ 系统设置：修改密码 ============ */
async function changePassword() {
  const oldPassword = $('#pwdOld').value;
  const newPassword = $('#pwdNew').value;
  const again = $('#pwdNew2').value;
  if (!oldPassword || !newPassword) return toast('请填写完整');
  if (newPassword.length < 8) return toast('新密码至少 8 位');
  if (newPassword !== again) return toast('两次输入的新密码不一致');
  try {
    await api('/api/admin/password', 'POST', { oldPassword, newPassword });
    toast('密码已修改，请用新密码重新登录');
    sessionStorage.removeItem('cantoToken');
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    toast(e.message);
  }
}

/* ============ 用量监控 ============ */
/** 格式化 MB 数值：>=1024 显示 GB */
function fmtMB(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : (Math.round(mb * 10) / 10) + ' MB';
}

/** 进度条卡片：label + used/total + 百分比着色 */
function quotaBar(q) {
  if (q.pending || (q.error && !q.total)) {
    return `<div class="quota-item"><div class="quota-top"><span class="quota-label">${q.label}</span>
      <span class="quota-nums hint">${q.error ? '数据不可用' : '加载中…'}</span></div></div>`;
  }
  const pct = q.total > 0 ? Math.min(100, (q.used / q.total) * 100) : 0;
  const cls = pct >= 80 ? 'danger' : pct >= 50 ? 'warn' : 'ok';
  const isMB = q.unit === 'MB';
  const usedTxt = isMB ? fmtMB(q.used) : q.used.toLocaleString() + ' ' + q.unit;
  const totalTxt = isMB ? fmtMB(q.total) : q.total.toLocaleString() + ' ' + q.unit;
  const extra = q.objects !== undefined ? `（${q.objects} 个文件)` : '';
  return `<div class="quota-item">
    <div class="quota-top">
      <span class="quota-label">${q.label}${extra}</span>
      <span class="quota-nums">已用 <b>${usedTxt}</b> / 共 ${totalTxt}</span>
    </div>
    <div class="quota-track"><div class="quota-fill ${cls}" style="width:${Math.max(pct, pct > 0 ? 2 : 0)}%"></div></div>
    <div class="quota-pct ${cls}">${pct.toFixed(1)}%</div>
  </div>`;
}

async function loadUsage() {
  $('#usageLocal').innerHTML = '<div class="hint">加载中…</div>';
  try {
    const d = await api('/api/admin/usage');
    const L = d.local;
    // 配额进度条
    if (d.quota) {
      $('#usageQuota').innerHTML = ['svr', 'cdn', 'vod', 'cos', 'tts', 'asr'].map((k) => quotaBar(d.quota[k])).join('');
    }
    $('#usageLocal').innerHTML = [
      card(L.assess.today, '今日 AI 纠音次数', 'orange'),
      card(L.assess.week, '近7日纠音次数'),
      card(L.assess.total, '累计纠音次数'),
      card(L.assess.failed, '识别失败次数', L.assess.failed > 0 ? 'red' : ''),
      card(L.tts.files, 'TTS 音频文件数'),
      card(L.tts.sizeMB + ' MB', '音频占用空间'),
      card(L.results.today, '今日关卡结算'),
      card(L.results.total, '累计关卡结算'),
    ].join('');

    // 本月账单（按产品）
    if (d.cloud.bill && d.cloud.bill.length) {
      $('#usageBillBody').innerHTML = d.cloud.bill
        .map((b) => `<tr><td>${b.name}</td><td>¥ ${Number(b.cost).toFixed(2)}</td><td>${b.ratio}%</td></tr>`)
        .join('');
      $('#usageBillErr').textContent = '';
    } else if (d.cloud.billError) {
      $('#usageBillBody').innerHTML = '<tr><td colspan="3" class="hint">—</td></tr>';
      $('#usageBillErr').textContent = '账单接口不可用：' + d.cloud.billError + '（协作者账号需主账号在「访问管理」授予财务只读权限后即可显示）';
    } else {
      $('#usageBillBody').innerHTML = '<tr><td colspan="3" class="hint">本月暂无消费记录</td></tr>';
      $('#usageBillErr').textContent = '';
    }

    // CDN 本月流量
    if (d.cloud.cdn) {
      const mb = d.cloud.cdn.monthFluxMB;
      const disp = mb >= 1024 ? (mb / 1024).toFixed(2) + ' GB' : mb + ' MB';
      $('#usageCdn').innerHTML = card(disp, '本月 CDN 下行流量', 'orange') + card('1 TB', '已购流量包总量');
    } else {
      $('#usageCdn').innerHTML = `<div class="hint">CDN 数据不可用：${d.cloud.cdnError || '未知'}</div>`;
    }
  } catch (e) {
    $('#usageLocal').innerHTML = `<div class="hint">加载失败：${e.message}</div>`;
  }
  loadBackup(); // 顺带刷新备份监控
}

/* ============ 数据备份监控 ============ */
function fmtBytes(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB';
  if (b >= 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b || 0) + ' B';
}
function fmtTs(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { hour12: false });
}

async function loadBackup() {
  const body = $('#backupBody');
  if (body) body.innerHTML = '<tr><td colspan="4" class="hint">加载中…</td></tr>';
  try {
    const d = await api('/api/admin/backup');
    const latestTxt = d.latest ? `${fmtTs(d.latest.ts)}（${fmtBytes(d.latest.size)}）` : '无';
    const cos = d.cos || {};
    const cosTxt = !cos.enabled ? '未启用（缺密钥）' : cos.error ? ('异常：' + cos.error) : `${cos.count} 份 · ${fmtBytes(cos.totalSize)} · 留 ${cos.keepDays} 天`;
    $('#backupSummary').innerHTML = `本地最近：<b>${latestTxt}</b> · 共 ${d.count} 份（留 ${d.keep} 份）　|　☁️ COS 异地：<b>${cosTxt}</b>`;
    $('#backupKpi').innerHTML = [
      card(d.count, '本地备份份数', d.count > 0 ? 'orange' : 'red'),
      card(fmtBytes(d.totalSize), '本地占用'),
      card(cos.enabled ? cos.count : '—', 'COS 异地份数', cos.enabled && cos.count > 0 ? '' : 'red'),
      card(d.lastAuto ? fmtTs(d.lastAuto.ts).slice(5, 16) : '未执行', '最近自动备份'),
    ].join('');
    if (body) {
      body.innerHTML = d.list.length ? d.list.map((f) => {
        const rec = (d.recent || []).find((r) => r.name === f.name);
        const trig = rec && rec.trigger === 'auto' ? '<span class="status-dot published">自动</span>' : '<span class="status-dot" style="color:#1467ff">手动</span>';
        return `<tr><td>${f.name}</td><td>${fmtBytes(f.size)}</td><td>${trig}</td><td>${fmtTs(f.ts)}</td></tr>`;
      }).join('') : '<tr><td colspan="4" class="hint">暂无备份，点「立即备份」创建第一份</td></tr>';
    }
  } catch (e) {
    if (body) body.innerHTML = `<tr><td colspan="4" class="hint">加载失败：${e.message}</td></tr>`;
  }
}

async function doBackup() {
  const btn = $('#backupBtn');
  if (btn) { btn.disabled = true; btn.textContent = '备份中…'; }
  try {
    const r = await api('/api/admin/backup', 'POST');
    toast(`备份成功：${r.name}（${fmtBytes(r.size)}）`);
    loadBackup();
  } catch (e) {
    toast(e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '立即备份'; }
  }
}

/* ============ 数据概览 ============ */
function card(num, label, color) {
  return `<div class="stat-card"><div class="num ${color || ''}">${num}</div><div class="label">${label}</div></div>`;
}

function hbar(label, val, color) {
  return `<div class="hbar-row">
    <span class="hbar-label">${label}</span>
    <div class="hbar-track"><div class="hbar-fill" style="width:${val}%;background:${color}"></div></div>
    <span class="hbar-val">${val}%</span>
  </div>`;
}

/** 空数据骨架（真实接口未返回时用，全 0） */
const EMPTY_DASHBOARD = {
  students: { total: 0, newToday: 0, new7d: 0, paid: 0, free: 0, vipExpiring: 0, activeToday: 0, active7d: 0, active30d: 0, finishedToday: 0 },
  retention: { d3: 0, d7: 0, d30: 0 },
  accuracy: { today: 0, d7: 0, d30: 0, first: 0 },
  behavior: { avgMinutesToday: 0, avgMinutes7d: 0, avgDaysPerWeek: 0, avgQuestionsToday: 0, avgQuestions7d: 0, avgStreak: 0, streak3: 0, streak7: 0, streak20: 0, streakBroken: 0 },
  levelFunnel: { started: 0, finished: 0, finishRate: 0, firstPassRate: 0, avgTries: 0, avgMinutes: 0, quitRate: 0 },
  alerts: { churnRisk: 0, churnRules: [], churnList: [], highActive: 0, highRules: [], highList: [] },
  accuracy7dTrend: [0, 0, 0, 0, 0, 0, 0],
  active7dTrend: [0, 0, 0, 0, 0, 0, 0],
};

/** 拉取真实统计填充大屏；接口失败或无 dashboard 字段时回退骨架 */
async function loadDashboard() {
  try {
    const ov = await api('/api/admin/overview');
    if (ov && ov.dashboard) { renderDashboard(ov.dashboard); return; }
  } catch (e) { /* 失败则用空骨架 */ }
  renderDashboard(EMPTY_DASHBOARD);
}

function renderDashboard(data) {
  const d = data || EMPTY_DASHBOARD;
  const s = d.students;

  // 顶部核心 KPI（5 个发光卡）
  const kpis = [
    { num: s.total, label: '累计学生数', ic: 'users', tr: '+' + s.new7d + ' 本周' },
    { num: '+' + s.newToday, label: '今日新增', ic: 'add', tr: '较昨日' },
    { num: s.activeToday, label: '今日活跃', ic: 'pulse', tr: (s.total ? Math.round(s.activeToday / s.total * 100) : 0) + '% 活跃率' },
    { num: s.paid, label: '付费学生', ic: 'crown', warm: true, tr: (s.total ? Math.round(s.paid / s.total * 100) : 0) + '% 付费率' },
    { num: s.finishedToday, label: '今日完成学习', ic: 'check', tr: '关卡达标' },
  ];
  $('#dsKpis').innerHTML = kpis.map((k) => `<div class="ds-kpi">
      <div class="k-top"><span class="k-ic k-${k.ic}"></span><span class="k-badge">${k.tr}</span></div>
      <div class="k-num ${k.warm ? 'warm' : ''}">${k.num}</div>
      <div class="k-label">${k.label}</div>
    </div>`).join('');

  // 环形：正确率（青绿）
  const ring = (val, label, color) => `<div class="ds-ring">
      <div class="r-chart" style="background:conic-gradient(${color} ${val * 3.6}deg, rgba(255,255,255,0.08) 0)">
        <span class="r-val">${val}<small style="font-size:12px">%</small></span>
      </div>
      <span class="r-label">${label}</span>
    </div>`;
  $('#dsRings').innerHTML =
    ring(d.accuracy.today, '今日正确率', '#18c896') +
    ring(d.accuracy.d7, '近7日', '#2f9be0') +
    ring(d.accuracy.first, '首次作答', '#FF7A3D');
  // 环形：留存（靛蓝系）
  $('#dsRetention').innerHTML =
    ring(d.retention.d3, '3日留存', '#5aa0ff') +
    ring(d.retention.d7, '7日留存', '#2f6bd8') +
    ring(d.retention.d30, '30日留存', '#7c6cff');

  // 甜甜圈：付费/免费构成
  const paid = s.paid, free = s.free, tot = paid + free || 1;
  const pDeg = Math.round((paid / tot) * 360);
  $('#dsDonut').innerHTML = `<div class="d-center"><span class="d-total">${tot}</span><span class="d-cap">总学生</span></div>`;
  $('#dsDonut').style.background = `conic-gradient(#FF7A3D 0 ${pDeg}deg, #2f6bd8 ${pDeg}deg 360deg)`;
  $('#dsDonutLegend').innerHTML = `
    <div class="lg"><i style="background:#FF7A3D"></i>付费学生<b>${paid}</b></div>
    <div class="lg"><i style="background:#2f6bd8"></i>免费学生<b>${free}</b></div>
    <div class="lg"><i style="background:#7c6cff"></i>付费占比<b>${Math.round((paid / tot) * 100)}%</b></div>`;

  // SVG 折线趋势
  $('#dsLineAcc').innerHTML = svgLine(d.accuracy7dTrend, '#FF7A3D', '%');
  $('#dsLineActive').innerHTML = svgLine(d.active7dTrend, '#2f9be0', '');

  // 学习行为指标墙
  const b = d.behavior;
  const metric = (num, label, cls) => `<div class="ds-metric"><div class="m-num ${cls || ''}">${num}</div><div class="m-label">${label}</div></div>`;
  $('#dsBehavior').innerHTML = [
    metric(b.avgMinutesToday + '分', '今日人均时长'),
    metric(b.avgMinutes7d + '分', '近7日人均时长'),
    metric(b.avgDaysPerWeek + '天', '每周学习天数'),
    metric(b.avgQuestionsToday, '今日人均答题'),
    metric(b.avgStreak + '天', '平均连续天数', 'warm'),
    metric(b.streakBroken, '连续中断', 'danger'),
  ].join('');

  // 关卡漏斗（宽度按人数递减）
  const f = d.levelFunnel;
  const steps = [
    { label: '开始关卡', val: f.started },
    { label: '完成关卡', val: f.finished },
    { label: '首次通过', val: Math.round(f.finished * f.firstPassRate / 100) },
  ];
  const maxF = steps[0].val || 1;
  $('#dsFunnel').innerHTML = steps.map((st, i) => `<div class="fn" style="width:${Math.max(40, Math.round((st.val / maxF) * 100))}%;opacity:${1 - i * 0.18}">
      <span class="fn-label">${st.label}</span><span class="fn-val">${st.val}</span>
    </div>`).join('')
    + `<div style="display:flex;gap:20px;margin-top:6px;font-size:12px;color:#8296c2">
        <span>完成率 <b style="color:#18c896">${f.finishRate}%</b></span>
        <span>中途退出 <b style="color:#ff8a94">${f.quitRate}%</b></span>
        <span>平均尝试 <b style="color:#dbe8ff">${f.avgTries} 次</b></span>
      </div>`;

  $('#churnNum').textContent = d.alerts.churnRisk + ' 人';
  $('#highNum').textContent = d.alerts.highActive + ' 人';
  $('#churnRules').innerHTML = d.alerts.churnRules.map((r) => `<li>${r}</li>`).join('');
  $('#highRules').innerHTML = d.alerts.highRules.map((r) => `<li>${r}</li>`).join('');
  // 右侧具体学生名单（教务点名跟进用）
  renderAlertList('churnList', d.alerts.churnList || [], 'warn');
  renderAlertList('highList', d.alerts.highList || [], 'good');
}

/** 重点关注学生名单：头像 + 学号姓名 + 标签 + 关键指标 + 快捷操作 */
function renderAlertList(elId, list, kind) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="al-empty">暂无名单</div>'; return; }
  el.innerHTML = list.map((s) => `<div class="al-item">
      <div class="al-av ${kind}">${(s.name || s.no || '').slice(0, 1)}</div>
      <div class="al-info">
        <div class="al-name">${s.name || '学员'} <span class="al-no">#${s.no}</span></div>
        <div class="al-extra">${s.extra || ''}</div>
      </div>
      <span class="al-tag ${kind}">${s.tag || ''}</span>
    </div>`).join('');
}

/** 生成发光 SVG 折线图（7 点，含渐变填充 + 数据点 + 数值标签） */
function svgLine(data, color, unit) {
  const W = 460, H = 168, padX = 20, padTop = 26, padBot = 28;
  const max = Math.max(...data) * 1.15 || 1;
  const min = Math.min(...data) * 0.85;
  const range = max - min || 1;
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const pts = data.map((v, i) => {
    const x = padX + (i * (W - padX * 2)) / (data.length - 1);
    const y = padTop + (1 - (v - min) / range) * (H - padTop - padBot);
    return [x, y];
  });
  const linePath = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const areaPath = linePath + ` L${pts[pts.length - 1][0].toFixed(1)} ${H - padBot} L${pts[0][0].toFixed(1)} ${H - padBot} Z`;
  const gid = 'g' + color.replace('#', '');
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="0.35"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${areaPath}" fill="url(#${gid})"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 0 6px ${color}aa)"/>
    ${pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="var(--ds-ringhole)" stroke="${color}" stroke-width="2"/>
      <text x="${p[0].toFixed(1)}" y="${(p[1] - 10).toFixed(1)}" fill="currentColor" font-size="11" text-anchor="middle" font-weight="700">${data[i]}${unit}</text>
      <text x="${p[0].toFixed(1)}" y="${H - 8}" fill="currentColor" opacity="0.55" font-size="11" text-anchor="middle">周${days[i]}</text>`).join('')}
  </svg>`;
}

/* ============ 题库管理 ============ */
function renderQuestions() {
  const type = $('#qTypeFilter').value;
  const status = $('#qStatusFilter').value;
  const kw = $('#qSearch').value.trim().toLowerCase();
  // 当前用途分组：quiz=闯关（图片/文字/组句） speaking=AI纠音
  const groupTypes = curQGroup === 'speaking' ? ['speaking'] : ['pic_choice', 'choice', 'sentence_order'];
  const inGroup = questions.filter((q) => groupTypes.includes(q.type));
  const rows = inGroup
    .filter((q) => (!type || q.type === type) && (!status || q.status === status))
    .filter((q) => !kw || (q.text || '').toLowerCase().includes(kw) || (q.jyut || '').toLowerCase().includes(kw) || q.id.includes(kw))
    .map((q) => `<tr>
      <td>${q.id}</td>
      <td>${typeTag(q.type)}</td>
      <td>${q.text}</td>
      <td style="color:#1cb0f6">${q.jyut}</td>
      <td>${q.stem && q.stem.audioUrl ? `<span class="audio-play" data-src="${q.stem.audioUrl}" onclick="playRowAudio(this)" title="点击试听"><i class="bi bi-audio" style="margin:0"></i></span>` : '—'}</td>
      <td>v${q.version}</td>
      <td><span class="status-dot ${q.status}">${q.status === 'published' ? '已发布' : '草稿'}</span></td>
      <td>${levelRefCount(q.id)} 个关卡</td>
      <td>
        <span class="op-link" onclick="openQuestionModal('${q.id}')">编辑</span>
        <span class="op-link del" onclick="deleteQuestion('${q.id}')">删除</span>
      </td>
    </tr>`);
  $('#qTable tbody').innerHTML = rows.join('') || '<tr><td colspan="9" style="text-align:center;color:#999">该分组下无匹配题目</td></tr>';
  // Tab 计数
  const spk = questions.filter((q) => q.type === 'speaking').length;
  $('#qcQuiz').textContent = questions.length - spk;
  $('#qcSpk').textContent = spk;
}

/* 用途分组切换：重建题型下拉（只列本组题型），刷新表格 */
let curQGroup = 'quiz';
const QGROUP_TYPES = {
  quiz: [['pic_choice', '图片选择题'], ['choice', '文字选择题'], ['sentence_order', '选词组句']],
  speaking: [['speaking', 'AI纠音题']],
};

function switchQGroup(el) {
  curQGroup = el.dataset.group;
  document.querySelectorAll('.q-gtab').forEach((t) => t.classList.remove('on'));
  el.classList.add('on');
  const sel = $('#qTypeFilter');
  sel.innerHTML = '<option value="">全部题型</option>' + QGROUP_TYPES[curQGroup].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  renderQuestions();
}

['qTypeFilter', 'qStatusFilter'].forEach((id) => $('#' + id).addEventListener('change', renderQuestions));
$('#qSearch').addEventListener('input', renderQuestions);

// 初始化题型下拉为默认分组（闯关）
$('#qTypeFilter').innerHTML = '<option value="">全部题型</option>' + QGROUP_TYPES.quiz.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');

let editingQid = null;

function openQuestionModal(qid) {
  editingQid = qid || null;
  pendingAudioUrl = '';
  const q = qid ? questions.find((x) => x.id === qid) : null;
  // 图片题状态初始化（编辑时回填已有图）
  picState = { images: ['', '', '', ''], labels: ['', '', '', ''], correct: 0, stemImage: '' };
  if (q && q.type === 'pic_choice') {
    picState.stemImage = (q.stem && q.stem.image) || '';
    (q.options || []).forEach((o, i) => {
      if (i < 4) {
        picState.images[i] = o.image || '';
        picState.labels[i] = o.label || '';
      }
    });
    picState.correct = 'abcd'.indexOf(q.answer || 'a');
    if (picState.correct < 0) picState.correct = 0;
  }
  $('#qModalTitle').textContent = q ? `编辑题目 ${q.id}` : '单题录入';
  // 已发布且有作答数据 → 提示版本化
  $('#versionTip').classList.toggle('hidden', !(q && q.status === 'published'));
  $('#fType').value = q ? q.type : 'pic_choice';
  $('#fText').value = q ? q.text : '';
  $('#fJyut').value = q ? q.jyut : '';
  $('#fStatus').value = q ? q.status : 'draft';
  $('#fAudioName').textContent = q && q.hasAudio ? '已生成 standard.mp3' : '未生成';
  renderTypeFields();
  $('#questionModal').classList.remove('hidden');
}

/** 按题型渲染不同的字段模板（对应文档 5.1「每种题型有自己的字段模板」） */
let picState = { images: ['', '', '', ''], labels: ['', '', '', ''], correct: 0, stemImage: '' };

function renderTypeFields() {
  const type = $('#fType').value;
  const box = $('#typeFields');
  if (type === 'pic_choice') {
    box.innerHTML = `<div class="form-row">
      <label>题干配图（看图选词用，听音选图可不传）</label>
      <div class="upload-row">
        <input type="file" id="stemImgFile" accept="image/*" hidden onchange="onPickImage(this, -1)">
        <button class="btn ghost sm" onclick="document.getElementById('stemImgFile').click()"><i class="bi bi-camera"></i>上传题干图</button>
        <img id="stemImgPrev" class="img-prev ${picState.stemImage ? '' : 'hidden'}" src="${picState.stemImage}">
      </div>
    </div>
    <div class="form-row">
      <label>4 张选项图（2×2 排布，点「设为答案」标记正确图）</label>
      <div class="pic-grid">
        ${[0, 1, 2, 3].map((i) => `
        <div class="pic-cell ${i === picState.correct ? 'correct' : ''}" id="picCell${i}">
          <input type="file" id="picFile${i}" accept="image/*" hidden onchange="onPickImage(this, ${i})">
          <div class="ph" onclick="document.getElementById('picFile${i}').click()">
            ${picState.images[i] ? `<img class="img-prev" src="${picState.images[i]}">` : '＋'}
          </div>
          <input type="text" id="picLabel${i}" placeholder="图片说明，如：奶茶" value="${picState.labels[i] || ''}" onchange="picState.labels[${i}]=this.value">
          <span class="mark" onclick="markCorrect(${i})">${i === picState.correct ? '✔ 正确答案' : '设为答案'}</span>
        </div>`).join('')}
      </div>
    </div>`;
  } else if (type === 'choice') {
    box.innerHTML = `<div class="form-row">
      <label>选项 A-D（单选正确答案）</label>
      ${['A', 'B', 'C', 'D'].map((t, i) => `
      <div class="opt-row">
        <span class="opt-tag">${t}</span>
        <input type="text" placeholder="选项内容">
        <label><input type="radio" name="optCorrect" ${i === 0 ? 'checked' : ''}> 正确</label>
      </div>`).join('')}
    </div>`;
  } else if (type === 'sentence_order') {
    box.innerHTML = `
    <div class="form-row">
      <label>词块（按正确顺序填写，格式：汉字|粤拼，空格分隔）</label>
      <input type="text" placeholder="我|ngo5 想要|soeng2 jiu3 一杯|jat1 bui1 冻|dung3 奶茶|naai5 caa4">
    </div>
    <div class="form-row">
      <label>干扰词（可选，同上格式）</label>
      <input type="text" placeholder="热|jit6">
    </div>
    <div class="form-row">
      <label>普通话提示（翻译题填写；听音排序题留空）</label>
      <input type="text" placeholder="我想要一杯冻奶茶">
    </div>`;
  } else {
    box.innerHTML = `<div class="form-row">
      <label>纠音子类型</label>
      <select><option>跟读单词</option><option>朗读句子</option><option>声调模仿</option></select>
    </div>
    <div class="form-row">
      <label>评测维度</label>
      <span class="hint">发音准确度 / 流畅度 / 完整度（自研比对方案，见文档 §4.4）</span>
    </div>`;
  }
}

function markCorrect(i) {
  picState.correct = i;
  [0, 1, 2, 3].forEach((n) => {
    const cell = $('#picCell' + n);
    cell.classList.toggle('correct', n === i);
    cell.querySelector('.mark').textContent = n === i ? '✔ 正确答案' : '设为答案';
  });
}

/** 选图 -> base64 -> 上传 COS（i = -1 表示题干图） */
function onPickImage(input, i) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    toast('图片上传中…');
    try {
      const d = await api('/api/admin/upload/image', 'POST', { dataUrl: reader.result });
      if (i === -1) {
        picState.stemImage = d.url;
        const prev = $('#stemImgPrev');
        prev.src = d.url;
        prev.classList.remove('hidden');
      } else {
        picState.images[i] = d.url;
        $('#picCell' + i).querySelector('.ph').innerHTML = `<img class="img-prev" src="${d.url}">`;
      }
      toast('图片已上传至 COS');
    } catch (e) {
      toast('上传失败：' + e.message);
    }
  };
  reader.readAsDataURL(file);
  input.value = '';
}

function saveQuestion() {
  const text = $('#fText').value.trim();
  if (!text) return toast('请填写题干');
  const data = {
    type: $('#fType').value,
    text,
    jyut: $('#fJyut').value.trim(),
    hasAudio: $('#fAudioName').textContent !== '未生成',
    status: $('#fStatus').value,
  };
  // 图片题：保存选项图/说明/答案/题干图
  if (data.type === 'pic_choice') {
    [0, 1, 2, 3].forEach((i) => {
      const el = document.getElementById('picLabel' + i);
      if (el) picState.labels[i] = el.value;
    });
    data.options = [0, 1, 2, 3].map((i) => {
      const opt = { id: 'abcd'[i], label: picState.labels[i] || '' };
      if (picState.images[i]) opt.image = picState.images[i];
      return opt;
    });
    data.answer = 'abcd'[picState.correct];
  }
  if (editingQid) {
    const q = questions.find((x) => x.id === editingQid);
    const versionUp = q.status === 'published'; // 已发布题修改 → 新版本
    Object.assign(q, data);
    q.stem = q.stem || {};
    if (pendingAudioUrl) q.stem.audioUrl = pendingAudioUrl;
    if (data.type === 'pic_choice' && picState.stemImage) q.stem.image = picState.stemImage;
    if (versionUp) q.version += 1;
    toast(versionUp ? `已保存并创建新版本 v${q.version}` : '已保存');
  } else {
    const id = 'q' + (Math.max(...questions.map((x) => parseInt(x.id.slice(1)))) + 1);
    const stem = { text: data.text, jyut: data.jyut, audioUrl: pendingAudioUrl || undefined };
    if (data.type === 'pic_choice' && picState.stemImage) stem.image = picState.stemImage;
    questions.push({
      id, ...data, version: 1,
      stem,
      stats: { answerUsers: 0, attempts: 0, rate: 0, firstRate: 0, reviewRate: 0, avgMs: 0, skipRate: 0, repeatWrongRate: 0, optionDist: [0, 0, 0, 0], discrimination: '-', audioFailRate: '-', imgFailRate: '-', asrFailRate: '-' },
    });
    toast(`题目 ${id} 已录入`);
  }
  persist();
  renderQuestions();
  renderQStats();
  closeModal('questionModal');
}

function deleteQuestion(qid) {
  const refs = levelRefCount(qid);
  if (!confirm(refs ? `该题被 ${refs} 个关卡引用，删除后将从关卡中移除，确定？` : '确定删除该题？')) return;
  questions = questions.filter((q) => q.id !== qid);
  levels.forEach((lv) => (lv.questionIds = lv.questionIds.filter((id) => id !== qid)));
  api(`/api/admin/questions/${qid}`, 'DELETE').catch((e) => toast('删除失败：' + e.message));
  renderQuestions();
  renderQStats();
  renderLevels();
  toast('已删除');
}

/* Excel 导入（SheetJS 解析 -> 服务器批量入库） */
let pendingImport = [];

function openImportModal() {
  pendingImport = [];
  $('#dropText').textContent = '点击选择或拖入 Excel 文件';
  $('#importPreview').textContent = '';
  $('#importModal').classList.remove('hidden');
}

/** 下载导入模板（含示例行 + 列说明） */
function downloadTemplate() {
  const rows = [
    { type: 'choice', title: '选择正确的翻译', text: '唔该，埋单！', jyut: 'm4 goi1, maai4 daan1', optionA: '麻烦你，结账！', optionB: '请给我菜单', optionC: '谢谢招待', optionD: '打包带走', answer: 'a', tokens: '', distractors: '', prompt: '', subtype: '', status: 'published' },
    { type: 'sentence_order', title: '把普通话翻译成粤语', text: '', jyut: '', optionA: '', optionB: '', optionC: '', optionD: '', answer: '', tokens: '我/想要/一杯/冻/奶茶', distractors: '热', prompt: '我想要一杯冻奶茶', subtype: '', status: 'published' },
    { type: 'speaking', title: '', text: '早晨', jyut: 'zou2 san4', optionA: '', optionB: '', optionC: '', optionD: '', answer: '', tokens: '', distractors: '', prompt: '', subtype: '跟读单词', status: 'published' },
  ];
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '题目');
  XLSX.writeFile(wb, '粤语题目导入模板.xlsx');
}

$('#fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#dropText').textContent = '已选择：' + file.name;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const wb = XLSX.read(reader.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      pendingImport = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const types = {};
      pendingImport.forEach((r) => (types[r.type] = (types[r.type] || 0) + 1));
      $('#importPreview').textContent = `解析到 ${pendingImport.length} 行：` +
        Object.entries(types).map(([t, n]) => `${t}×${n}`).join('，');
    } catch (err) {
      pendingImport = [];
      $('#importPreview').textContent = '文件解析失败：' + err.message;
    }
  };
  reader.readAsArrayBuffer(file);
  e.target.value = '';
});

async function doImport() {
  if (!pendingImport.length) return toast('请先选择并解析 Excel 文件');
  try {
    const r = await api('/api/admin/questions/import', 'POST', { items: pendingImport });
    closeModal('importModal');
    if (r.failed.length) {
      toast(`导入完成：成功 ${r.done} 题，失败 ${r.failed.length} 行`);
      alert('以下行未导入：\n' + r.failed.map((f) => `第 ${f.row} 行：${f.error}`).join('\n'));
    } else {
      toast(`导入成功：新增 ${r.done} 题，可在题库中「一键生成全部音频」`);
    }
    await bootData();
  } catch (e) {
    toast('导入失败：' + e.message);
  }
}

/* ============ 题目统计 ============ */
function renderQStats() {
  const type = $('#sTypeFilter').value;
  const sort = $('#sSort').value;
  let list = questions.filter((q) => (!type || q.type === type) && q.stats.answerUsers > 0);
  const sorters = {
    rate_asc: (a, b) => a.stats.rate - b.stats.rate,
    rate_desc: (a, b) => b.stats.rate - a.stats.rate,
    skip_desc: (a, b) => b.stats.skipRate - a.stats.skipRate,
    disc_desc: (a, b) => b.stats.discrimination - a.stats.discrimination,
  };
  list.sort(sorters[sort]);
  $('#sTable tbody').innerHTML = list
    .map((q) => {
      const s = q.stats;
      const distSum = s.optionDist.reduce((a, b) => a + b, 0) || 1;
      const dist = s.optionDist.map((v) => `<i style="height:${Math.max(2, Math.round((v / distSum) * 18))}px" title="${Math.round((v / distSum) * 100)}%"></i>`).join('');
      return `<tr>
        <td>${q.id}</td>
        <td>${q.text}</td>
        <td>${s.answerUsers}</td>
        <td>${s.attempts}</td>
        <td class="${rateClass(s.rate)}">${s.rate}%</td>
        <td class="${rateClass(s.firstRate)}">${s.firstRate}%</td>
        <td class="${rateClass(s.reviewRate)}">${s.reviewRate}%</td>
        <td>${(s.avgMs / 1000).toFixed(1)}s</td>
        <td>${s.skipRate}%</td>
        <td>${s.repeatWrongRate}%</td>
        <td><span class="dist">${dist}</span></td>
        <td>${s.discrimination}</td>
        <td>${s.audioFailRate === '-' ? '—' : s.audioFailRate + '%'}</td>
        <td>${s.imgFailRate === '-' ? '—' : s.imgFailRate + '%'}</td>
        <td>${s.asrFailRate === '-' ? '—' : s.asrFailRate + '%'}</td>
      </tr>`;
    })
    .join('');
}

$('#sTypeFilter').addEventListener('change', renderQStats);
$('#sSort').addEventListener('change', renderQStats);

/* ============ 关卡组装 ============ */
function renderLevels() {
  $('#levelGrid').innerHTML = levels
    .map((lv) => {
      const chips = lv.questionIds.slice(0, 6).map((id) => `<span class="q-chip">${id}</span>`).join('') +
        (lv.questionIds.length > 6 ? `<span class="q-chip">+${lv.questionIds.length - 6}</span>` : '');
      return `<div class="level-card">
        <div class="lv-head">
          <h4>${lv.name}</h4>
          <span class="status-dot ${lv.status}">${lv.status === 'online' ? '已上线' : '草稿'}</span>
        </div>
        <div class="lv-desc">${lv.desc}</div>
        <div class="lv-meta">
          <div><b>${lv.questionIds.length}</b><span>题目数</span></div>
          <div><b>${lv.passThreshold}</b><span>通过门槛(题)</span></div>
        </div>
        <div class="lv-qs">${chips}</div>
        <div class="lv-actions">
          <button class="btn ghost sm" onclick="openLevelModal('${lv.id}')">编辑</button>
          <button class="btn danger sm" onclick="deleteLevel('${lv.id}')">删除</button>
        </div>
      </div>`;
    })
    .join('');
}

let editingLid = null;
let pickedQids = [];

function openLevelModal(lid) {
  editingLid = lid || null;
  const lv = lid ? levels.find((x) => x.id === lid) : null;
  $('#lModalTitle').textContent = lv ? `编辑关卡 ${lv.id}` : '新建关卡';
  $('#lName').value = lv ? lv.name : '';
  $('#lDesc').value = lv ? lv.desc : '';
  $('#lThreshold').value = lv ? lv.passThreshold : 8;
  $('#lStatus').value = lv ? lv.status : 'draft';
  $('#lQSearch').value = '';
  pickedQids = lv ? lv.questionIds.slice() : [];
  document.querySelector('input[name="lSource"][value="manual"]').checked = true;
  toggleLevelSource();
  renderLevelPicker();
  $('#levelModal').classList.remove('hidden');
}

function toggleLevelSource() {
  const auto = document.querySelector('input[name="lSource"]:checked').value === 'auto';
  $('#lManualBox').classList.toggle('hidden', auto);
  $('#lAutoBox').classList.toggle('hidden', !auto);
}

function renderLevelPicker() {
  const kw = $('#lQSearch').value.trim().toLowerCase();
  $('#lPicker').innerHTML = questions
    .filter((q) => !kw || q.text.toLowerCase().includes(kw) || q.id.includes(kw))
    .map((q) => {
      const m = TYPE_META[q.type];
      const checked = pickedQids.includes(q.id) ? 'checked' : '';
      return `<label class="picker-item">
        <input type="checkbox" value="${q.id}" ${checked} onchange="togglePick('${q.id}', this.checked)">
        <span class="p-type" style="background:${m.color}">${m.label}</span>
        <span class="p-text">${q.id} · ${q.text}</span>
      </label>`;
    })
    .join('');
  $('#pickedCount').textContent = `已选 ${pickedQids.length} 题`;
}

function togglePick(qid, on) {
  if (on && !pickedQids.includes(qid)) pickedQids.push(qid);
  if (!on) pickedQids = pickedQids.filter((id) => id !== qid);
  $('#pickedCount').textContent = `已选 ${pickedQids.length} 题`;
}

function saveLevel() {
  const name = $('#lName').value.trim();
  if (!name) return toast('请填写关卡名称');
  const auto = document.querySelector('input[name="lSource"]:checked').value === 'auto';
  let qids = pickedQids;
  if (auto) {
    const t = $('#lAutoType').value;
    const n = parseInt($('#lAutoCount').value) || 10;
    const pool = questions.filter((q) => q.status === 'published' && (!t || q.type === t));
    qids = pool.sort(() => Math.random() - 0.5).slice(0, n).map((q) => q.id);
    if (!qids.length) return toast('题库中无符合规则的已发布题目');
  }
  if (!qids.length) return toast('请至少勾选 1 道题');
  const data = {
    name,
    desc: $('#lDesc').value.trim(),
    questionIds: qids,
    passThreshold: parseInt($('#lThreshold').value) || 8,
    status: $('#lStatus').value,
  };
  if (editingLid) {
    Object.assign(levels.find((x) => x.id === editingLid), data);
    toast('关卡已保存');
  } else {
    const id = 'L' + (Math.max(...levels.map((x) => parseInt(x.id.slice(1)))) + 1);
    levels.push({ id, ...data });
    toast(`关卡 ${id} 已创建（含 ${qids.length} 题）`);
  }
  persist();
  renderLevels();
  renderQuestions();
  closeModal('levelModal');
}

function deleteLevel(lid) {
  if (!confirm('确定删除该关卡？题目仍保留在题库中')) return;
  levels = levels.filter((lv) => lv.id !== lid);
  api(`/api/admin/levels/${lid}`, 'DELETE').catch((e) => toast('删除失败：' + e.message));
  renderLevels();
  renderQuestions();
  toast('已删除');
}

/* ============ 录播课管理 ============ */
let courseCats = ['发音入门', '词汇拓展', '商务粤语'];

/* ---- 会员定价 + 订单 ---- */
async function loadMembership() {
  try {
    const m = await api('/api/admin/membership-config');
    document.getElementById('mbEnabled').checked = m.enabled !== false;
    document.getElementById('mbMonth').value = (m.monthFen || 0) / 100;
    document.getElementById('mbYear').value = (m.yearFen || 0) / 100;
    const st = await api('/api/admin/orders');
    document.getElementById('orderStat').textContent = `订单：${st.stat.paid}/${st.stat.total} 已支付 · 营收 ¥${(st.stat.gmvFen / 100).toFixed(2)}`;
  } catch (e) { /* 忽略 */ }
}
async function saveMembership() {
  const body = {
    enabled: document.getElementById('mbEnabled').checked,
    monthFen: Math.round((parseFloat(document.getElementById('mbMonth').value) || 0) * 100),
    yearFen: Math.round((parseFloat(document.getElementById('mbYear').value) || 0) * 100),
  };
  try { await api('/api/admin/membership-config', 'PUT', body); toast('会员定价已保存'); loadMembership(); }
  catch (e) { toast(e.message); }
}
async function loadOrders() {
  const panel = document.getElementById('orderPanel');
  try {
    const d = await api('/api/admin/orders');
    document.getElementById('orderStat').textContent = `订单：${d.stat.paid}/${d.stat.total} 已支付 · 营收 ¥${(d.stat.gmvFen / 100).toFixed(2)}`;
    const st = { pending: '待支付', paid: '已支付', closed: '已关闭' };
    document.getElementById('orderRows').innerHTML = d.list.length
      ? d.list.map((o) => `<tr><td>${new Date(o.createdAt).toLocaleString()}</td><td>${o.studentNo || '—'}</td><td>${o.nickname || '—'}</td><td>${o.type === 'member' ? '会员' : '录播课'}</td><td>${o.title}</td><td>¥${(o.amountFen / 100).toFixed(2)}</td><td>${st[o.status] || o.status}</td></tr>`).join('')
      : '<tr><td colspan="7" style="color:#8a94a3">暂无订单</td></tr>';
    panel.style.display = '';
  } catch (e) { toast(e.message); }
}


/** 渲染上传弹窗的分类下拉（末尾附"＋ 新建分类…"） */
function renderCatSelect(selected) {
  const sel = $('#cCategory');
  sel.innerHTML = courseCats.map((c) => `<option ${c === selected ? 'selected' : ''}>${c}</option>`).join('')
    + '<option value="__new__">＋ 新建分类…</option>';
}

/** 下拉选到"新建分类"时弹输入框 */
function onCategoryChange() {
  const sel = $('#cCategory');
  if (sel.value !== '__new__') return;
  const name = (prompt('新建课程分类名称：') || '').trim();
  if (name && !courseCats.includes(name)) {
    courseCats.push(name);
    saveCatsSilent();
    renderCatSelect(name);
  } else {
    renderCatSelect(courseCats[0]);
  }
}

function renderCourses() {
  $('#courseGrid').innerHTML = courses
    .map((c) => `<div class="course-card">
      <div class="course-cover" style="${c.coverImg ? `background:url('${c.coverImg}') center/cover` : `background:${c.cover}`}">${c.coverImg ? '' : c.name.slice(0, 2)}</div>
      <div class="course-body">
        <h4>${c.name}</h4>
        <div class="c-intro">${c.intro}</div>
        <div class="c-meta">
          <span>${c.category}</span><span>${c.lessons} 课时</span>
          <span>${c.duration}</span><span>${c.views || 0} 人学过</span>
          <span style="color:#12a150">${c.finished || 0} 人学完</span>
          ${c.freeTrial ? '<span style="color:#58cc02">✦ 免费试看</span>' : ''}
          <span style="color:${c.price > 0 ? '#E5541E' : '#8a94a3'};font-weight:600">${c.price > 0 ? '¥' + (c.price / 100).toFixed(2) : '免费'}</span>
        </div>
        <div class="c-actions">
          <label class="switch" title="上架 / 下架">
            <input type="checkbox" ${c.status === 'online' ? 'checked' : ''} onchange="toggleCourse('${c.id}', this.checked)">
            <span class="slider"></span>
          </label>
          <span class="status-dot ${c.status}">${c.status === 'online' ? '已上架' : '已下架'}</span>
          <span class="stu-toggle ${c.studentOnly ? 'on' : ''}" onclick="toggleStudentOnly('${c.id}', ${!c.studentOnly})" title="仅机构学员可见（用户版隐藏）">${c.studentOnly ? '<i class="grad-ic"></i>学员专享' : '设为专享'}</span>
          <span style="flex:1"></span>
          <button class="btn ghost sm" onclick="openCourseModal('${c.id}')">编辑</button>
          <button class="btn danger sm" onclick="deleteCourse('${c.id}')">删除</button>
        </div>
      </div>
    </div>`)
    .join('');
}

function toggleCourse(cid, on) {
  const c = courses.find((x) => x.id === cid);
  c.status = on ? 'online' : 'offline';
  persist();
  renderCourses();
  toast(`「${c.name}」已${on ? '上架' : '下架'}`);
}

function toggleStudentOnly(cid, on) {
  const c = courses.find((x) => x.id === cid);
  c.studentOnly = on;
  persist();
  renderCourses();
  toast(`「${c.name}」${on ? '设为学员专享' : '已对全部用户开放'}`);
}

/* ---- 课程分类管理 ---- */
async function loadCourseCats() {
  try {
    courseCats = await api('/api/admin/courses/categories');
  } catch (e) { /* 保持默认 */ }
}

function saveCatsSilent() {
  api('/api/admin/courses/categories', 'PUT', { categories: courseCats }).catch(() => {});
}

function openCatModal() {
  renderCatList();
  $('#catNew').value = '';
  $('#catModal').classList.remove('hidden');
}

function renderCatList() {
  $('#catList').innerHTML = courseCats
    .map((c, i) => `<div class="cat-mgr-item"><span>${c}</span><span class="cat-del" onclick="removeCat(${i})">删除</span></div>`)
    .join('') || '<div class="hint">暂无分类</div>';
}

function addCat() {
  const v = $('#catNew').value.trim();
  if (!v) return;
  if (courseCats.includes(v)) return toast('该分类已存在');
  courseCats.push(v);
  $('#catNew').value = '';
  renderCatList();
}

function removeCat(i) {
  if (courseCats.length <= 1) return toast('至少保留一个分类');
  const removed = courseCats[i];
  const used = courses.filter((c) => c.category === removed).length;
  if (used && !confirm(`有 ${used} 门课属于「${removed}」，删除后这些课分类会显示为空，确定删除？`)) return;
  courseCats.splice(i, 1);
  renderCatList();
}

async function saveCats() {
  try {
    courseCats = await api('/api/admin/courses/categories', 'PUT', { categories: courseCats });
    toast('分类已保存，小程序顶部筛选栏同步更新');
    closeModal('catModal');
    renderCourses();
  } catch (e) { toast(e.message); }
}

function deleteCourse(cid) {
  if (!confirm('确定删除该课程？')) return;
  courses = courses.filter((c) => c.id !== cid);
  api(`/api/admin/courses/${cid}`, 'DELETE').catch((e) => toast('删除失败：' + e.message));
  renderCourses();
  toast('已删除');
}

let editingCourseId = ''; // 空 = 新建；有值 = 编辑
let pendingCover = '';

function openCourseModal(cid) {
  editingCourseId = cid || '';
  const c = cid ? courses.find((x) => x.id === cid) : null;
  document.querySelector('#courseModal h3').textContent = c ? '编辑课程' : '上传课程';
  $('#cName').value = c ? c.name : '';
  $('#cIntro').value = c ? (c.intro === '暂无简介' ? '' : c.intro) : '';
  renderCatSelect(c ? c.category : courseCats[0]);
  document.querySelector(`input[name="cFree"][value="${c && c.freeTrial ? '1' : '0'}"]`).checked = true;
  $('#cPrice').value = c && c.price ? (c.price / 100) : '';
  if (c) $('#cStatus').value = c.status;
  pendingVideo = { fileId: c ? c.fileId || '' : '', url: c ? c.videoUrl || '' : '' };
  $('#cVideoName').textContent = c && c.videoUrl ? '已有视频 ✓（重新选择可替换）' : '未选择（上传至腾讯云点播，自动转码分发）';
  $('#cVideoProg').classList.add('hidden');
  pendingCover = c ? c.coverImg || '' : '';
  $('#cCoverPrev').classList.toggle('hidden', !pendingCover);
  if (pendingCover) $('#cCoverPrev').src = pendingCover;
  $('#cCoverName').textContent = pendingCover ? '已上传 ✓（重新选择可替换）' : '未上传（将使用配色渐变封面）';
  $('#courseModal').classList.remove('hidden');
}

/* 封面图上传：base64 -> COS（与题图共用通道） */
document.getElementById('cCoverFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return toast('封面请控制在 2MB 内');
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      $('#cCoverName').textContent = '上传中…';
      const d = await api('/api/admin/upload/image', 'POST', { dataUrl: rd.result });
      pendingCover = d.url;
      $('#cCoverPrev').src = pendingCover;
      $('#cCoverPrev').classList.remove('hidden');
      $('#cCoverName').textContent = '已上传 ✓';
    } catch (err) {
      $('#cCoverName').textContent = '上传失败：' + err.message;
    }
  };
  rd.readAsDataURL(file);
});

/* ---- VOD 视频上传（腾讯云点播 JS SDK，后端签名） ---- */
let pendingVideo = { fileId: '', url: '' };

document.getElementById('cVideoFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) uploadVideoToVod(file);
  e.target.value = '';
});

function uploadVideoToVod(file) {
  if (typeof TcVod === 'undefined') return toast('上传 SDK 未加载，请检查网络后刷新');
  const tcVod = new TcVod.default({
    getSignature: () => api('/api/admin/vod/signature').then((d) => d.signature),
  });
  const uploader = tcVod.upload({ mediaFile: file });
  $('#cVideoName').textContent = `上传中：${file.name}`;
  $('#cVideoProg').classList.remove('hidden');
  uploader.on('media_progress', (info) => {
    $('#cVideoBar').style.width = Math.round(info.percent * 100) + '%';
  });
  uploader
    .done()
    .then((res) => {
      pendingVideo = { fileId: res.fileId, url: res.video.url };
      $('#cVideoName').textContent = `已上传 ✓ ${file.name}`;
      toast('视频已上传至云点播');
    })
    .catch((err) => {
      $('#cVideoName').textContent = '上传失败，请重试';
      toast('上传失败：' + (err.message || err));
    });
}

function saveCourse() {
  const name = $('#cName').value.trim();
  if (!name) return toast('请填写课程名称');
  const fields = {
    name,
    intro: $('#cIntro').value.trim() || '暂无简介',
    category: $('#cCategory').value,
    freeTrial: document.querySelector('input[name="cFree"]:checked').value === '1',
    price: Math.max(0, Math.round((parseFloat($('#cPrice').value) || 0) * 100)), // 元 -> 分
    status: $('#cStatus').value,
    fileId: pendingVideo.fileId,
    videoUrl: pendingVideo.url,
    coverImg: pendingCover,
  };
  if (editingCourseId) {
    const c = courses.find((x) => x.id === editingCourseId);
    Object.assign(c, fields);
    toast(`课程「${name}」已更新`);
  } else {
    const id = 'C' + (Math.max(0, ...courses.map((x) => parseInt(x.id.slice(1)))) + 1);
    const colors = ['#58cc02', '#1cb0f6', '#ff9600', '#ce82ff'];
    courses.push({
      id,
      ...fields,
      cover: colors[courses.length % colors.length],
      lessons: pendingVideo.fileId ? 1 : 0,
      duration: '0分',
      views: 0,
    });
    toast(`课程「${name}」已创建`);
  }
  persist();
  renderCourses();
  closeModal('courseModal');
}

/* ============ 初始化：未登录先弹登录，已登录直接拉数据 ============ */
async function bootData() {
  await loadAll();
  await loadCourseCats();
  loadDashboard();
  renderQuestions();
  renderQStats();
  renderLevels();
  renderCourses();
}

document.getElementById('loginPass').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});

if (getToken()) {
  // 有 token：先显示后台外壳并按角色恢复菜单，再拉数据；token 失效则回登录页
  document.getElementById('loginMask').classList.add('hidden');
  document.getElementById('appLayout').classList.remove('hidden');
  applyRole();
  bootData().catch(() => showLogin());
} else {
  showLogin(); // 未登录：只显示登录页，不预渲染后台，避免数据界面闪现
}
