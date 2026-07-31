/* 教师工作台：登录 → 我的课表 / 我的学生 / 课堂笔记；批注跳转 annotate 页（带 stu 隔离） */
const $ = (s) => document.querySelector(s);
let token = localStorage.getItem('teacherToken') || '';
let me = { name: '', teacherId: '' };
let myStudents = [];
let noteImgs = [];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-auth-token': token, ...(opts.headers || {}) },
  });
  const j = await r.json();
  if (r.status === 401) { logout(); throw new Error('登录已过期'); }
  if (!j.ok) throw new Error(j.error || '请求失败');
  return j;
}

/* ---------- 登录 ---------- */
async function doLogin() {
  try {
    const r = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('#lu').value.trim(), password: $('#lp').value }),
    }).then((x) => x.json());
    if (!r.ok) return toast(r.error || '账号或密码错误');
    // 授课老师 / 教务 / 超管可进入
    if (!['tutor', 'teacher', 'super'].includes(r.data.role)) return toast('该账号无教师工作台权限');
    token = r.data.token;
    me = { name: r.data.name, teacherId: r.data.teacherId || '' };
    localStorage.setItem('teacherToken', token);
    localStorage.setItem('teacherMe', JSON.stringify(me));
    boot();
  } catch (e) { toast(e.message); }
}

function logout() {
  localStorage.removeItem('teacherToken');
  token = '';
  $('#app').style.display = 'none';
  $('#loginBox').classList.remove('hidden');
}

function boot() {
  $('#loginBox').classList.add('hidden');
  $('#app').style.display = 'block';
  $('#whoName').textContent = me.name || '';
  loadSchedule();
  loadStudents();
  loadNotes();
}

/* ---------- Tab ---------- */
function switchTab(el) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.remove('on'));
  el.classList.add('on');
  document.querySelectorAll('.page').forEach((p) => p.classList.add('hidden'));
  $('#pg-' + el.dataset.tab).classList.remove('hidden');
  if (el.dataset.tab === 'booking') loadBookingTab();
  if (el.dataset.tab === 'records') { initRecordDates(); loadRecords(); }
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
function fmtDate(d) {
  const dt = new Date(d.replace(/-/g, '/'));
  return { md: (dt.getMonth() + 1) + '/' + dt.getDate(), wk: '周' + WEEK[dt.getDay()] };
}

/* ---------- 我的课表 ---------- */
async function loadSchedule() {
  try {
    const d = (await api('/api/admin/my/schedule')).data;
    if (!d.bound) {
      $('#bindTip').innerHTML = '<div class="card" style="background:#fff7ef;border-color:#ffd9b8;color:#a15a1e">你的账号还没有绑定授课老师身份，请让管理员在后台「系统设置 / 账号」里把你的账号绑定到对应老师，即可看到自己的课表与学生。</div>';
      $('#upcomingList').innerHTML = '<div class="empty">—</div>';
      $('#historyList').innerHTML = '<div class="empty">—</div>';
      return;
    }
    $('#bindTip').innerHTML = '';
    // 待补笔记提醒（催老师上传笔记）
    const nr = $('#noteRemind');
    if (d.pendingNotes > 0) {
      nr.innerHTML = `📝 你有 <b>${d.pendingNotes}</b> 节课还没上传课堂笔记，记得给学生补上～（点下方带「待补笔记」标记的课）`;
      nr.classList.remove('hidden');
    } else {
      nr.classList.add('hidden');
    }
    const up = d.bookings.filter((b) => b.upcoming);
    const his = d.bookings.filter((b) => !b.upcoming);
    const row = (b) => {
      const f = fmtDate(b.date);
      const pill = b.upcoming ? '<span class="pill up">即将上课</span>'
        : (b.needNote ? '<span class="pill note">待补笔记</span>' : '<span class="pill done">已完成</span>');
      return `<div class="lesson"${b.needNote ? ` onclick="openStudent('${b.uid}','${b.studentNo || ''}')" style="cursor:pointer"` : ''}>
        <div class="date"><b>${f.md}</b><span>${f.wk}</span></div>
        <div class="info"><div class="t">${b.start}–${b.end}　学号 ${b.studentNo || '—'}</div>
          <div class="s">${b.upcoming ? '待上课' : (b.needNote ? '点此给他上传笔记' : '已完成')}</div></div>
        ${pill}
      </div>`;
    };
    $('#upcomingList').innerHTML = up.length ? up.map(row).join('') : '<div class="empty">近期暂无排课</div>';
    $('#historyList').innerHTML = his.length ? his.map(row).join('') : '<div class="empty">暂无历史课程</div>';
    loadToday();
    loadWeek();
  } catch (e) { toast(e.message); }
}

