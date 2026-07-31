/**
 * 后台 Mock 数据（静态原型）
 * 字段结构与小程序端 miniprogram/data/*.js 对齐，未来接后端时统一
 */

/* ============ 题库（种子题 + 程序化扩充到 60 道，模拟规模） ============ */
const TYPE_META = {
  pic_choice: { label: '图片选择题', color: '#1cb0f6' },
  choice: { label: '文字选择题', color: '#58cc02' },
  sentence_order: { label: '选词组句', color: '#ff9600' },
  speaking: { label: 'AI纠音题', color: '#ce82ff' },
};

const SEED_QUESTIONS = [
  { id: 'q1', type: 'pic_choice', text: '奶茶', jyut: 'naai5 caa4', hasAudio: true },
  { id: 'q2', type: 'choice', text: '唔该，埋单！', jyut: 'm4 goi1, maai4 daan1', hasAudio: true },
  { id: 'q3', type: 'sentence_order', text: '我想要一杯冻奶茶', jyut: 'ngo5 soeng2 jiu3 jat1 bui1 dung3 naai5 caa4', hasAudio: true },
  { id: 'q4', type: 'pic_choice', text: '菠萝油', jyut: 'bo1 lo4 jau4', hasAudio: false },
  { id: 'q5', type: 'choice', text: '食（汉字选粤拼）', jyut: 'sik6', hasAudio: false },
  { id: 'q6', type: 'choice', text: 'caa4（粤拼选汉字）', jyut: 'caa4', hasAudio: false },
  { id: 'q7', type: 'choice', text: '你食咗饭未？（听音选句）', jyut: 'nei5 sik6 zo2 faan6 mei6', hasAudio: true },
  { id: 'q8', type: 'sentence_order', text: '唔该俾杯水我（听音排序）', jyut: 'm4 goi1 bei2 bui1 seoi2 ngo5', hasAudio: true },
  { id: 'q9', type: 'choice', text: '加多杯柠茶（语境辨析）', jyut: 'gaa1 do1 bui1 ling2 caa4', hasAudio: false },
  { id: 'q10', type: 'speaking', text: '唔该，埋单（朗读句子）', jyut: 'm4 goi1, maai4 daan1', hasAudio: true },
  { id: 'q11', type: 'pic_choice', text: '早晨', jyut: 'zou2 san4', hasAudio: true },
  { id: 'q12', type: 'choice', text: '唔该晒！', jyut: 'm4 goi1 saai3', hasAudio: true },
  { id: 'q13', type: 'choice', text: '多谢 定 唔该（辨析）', jyut: 'do1 ze6 / m4 goi1', hasAudio: false },
  { id: 'q14', type: 'sentence_order', text: '你叫咩名呀？', jyut: 'nei5 giu3 me1 meng2 aa3', hasAudio: true },
  { id: 'q15', type: 'choice', text: '唔（汉字选粤拼）', jyut: 'm4', hasAudio: false },
  { id: 'q16', type: 'choice', text: 'zou2 san4（粤拼选词）', jyut: 'zou2 san4', hasAudio: false },
  { id: 'q17', type: 'choice', text: '几耐（听音选词）', jyut: 'gei2 noi6', hasAudio: true },
  { id: 'q18', type: 'sentence_order', text: '好耐冇见喇（听音排序）', jyut: 'hou2 noi6 mou5 gin3 laa3', hasAudio: true },
  { id: 'q19', type: 'pic_choice', text: '拜拜', jyut: 'baai1 baai3', hasAudio: false },
  { id: 'q20', type: 'speaking', text: '早晨（跟读单词）', jyut: 'zou2 san4', hasAudio: true },
  { id: 'q21', type: 'pic_choice', text: '巴士', jyut: 'baa1 si2', hasAudio: true },
  { id: 'q22', type: 'choice', text: '点去地铁站呀？', jyut: 'dim2 heoi3 dei6 tit3 zaam6 aa3', hasAudio: true },
  { id: 'q23', type: 'sentence_order', text: '我想搭的士去机场', jyut: 'ngo5 soeng2 daap3 dik1 si2 heoi3 gei1 coeng4', hasAudio: true },
  { id: 'q24', type: 'choice', text: '唔该，借问声…（问路礼貌语）', jyut: 'm4 goi1, ze3 man6 seng1', hasAudio: false },
  { id: 'q25', type: 'choice', text: '行（汉字选粤拼）', jyut: 'haang4', hasAudio: false },
  { id: 'q26', type: 'choice', text: 'dei6 tit3（粤拼选词）', jyut: 'dei6 tit3', hasAudio: false },
  { id: 'q27', type: 'choice', text: '喺边度落车呀？（听音选句）', jyut: 'hai2 bin1 dou6 lok6 ce1 aa3', hasAudio: true },
  { id: 'q28', type: 'sentence_order', text: '前面转左就到喇（听音排序）', jyut: 'cin4 min6 zyun3 zo2 zau6 dou3 laa3', hasAudio: true },
  { id: 'q29', type: 'pic_choice', text: '地铁', jyut: 'dei6 tit3', hasAudio: false },
  { id: 'q30', type: 'speaking', text: '九（声调模仿）', jyut: 'gau2', hasAudio: true },
];

