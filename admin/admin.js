/**
 * 粤语学习后台 · 静态原型交互逻辑
 * 数据初始化自 mock-data.js，增删改持久化到 localStorage
 */

/* ============ 本地数据层 ============ */
const DB = {
  load(key, fallback) {
    try {
      const v = localStorage.getItem('cantoAdmin_' + key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  },
  save(key, val) {
    localStorage.setItem('cantoAdmin_' + key, JSON.stringify(val));
  },
};

let questions = DB.load('questions', MOCK_QUESTIONS);
let levels = DB.load('levels', MOCK_LEVELS);
let courses = DB.load('courses', MOCK_COURSES);

function persist() {
  DB.save('questions', questions);
  DB.save('levels', levels);
  DB.save('courses', courses);
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
function mockTts() { $('#fAudioName').textContent = '已生成 standard.mp3（TTS）'; toast('TTS 合成成功，音频已存对象存储（原型演示）'); }

/* ============ 页面切换 ============ */
const PAGE_TITLES = {
  dashboard: '数据概览',
  questions: '题库管理',
  qstats: '题目统计',
  levels: '关卡组装',
  courses: '录播课管理',
};

$$('.menu-item').forEach((item) => {
  item.addEventListener('click', () => {
    $$('.menu-item').forEach((i) => i.classList.remove('active'));
    item.classList.add('active');
    const page = item.dataset.page;
    $$('.page').forEach((p) => p.classList.add('hidden'));
    $('#page-' + page).classList.remove('hidden');
    $('#pageTitle').textContent = PAGE_TITLES[page];
  });
});

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

function renderDashboard() {
  const d = MOCK_DASHBOARD;
  const s = d.students;
  $('#eduCards').innerHTML = [
    card(s.total, '累计学生数', 'green'),
    card('+' + s.newToday, '今日新增', 'blue'),
    card('+' + s.new7d, '近7日新增', 'blue'),
    card(s.paid, '付费学生', 'orange'),
    card(s.free, '免费学生'),
    card(s.vipExpiring, '会员到期(30日内)', 'red'),
    card(s.activeToday, '今日活跃', 'green'),
    card(s.active7d, '近7日活跃', 'green'),
    card(s.active30d, '近30日活跃', 'green'),
    card(s.finishedToday, '今日完成学习', 'blue'),
  ].join('');

  $('#retentionBars').innerHTML =
    hbar('3日留存率', d.retention.d3, '#58cc02') +
    hbar('7日留存率', d.retention.d7, '#1cb0f6') +
    hbar('30日留存率', d.retention.d30, '#ff9600');

  $('#accuracyBars').innerHTML =
    hbar('今日正确率', d.accuracy.today, '#58cc02') +
    hbar('近7日正确率', d.accuracy.d7, '#58cc02') +
    hbar('近30日正确率', d.accuracy.d30, '#58cc02') +
    hbar('首次作答正确率', d.accuracy.first, '#ce82ff');

  const days = ['一', '二', '三', '四', '五', '六', '日'];
  $('#trendAccuracy').innerHTML = d.accuracy7dTrend
    .map((v, i) => `<div class="bar" style="height:${v}%"><span class="v">${v}%</span><span class="d">周${days[i]}</span></div>`)
    .join('');
  const maxA = Math.max(...d.active7dTrend);
  $('#trendActive').innerHTML = d.active7dTrend
    .map((v, i) => `<div class="bar blue" style="height:${Math.round((v / maxA) * 100)}%"><span class="v">${v}</span><span class="d">周${days[i]}</span></div>`)
    .join('');

  const b = d.behavior;
  $('#behaviorCards').innerHTML = [
    card(b.avgMinutesToday + ' 分', '今日人均学习时长（剔除挂机）', 'green'),
    card(b.avgMinutes7d + ' 分', '近7日人均学习时长', 'green'),
    card(b.avgDaysPerWeek + ' 天', '每周平均学习天数'),
    card(b.avgQuestionsToday, '今日人均答题数', 'blue'),
    card(b.avgQuestions7d, '近7日人均答题数', 'blue'),
    card(b.avgStreak + ' 天', '平均连续学习天数', 'orange'),
    card(b.streak3, '连续学习 3 天以上'),
    card(b.streak7, '连续学习 7 天以上'),
    card(b.streak20, '连续学习 20 天以上'),
    card(b.streakBroken, '连续学习中断', 'red'),
  ].join('');

  const f = d.levelFunnel;
  $('#funnelCards').innerHTML = [
    card(f.started, '关卡开始人数'),
    card(f.finished, '关卡完成人数'),
    card(f.finishRate + '%', '关卡完成率', 'green'),
    card(f.firstPassRate + '%', '首次通过率', 'blue'),
    card(f.avgTries, '平均尝试次数'),
    card(f.avgMinutes + ' 分', '平均完成时间'),
    card(f.quitRate + '%', '中途退出率', 'red'),
  ].join('');

  $('#churnNum').textContent = d.alerts.churnRisk + ' 人';
  $('#highNum').textContent = d.alerts.highActive + ' 人';
  $('#churnRules').innerHTML = d.alerts.churnRules.map((r) => `<li>${r}</li>`).join('');
  $('#highRules').innerHTML = d.alerts.highRules.map((r) => `<li>${r}</li>`).join('');
}

/* ============ 题库管理 ============ */
function renderQuestions() {
  const type = $('#qTypeFilter').value;
  const status = $('#qStatusFilter').value;
  const kw = $('#qSearch').value.trim().toLowerCase();
  const rows = questions
    .filter((q) => (!type || q.type === type) && (!status || q.status === status))
    .filter((q) => !kw || q.text.toLowerCase().includes(kw) || q.jyut.toLowerCase().includes(kw) || q.id.includes(kw))
    .map((q) => `<tr>
      <td>${q.id}</td>
      <td>${typeTag(q.type)}</td>
      <td>${q.text}</td>
      <td style="color:#1cb0f6">${q.jyut}</td>
      <td>${q.hasAudio ? '🔊' : '—'}</td>
      <td>v${q.version}</td>
      <td><span class="status-dot ${q.status}">${q.status === 'published' ? '已发布' : '草稿'}</span></td>
      <td>${levelRefCount(q.id)} 个关卡</td>
      <td>
        <span class="op-link" onclick="openQuestionModal('${q.id}')">编辑</span>
        <span class="op-link del" onclick="deleteQuestion('${q.id}')">删除</span>
      </td>
    </tr>`);
  $('#qTable tbody').innerHTML = rows.join('') || '<tr><td colspan="9" style="text-align:center;color:#999">无匹配题目</td></tr>';
}

['qTypeFilter', 'qStatusFilter'].forEach((id) => $('#' + id).addEventListener('change', renderQuestions));
$('#qSearch').addEventListener('input', renderQuestions);

let editingQid = null;

function openQuestionModal(qid) {
  editingQid = qid || null;
  const q = qid ? questions.find((x) => x.id === qid) : null;
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
function renderTypeFields() {
  const type = $('#fType').value;
  const box = $('#typeFields');
  if (type === 'pic_choice') {
    box.innerHTML = `<div class="form-row">
      <label>4 张图片（2×2 排布，点「设为答案」标记正确图）</label>
      <div class="pic-grid">
        ${[0, 1, 2, 3].map((i) => `
        <div class="pic-cell ${i === 0 ? 'correct' : ''}" id="picCell${i}">
          <div class="ph" onclick="mockUpload('图片')">🖼️</div>
          <input type="text" placeholder="图片说明，如：奶茶">
          <span class="mark" onclick="markCorrect(${i})">${i === 0 ? '✔ 正确答案' : '设为答案'}</span>
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
  [0, 1, 2, 3].forEach((n) => {
    const cell = $('#picCell' + n);
    cell.classList.toggle('correct', n === i);
    cell.querySelector('.mark').textContent = n === i ? '✔ 正确答案' : '设为答案';
  });
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
  if (editingQid) {
    const q = questions.find((x) => x.id === editingQid);
    const versionUp = q.status === 'published'; // 已发布题修改 → 新版本
    Object.assign(q, data);
    if (versionUp) q.version += 1;
    toast(versionUp ? `已保存并创建新版本 v${q.version}` : '已保存');
  } else {
    const id = 'q' + (Math.max(...questions.map((x) => parseInt(x.id.slice(1)))) + 1);
    questions.push({
      id, ...data, version: 1,
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
  persist();
  renderQuestions();
  renderQStats();
  renderLevels();
  toast('已删除');
}

/* Excel 导入 */
function openImportModal() {
  $('#dropText').textContent = '点击选择或拖入 Excel 文件';
  $('#importModal').classList.remove('hidden');
}

$('#fileInput').addEventListener('change', (e) => {
  if (e.target.files[0]) $('#dropText').textContent = '已选择：' + e.target.files[0].name;
});

function mockImport() {
  closeModal('importModal');
  toast('导入成功：新增 238 题，跳过 2 行格式错误（原型演示）');
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
  persist();
  renderLevels();
  renderQuestions();
  toast('已删除');
}

/* ============ 录播课管理 ============ */
function renderCourses() {
  $('#courseGrid').innerHTML = courses
    .map((c) => `<div class="course-card">
      <div class="course-cover" style="background:${c.cover}">${c.name.slice(0, 2)}</div>
      <div class="course-body">
        <h4>${c.name}</h4>
        <div class="c-intro">${c.intro}</div>
        <div class="c-meta">
          <span>📂 ${c.category}</span><span>🎞 ${c.lessons} 课时</span>
          <span>⏱ ${c.duration}</span><span>👁 ${c.views}</span>
          ${c.freeTrial ? '<span style="color:#58cc02">✦ 免费试看</span>' : ''}
        </div>
        <div class="c-actions">
          <label class="switch" title="上架 / 下架">
            <input type="checkbox" ${c.status === 'online' ? 'checked' : ''} onchange="toggleCourse('${c.id}', this.checked)">
            <span class="slider"></span>
          </label>
          <span class="status-dot ${c.status}">${c.status === 'online' ? '已上架' : '已下架'}</span>
          <span style="flex:1"></span>
          <button class="btn ghost sm" onclick="toast('课时/章节编辑（原型演示）')">章节</button>
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

function deleteCourse(cid) {
  if (!confirm('确定删除该课程？')) return;
  courses = courses.filter((c) => c.id !== cid);
  persist();
  renderCourses();
  toast('已删除');
}

function openCourseModal() {
  $('#cName').value = '';
  $('#cIntro').value = '';
  $('#courseModal').classList.remove('hidden');
}

function saveCourse() {
  const name = $('#cName').value.trim();
  if (!name) return toast('请填写课程名称');
  const id = 'C' + (Math.max(...courses.map((x) => parseInt(x.id.slice(1)))) + 1);
  const colors = ['#58cc02', '#1cb0f6', '#ff9600', '#ce82ff'];
  courses.push({
    id,
    name,
    intro: $('#cIntro').value.trim() || '暂无简介',
    category: $('#cCategory').value,
    cover: colors[courses.length % colors.length],
    lessons: 0,
    duration: '0分',
    freeTrial: document.querySelector('input[name="cFree"]:checked').value === '1',
    status: $('#cStatus').value,
    views: 0,
  });
  persist();
  renderCourses();
  closeModal('courseModal');
  toast(`课程「${name}」已创建，可继续添加章节课时`);
}

/* ============ 初始化 ============ */
renderDashboard();
renderQuestions();
renderQStats();
renderLevels();
renderCourses();