/* ---------- 周网格课表（大学课表样式：横轴周一~日，纵轴按小时） ---------- */
let weekMonday = ''; // 当前查看的周一（空=本周）
const WK_START_HOUR = 8;  // 网格起始小时
const WK_END_HOUR = 22;   // 网格结束小时
function weekNav(dir) {
  if (dir === 0) { weekMonday = ''; }
  else {
    const base = weekMonday ? new Date(weekMonday.replace(/-/g, '/')) : mondayOf(new Date());
    base.setDate(base.getDate() + dir * 7);
    weekMonday = base.toISOString().slice(0, 10);
  }
  loadWeek();
}
function mondayOf(d) {
  const x = new Date(d); const wd = x.getDay() || 7;
  x.setDate(x.getDate() - (wd - 1)); x.setHours(0, 0, 0, 0); return x;
}
async function loadWeek() {
  try {
    const q = weekMonday ? '?monday=' + weekMonday : '';
    const d = (await api('/api/admin/my/week' + q)).data;
    renderWeekGrid(d);
  } catch (e) { /* 未绑定静默 */ }
}
function renderWeekGrid(d) {
  const days = d.days || [];
  if (!days.length) { $('#weekGrid').innerHTML = ''; return; }
  const today = new Date().toISOString().slice(0, 10);
  $('#weekRange').textContent = `${days[0].slice(5)} ~ ${days[6].slice(5)}`;
  const hours = WK_END_HOUR - WK_START_HOUR;
  const ROW = 44; // 每小时行高，与 .wg-cell min-height 一致
  let html = '<div class="wg-corner"></div>';
  // 表头：7 天
  days.forEach((dt) => {
    const o = new Date(dt.replace(/-/g, '/'));
    html += `<div class="wg-dayhead${dt === today ? ' today' : ''}"><b>${WEEK[o.getDay()]}</b><span>${dt.slice(5)}</span></div>`;
  });
  // 时间网格：每小时一行
  for (let h = WK_START_HOUR; h < WK_END_HOUR; h++) {
    html += `<div class="wg-cell wg-time">${String(h).padStart(2, '0')}:00</div>`;
    for (let i = 0; i < 7; i++) html += `<div class="wg-cell" data-day="${i}" data-hour="${h}"></div>`;
  }
  $('#weekGrid').innerHTML = html;
  // 放置课块（绝对定位到对应日列容器）——用列包裹层定位更稳：这里改用按天分组叠加
  const grid = $('#weekGrid');
  const gridRect = grid.getBoundingClientRect();
  // 计算每列 left：借助表头单元格位置
  const heads = grid.querySelectorAll('.wg-dayhead');
  (d.items || []).forEach((it) => {
    const di = days.indexOf(it.date);
    if (di < 0) return;
    const sh = toMin(it.start), eh = toMin(it.end);
    const top = ((sh - WK_START_HOUR * 60) / 60) * ROW + 41; // 41=表头高
    const height = Math.max(20, ((eh - sh) / 60) * ROW - 3);
    const col = heads[di];
    const left = col.offsetLeft, width = col.offsetWidth;
    const cls = it.kind === 'open' ? 'open' : (it.status === 'done' ? 'done' : 'booked');
    const nm = it.kind === 'open' ? '可约' : (it.nickname || ('学号' + (it.studentNo || '')));
    const ev = document.createElement('div');
    ev.className = 'wg-ev ' + cls;
    ev.style.cssText = `top:${top}px;height:${height}px;left:${left + 2}px;width:${width - 4}px`;
    ev.innerHTML = `<b>${nm}</b><small>${it.start}–${it.end}</small>`;
    grid.appendChild(ev);
  });
}
function toMin(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }


/* ---------- 今日课表 + 点名 ---------- */
async function loadToday() {
  try {
    const list = (await api('/api/admin/my/today')).data;
    const now = new Date();
    const curHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    $('#todayList').innerHTML = list.length ? list.map((b) => {
      const ended = b.end < curHM || b.status === 'done';
      const nm = b.nickname || ('学号 ' + (b.studentNo || b.uid.slice(0, 6)));
      let right;
      if (b.attend && b.attend !== 'none') {
        const label = { present: '已签到', leave: '已请假', absent: '已缺课' }[b.attend];
        right = `<span class="att-done ${b.attend}">${label}</span>`;
      } else if (ended) {
        right = `<div class="att-btns">
          <button class="present" onclick="doAttend('${b.id}','present')">签到</button>
          <button class="leave" onclick="doAttend('${b.id}','leave')">请假</button>
          <button class="absent" onclick="doAttend('${b.id}','absent')">缺课</button></div>`;
      } else {
        right = '<span class="tag">待上课</span>';
      }
      return `<div class="slot-li"><div><b>${b.start}–${b.end}</b>　${nm}<div style="font-size:12px;color:#8a94a6">剩 ${b.remain} 课时</div></div>${right}</div>`;
    }).join('') : '<div class="empty">今天没有课</div>';
  } catch (e) { /* 未绑定等，静默 */ }
}
async function doAttend(id, attend) {
  try {
    const r = (await api('/api/admin/my/attend', { method: 'POST', body: JSON.stringify({ id, attend }) })).data;
    toast({ present: '已签到，消 1 课时', leave: '已记请假（不消课）', absent: '已记缺课' }[attend] + (r.deducted ? `　剩 ${r.remain} 课时` : ''));
    loadToday();
  } catch (e) { toast(e.message); }
}

/* ---------- 开放约课 Tab ---------- */
function switchSub(el) {
  document.querySelectorAll('.sub-tab').forEach((t) => t.classList.remove('on'));
  el.classList.add('on');
  $('#sub-open').classList.toggle('hidden', el.dataset.sub !== 'open');
  $('#sub-rest').classList.toggle('hidden', el.dataset.sub !== 'rest');
}
async function loadBookingTab() {
  try {
    const sc = (await api('/api/admin/my/schedule')).data;
    $('#acceptToggle').checked = sc.acceptBooking !== false;
    // 未来可约时段
    $('#openSlotList').innerHTML = (sc.slots || []).length ? sc.slots.map((s) => {
      const f = fmtDate(s.date);
      return `<div class="slot-li"><div><b>${f.md} ${f.wk}</b>　${s.start}–${s.end}</div><span class="del" onclick="delSlot('${s.id}')">删除</span></div>`;
    }).join('') : '<div class="empty">暂无可约时段，去上方新增</div>';
    // 规则
    const rules = (await api('/api/admin/my/rules')).data;
    $('#ruleList').innerHTML = rules.length ? rules.map((r) => {
      const desc = r.mode === 'free' ? `${r.date} 单次` : '每周' + (r.weekdays || []).map((d) => WEEK[d]).join('、');
      const end = r.endType === 'count' ? `共${r.count}次(已排${r.generated || 0})` : r.endType === 'date' ? `至${r.endDate}` : '长期';
      const off = r.status === 'off' ? ' <span style="color:#9aa3ae">(已停)</span>' : '';
      return `<div class="slot-li"><div><b>${r.start}–${r.end}</b>　${desc}<div style="font-size:12px;color:#8a94a6">${end}${r.skipHoliday ? ' · 节假日跳过' : ''}${off}</div></div><span class="del" onclick="delRule('${r.id}')">删除</span></div>`;
    }).join('') : '<div class="empty">还没有排课规则</div>';
    // 休息
    const rest = (await api('/api/admin/my/rest')).data;
    $('#restList').innerHTML = rest.length ? rest.map((r) => {
      const f = fmtDate(r.date);
      return `<div class="slot-li"><div><b>${f.md} ${f.wk}</b>　${r.start}–${r.end}${r.note ? '　' + r.note : ''}</div><span class="del" onclick="delRest('${r.id}')">删除</span></div>`;
    }).join('') : '<div class="empty">没有设置休息时间</div>';
  } catch (e) { toast(e.message); }
}
async function toggleAccept() {
  try {
    const accept = $('#acceptToggle').checked;
    await api('/api/admin/my/accept', { method: 'POST', body: JSON.stringify({ accept }) });
    toast(accept ? '已开启接受约课' : '已暂停接受约课（学生约不到你）');
  } catch (e) { toast(e.message); $('#acceptToggle').checked = !$('#acceptToggle').checked; }
}
async function delSlot(id) { if (!confirm('删除该可约时段？')) return; try { await api('/api/admin/my/slots?id=' + id, { method: 'DELETE' }); loadBookingTab(); } catch (e) { toast(e.message); } }
async function delRule(id) { if (!confirm('删除该规则？将清掉它生成的未被约时段（已约的课保留）')) return; try { await api('/api/admin/my/rules?id=' + id, { method: 'DELETE' }); toast('已删除'); loadBookingTab(); } catch (e) { toast(e.message); } }
async function delRest(id) { if (!confirm('删除该休息时间？')) return; try { await api('/api/admin/my/rest?id=' + id, { method: 'DELETE' }); loadBookingTab(); } catch (e) { toast(e.message); } }