/* 伪随机（固定种子，保证每次打开数据一致） */
function seededRand(seed) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function buildQuestions() {
  const rand = seededRand(42);
  const extraTexts = [
    ['几多钱呀？', 'gei2 do1 cin2 aa3'], ['我唔识听', 'ngo5 m4 sik1 teng1'],
    ['唔紧要', 'm4 gan2 jiu3'], ['好味！', 'hou2 mei6'], ['慢慢行', 'maan6 maan2 haang4'],
    ['听日见', 'ting1 jat6 gin3'], ['落雨喇', 'lok6 jyu5 laa3'], ['我钟意', 'ngo5 zung1 ji3'],
    ['唔使客气', 'm4 sai2 haak3 hei3'], ['一齐食饭', 'jat1 cai4 sik6 faan6'],
  ];
  const types = ['pic_choice', 'choice', 'choice', 'sentence_order', 'speaking'];
  const list = SEED_QUESTIONS.map((q) => ({ ...q }));
  for (let i = 31; i <= 60; i++) {
    const t = extraTexts[(i - 31) % extraTexts.length];
    list.push({
      id: 'q' + i,
      type: types[i % types.length],
      text: t[0],
      jyut: t[1],
      hasAudio: rand() > 0.3,
    });
  }
  // 为每题生成统计指标（对应文档「每道题至少要统计」的全部字段）
  return list.map((q, idx) => {
    const answerUsers = Math.floor(80 + rand() * 900); // 作答人数
    const attempts = Math.floor(answerUsers * (1.1 + rand() * 1.6)); // 作答次数
    const firstRate = Math.round(45 + rand() * 50); // 首次正确率
    const rate = Math.min(99, firstRate + Math.round(rand() * 18)); // 正确率
    const reviewRate = Math.min(99, rate + Math.round(rand() * 8)); // 复习正确率
    return {
      ...q,
      status: idx < 54 ? 'published' : 'draft',
      version: idx % 7 === 3 ? 2 : 1,
      stats: {
        answerUsers,
        attempts,
        rate,
        firstRate,
        reviewRate,
        avgMs: Math.floor(2500 + rand() * 9000), // 平均答题时间
        skipRate: q.type === 'speaking' ? Math.round(20 + rand() * 40) : Math.round(rand() * 6), // 跳过率
        repeatWrongRate: Math.round(rand() * 22), // 重复错误率
        optionDist: [0, 0, 0, 0].map(() => Math.round(rand() * 100)), // 各选项被选比例（归一化前）
        discrimination: (0.15 + rand() * 0.55).toFixed(2), // 区分度
        audioFailRate: q.hasAudio ? (rand() * 2).toFixed(1) : '-', // 音频播放失败率
        imgFailRate: q.type === 'pic_choice' ? (rand() * 1.5).toFixed(1) : '-', // 图片加载失败率
        asrFailRate: q.type === 'speaking' ? (rand() * 5).toFixed(1) : '-', // 语音识别失败率
      },
    };
  });
}

const MOCK_QUESTIONS = buildQuestions();

/* ============ 关卡 ============ */
const MOCK_LEVELS = [
  { id: 'L1', name: '第1关：茶餐厅点单', desc: '学会用粤语点奶茶、菠萝油同埋埋单', questionIds: ['q1','q2','q3','q4','q5','q6','q7','q8','q9','q10'], passThreshold: 8, status: 'online' },
  { id: 'L2', name: '第2关：日常问候', desc: '早晨、唔该晒，打招呼唔使怕', questionIds: ['q11','q12','q13','q14','q15','q16','q17','q18','q19','q20'], passThreshold: 8, status: 'online' },
  { id: 'L3', name: '第3关：出行交通', desc: '搭巴士定搭地铁？问路都识讲', questionIds: ['q21','q22','q23','q24','q25','q26','q27','q28','q29','q30'], passThreshold: 8, status: 'online' },
  { id: 'L4', name: '第4关：街市买餸', desc: '斤两点讲价，买菜唔怕蚀底', questionIds: ['q31','q32','q33','q34','q35','q36','q37','q38','q39','q40'], passThreshold: 8, status: 'online' },
  { id: 'L5', name: '第5关：睇医生', desc: '唔舒服点同医生讲', questionIds: ['q41','q42','q43','q44','q45','q46','q47','q48','q49','q50'], passThreshold: 7, status: 'draft' },
];

/* ============ 录播课 ============ */
const MOCK_COURSES = [
  { id: 'C1', name: '粤语发音入门：九声六调', category: '发音入门', cover: '#58cc02', intro: '从零开始掌握粤拼与声调系统', lessons: 8, duration: '3小时20分', freeTrial: true, status: 'online', views: 1286 },
  { id: 'C2', name: '茶餐厅生存粤语', category: '词汇拓展', cover: '#1cb0f6', intro: '点餐、埋单、搭台全场景对话', lessons: 6, duration: '2小时10分', freeTrial: true, status: 'online', views: 967 },
  { id: 'C3', name: '商务粤语速成', category: '商务粤语', cover: '#ff9600', intro: '开会、接待、电话沟通实用表达', lessons: 10, duration: '4小时05分', freeTrial: false, status: 'online', views: 432 },
  { id: 'C4', name: '港剧台词精讲', category: '词汇拓展', cover: '#ce82ff', intro: '经典港剧对白逐句拆解', lessons: 12, duration: '5小时30分', freeTrial: false, status: 'offline', views: 0 },
];

/* ============ 教务统计大盘（对应文档 5.4 全部指标） ============ */
const MOCK_DASHBOARD = {
  students: {
    total: 3286, newToday: 47, new7d: 312, paid: 861, free: 2425, vipExpiring: 38,
    activeToday: 604, active7d: 1523, active30d: 2210, finishedToday: 389,
  },
  retention: { d3: 62, d7: 45, d30: 28 }, // N日留存率 %
  accuracy: { today: 78, d7: 76, d30: 74, first: 68 }, // 正确率 %
  behavior: {
    avgMinutesToday: 14.6, avgMinutes7d: 12.8, avgDaysPerWeek: 4.2,
    avgQuestionsToday: 32, avgQuestions7d: 28,
    avgStreak: 5.8, streak3: 892, streak7: 431, streak20: 96, streakBroken: 214,
  },
  levelFunnel: { started: 2841, finished: 2258, finishRate: 79, firstPassRate: 64, avgTries: 1.6, avgMinutes: 4.3, quitRate: 12 },
  alerts: {
    churnRisk: 126, // 近7日可能流失
    churnRules: ['连续3天未学习：74人', '连续7天未学习：29人', '学习频率明显下降：43人', '连续多次未完成关卡：18人', '最近正确率持续下降：22人'],
    highActive: 126, // 近7日高活跃
    highRules: ['连续学习天数较长：58人', '完成课程较多：41人', '学习时长较高：67人', '掌握率较高：52人', '付费可能性较高：33人'],
  },
  accuracy7dTrend: [72, 75, 74, 77, 76, 79, 78], // 近7日正确率趋势
  active7dTrend: [488, 512, 540, 495, 570, 610, 604], // 近7日活跃趋势
};