/* ---------- 排课弹层 ---------- */
let ruleMode = 'rule';
function openRuleModal() {
  ruleMode = 'rule';
  document.querySelectorAll('.seg-i').forEach((s) => s.classList.toggle('on', s.dataset.mode === 'rule'));
  $('#weekRow').classList.remove('hidden'); $('#dateRow').classList.add('hidden');
  $('#weekPick').innerHTML = [1, 2, 3, 4, 5, 6, 0].map((d) => `<span data-d="${d}" onclick="this.classList.toggle('on')">${WEEK[d]}</span>`).join('');
  const today = new Date().toISOString().slice(0, 10);
  $('#rmStartDate').value = today; $('#rmDate').value = today;
  $('#rmEndType').value = 'none'; onEndType();
  $('#rmSkipHoliday').checked = false;
  $('#ruleModal').classList.remove('hidden');
}
function pickMode(el) {
  ruleMode = el.dataset.mode;
  document.querySelectorAll('.seg-i').forEach((s) => s.classList.remove('on'));
  el.classList.add('on');
  $('#weekRow').classList.toggle('hidden', ruleMode === 'free');
  $('#dateRow').classList.toggle('hidden', ruleMode !== 'free');
  $('#startRow').classList.toggle('hidden', ruleMode === 'free');
  $('#endRow').classList.toggle('hidden', ruleMode === 'free');
  if (ruleMode === 'free') { $('#countRow').classList.add('hidden'); $('#endDateRow').classList.add('hidden'); }
}
function onEndType() {
  const v = $('#rmEndType').value;
  $('#countRow').classList.toggle('hidden', v !== 'count');
  $('#endDateRow').classList.toggle('hidden', v !== 'date');
}
function qt(s, e) { $('#rmStart').value = s; $('#rmEnd').value = e; }
function closeModal(id) { $('#' + id).classList.add('hidden'); }
async function submitRule() {
  const body = { mode: ruleMode, start: $('#rmStart').value, end: $('#rmEnd').value, skipHoliday: $('#rmSkipHoliday').checked };
  if (ruleMode === 'rule') {
    body.weekdays = [...document.querySelectorAll('#weekPick span.on')].map((s) => +s.dataset.d);
    body.startDate = $('#rmStartDate').value;
    body.endType = $('#rmEndType').value;
    body.count = +$('#rmCount').value; body.endDate = $('#rmEndDate').value;
  } else {
    body.date = $('#rmDate').value; body.endType = 'none';
  }
  try {
    const r = (await api('/api/admin/my/rules', { method: 'POST', body: JSON.stringify(body) })).data;
    toast(`已保存，生成 ${r.added} 个可约时段`);
    closeModal('ruleModal'); loadBookingTab();
  } catch (e) { toast(e.message); }
}
function openRestModal() {
  const today = new Date().toISOString().slice(0, 10);
  $('#rsDate').value = today; $('#rsStart').value = '12:00'; $('#rsEnd').value = '14:00'; $('#rsNote').value = '';
  $('#restModal').classList.remove('hidden');
}
async function submitRest() {
  const body = { date: $('#rsDate').value, start: $('#rsStart').value, end: $('#rsEnd').value, note: $('#rsNote').value };
  try {
    const r = (await api('/api/admin/my/rest', { method: 'POST', body: JSON.stringify(body) })).data;
    toast(r.bookedConflict > 0 ? `已设休息；注意有 ${r.bookedConflict} 节已约课在此时段，请手动改约` : '已设休息时间');
    closeModal('restModal'); loadBookingTab();
  } catch (e) { toast(e.message); }
}

/* ---------- 上课记录 ---------- */
function initRecordDates() {
  if ($('#recTo').value) return;
  const now = new Date();
  $('#recTo').value = now.toISOString().slice(0, 10);
  $('#recFrom').value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}
async function loadRecords() {
  try {
    const q = `?from=${$('#recFrom').value}&to=${$('#recTo').value}`;
    const d = (await api('/api/admin/my/records' + q)).data;
    const s = d.stat || {};
    $('#recStat').innerHTML = [
      ['总课次', s.total || 0], ['已签到', s.present || 0], ['请假', s.leave || 0], ['缺课', s.absent || 0], ['待点名', s.pending || 0], ['消耗课时', s.consumed || 0],
    ].map(([l, v]) => `<div class="kpi-c"><b>${v}</b><span>${l}</span></div>`).join('');
    $('#recList').innerHTML = (d.list || []).length ? d.list.map((b) => {
      const f = fmtDate(b.date);
      const nm = b.nickname || ('学号 ' + (b.studentNo || ''));
      const map = { present: ['已签到', 'present'], leave: ['请假', 'leave'], absent: ['缺课', 'absent'], none: ['待点名', ''], booked: ['未上课', ''] };
      const [label, cls] = map[b.attend] || ['—', ''];
      const right = b.attend === 'none'
        ? `<div class="att-btns"><button class="present" onclick="recAttend('${b.id}','present')">签到</button><button class="leave" onclick="recAttend('${b.id}','leave')">请假</button><button class="absent" onclick="recAttend('${b.id}','absent')">缺课</button></div>`
        : `<span class="att-done ${cls}">${label}${b.deducted ? ' · 已消课' : ''}</span>`;
      return `<div class="slot-li"><div><b>${f.md}</b>　${b.start}–${b.end}　${nm}</div>${right}</div>`;
    }).join('') : '<div class="empty">该区间无上课记录</div>';
  } catch (e) { toast(e.message); }
}
async function recAttend(id, attend) {
  try { await api('/api/admin/my/attend', { method: 'POST', body: JSON.stringify({ id, attend }) }); toast('已点名'); loadRecords(); } catch (e) { toast(e.message); }
}

/* ---------- 我的学生 ---------- */
async function loadStudents() {
  try {
    myStudents = (await api('/api/admin/my/students')).data;
    const sel = $('#ntStu');
    sel.innerHTML = '<option value="">发给全体学生（公开）</option>' +
      myStudents.map((s) => `<option value="${s.uid}" data-no="${s.studentNo}">学号 ${s.studentNo || s.uid.slice(0, 6)}</option>`).join('');
    $('#stuList').innerHTML = myStudents.length ? myStudents.map((s) => {
      const no = String(s.studentNo || s.uid.slice(0, 6));
      return `<div class="stu-item" onclick="openStudent('${s.uid}','${no}')">
        <div class="stu-av">${no.slice(-2)}</div>
        <div class="nm"><b>学号 ${no}</b><span>已上 ${s.lessons} 节 · 剩 ${s.remain} 课时</span></div>
        <span class="go">›</span>
      </div>`;
    }).join('') : '<div class="empty">还没有学生约过你的课</div>';
  } catch (e) { toast(e.message); }
}

/* ---------- 学生详情：课本 / 批注 / 专属笔记 ---------- */
let curStu = null;

async function openStudent(uid, no) {
  curStu = { uid, no };
  $('#stuListView').classList.add('hidden');
  $('#stuDetailView').classList.remove('hidden');
  $('#sdHead').innerHTML = '<div class="empty">加载中…</div>';
  $('#sdBooks').innerHTML = '';
  $('#sdNotes').innerHTML = '';
  try {
    const d = (await api('/api/admin/my/student-books?uid=' + encodeURIComponent(uid))).data;
    curStu.name = d.nickname || ('学号 ' + no);
    const clsText = d.classTag ? d.classTag + ' 类教材' : '未分班';
    $('#sdHead').innerHTML = `<div class="big-av">${no.slice(-2)}</div>
      <div class="hd-info"><b>${d.nickname || '学员'} · 学号 ${no}</b>
      <span>${clsText} · 当前第 ${d.curBook} 册第 ${d.curChapter} 章 · 剩 ${d.remain} 课时</span></div>`;
    // 课本列表：点击进入该生专属批注
    $('#sdBooks').innerHTML = d.books.length ? d.books.map((b) => `<div class="book-item">
        <div class="book-cover">${b.name.slice(0, 2)}</div>
        <div class="bk" onclick="annotateBook('${b.id}','${uid}','${no}')">
          <b>${b.name}${b.current ? '<span class="cur-tag">在学</span>' : ''}</b>
          <span>${b.pages} 页 · ${b.category} 类 · 点击进入批注</span>
        </div>
      </div>`).join('') : '<div class="empty">该学生分类下暂无课本，请先在后台上传教材并设置分类</div>';
    // 专属笔记
    const notes = (await api('/api/admin/notes?uid=' + encodeURIComponent(uid))).data.filter((n) => n.uid === uid);
    $('#sdNotes').innerHTML = notes.length ? notes.map((n) => `<div class="note-item">
        <h4>${n.title}</h4>
        <div class="meta">${new Date(n.ts).toLocaleString('zh-CN', { hour12: false })}
          <span style="color:#e5342e;cursor:pointer;margin-left:8px" onclick="delNote('${n.id}', true)">删除</span></div>
        ${n.text ? `<div class="txt">${n.text}</div>` : ''}
        ${n.images && n.images.length ? `<div class="nimgs">${n.images.map((u) => `<img src="${u}">`).join('')}</div>` : ''}
      </div>`).join('') : '<div class="empty">还没有给他发过笔记</div>';
  } catch (e) { toast(e.message); }
}

function backToStuList() {
  $('#stuDetailView').classList.add('hidden');
  $('#stuListView').classList.remove('hidden');
  curStu = null;
}

/* 进入某本课本的该生专属批注台 */
function annotateBook(matId, uid, no) {
  location.href = `/annotate/?id=${matId}&stu=${uid}&sno=${encodeURIComponent(no)}`;
}

/* 详情页快捷发笔记：跳笔记 Tab 并预选该生 */
function quickNoteFromDetail() {
  if (!curStu) return;
  switchTab(document.querySelector('.tab[data-tab="notes"]'));
  const sel = $('#ntStu');
  sel.value = curStu.uid;
  $('#ntTitle').focus();
  toast('已选择：学号 ' + curStu.no);
}

/* ---------- 课堂笔记 ---------- */
$('#ntFile').addEventListener('change', async function () {
  const f = this.files[0];
  this.value = '';
  if (!f) return;
  if (f.size > 5 * 1024 * 1024) return toast('图片请小于 5MB');
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      toast('上传中…');
      const d = (await api('/api/admin/upload/image', { method: 'POST', body: JSON.stringify({ dataUrl: rd.result }) })).data;
      noteImgs.push(d.url);
      renderNoteImgs();
    } catch (e) { toast(e.message); }
  };
  rd.readAsDataURL(f);
});

function renderNoteImgs() {
  $('#ntImgs').innerHTML = noteImgs.map((u, i) => `<img src="${u}" onclick="removeNoteImg(${i})" title="点击移除">`).join('');
}
function removeNoteImg(i) { noteImgs.splice(i, 1); renderNoteImgs(); }

async function submitNote() {
  const title = $('#ntTitle').value.trim();
  if (!title) return toast('请填写笔记标题');
  const uid = $('#ntStu').value;
  const opt = $('#ntStu').selectedOptions[0];
  const studentNo = opt ? (opt.dataset.no || '') : '';
  try {
    await api('/api/admin/notes', {
      method: 'POST',
      body: JSON.stringify({ uid, studentNo, title, text: $('#ntText').value.trim(), images: noteImgs }),
    });
    $('#ntTitle').value = ''; $('#ntText').value = ''; noteImgs = []; renderNoteImgs();
    toast('笔记已发布');
    loadNotes();
  } catch (e) { toast(e.message); }
}

async function loadNotes() {
  try {
    const list = (await api('/api/admin/notes')).data;
    $('#noteList').innerHTML = list.length ? list.map((n) => `<div class="note-item">
        <h4>${n.title}</h4>
        <div class="meta">${n.uid ? '发给 学号' + (n.studentNo || '指定学生') : '全体公开'} · ${new Date(n.ts).toLocaleString('zh-CN', { hour12: false })}
          <span style="color:#e5342e;cursor:pointer;margin-left:8px" onclick="delNote('${n.id}')">删除</span></div>
        ${n.text ? `<div class="txt">${n.text}</div>` : ''}
        ${n.images && n.images.length ? `<div class="nimgs">${n.images.map((u) => `<img src="${u}">`).join('')}</div>` : ''}
      </div>`).join('') : '<div class="empty">还没有发布过笔记</div>';
  } catch (e) { toast(e.message); }
}

async function delNote(id, fromDetail) {
  if (!confirm('确定删除这条笔记？学生将不再看到。')) return;
  try {
    await api('/api/admin/notes/' + id, { method: 'DELETE' });
    toast('已删除');
    loadNotes();
    if (fromDetail && curStu) openStudent(curStu.uid, curStu.no);
  } catch (e) { toast(e.message); }
}

/* ---------- 启动 ---------- */
if (token) {
  try { me = JSON.parse(localStorage.getItem('teacherMe') || '{}'); } catch (e) { me = {}; }
  boot();
}
