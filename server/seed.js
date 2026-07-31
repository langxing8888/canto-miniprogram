/**
 * 种子数据导入：把小程序 Mock 题库/关卡灌入 JSON 数据库
 * 仅在本地开发机执行：node seed.js
 * （打包上服务器时 data/ 已包含生成好的数据库文件，服务器无需再跑）
 */
const path = require('path');
const db = require('./lib/jsondb');

function tryRequire(p) {
  try {
    return require(p);
  } catch (e) {
    return null;
  }
}

/* ---------- 题库 + 关卡（来自小程序 Mock 数据） ---------- */
const questions = tryRequire(path.join(__dirname, '..', 'miniprogram', 'data', 'questions.js'));
const levels = tryRequire(path.join(__dirname, '..', 'miniprogram', 'data', 'levels.js'));

if (!questions || !levels) {
  console.error('未找到 ../miniprogram/data 下的种子数据（服务器环境无需执行本脚本）');
  process.exit(1);
}

db.save(
  'questions',
  questions.map((q) => ({ ...q, status: 'published', version: 1 }))
);

db.save(
  'levels',
  levels.map((lv) => ({ ...lv, status: 'online' }))
);

/* ---------- 录播课 ---------- */
db.save('courses', [
  { id: 'C1', name: '粤语发音入门：九声六调', category: '发音入门', cover: '#58cc02', intro: '从零开始掌握粤拼与声调系统', lessons: 8, duration: '3小时20分', freeTrial: true, status: 'online', views: 0 },
  { id: 'C2', name: '茶餐厅生存粤语', category: '词汇拓展', cover: '#1cb0f6', intro: '点餐、埋单、搭台全场景对话', lessons: 6, duration: '2小时10分', freeTrial: true, status: 'online', views: 0 },
  { id: 'C3', name: '商务粤语速成', category: '商务粤语', cover: '#ff9600', intro: '开会、接待、电话沟通实用表达', lessons: 10, duration: '4小时05分', freeTrial: false, status: 'offline', views: 0 },
]);

/* ---------- 空集合初始化 ---------- */
if (!db.load('results')) db.save('results', []);
if (!db.load('logs')) db.save('logs', []);

console.log('种子数据导入完成：');
console.log(`  questions: ${db.load('questions').length} 道`);
console.log(`  levels:    ${db.load('levels').length} 关`);
console.log(`  courses:   ${db.load('courses').length} 门`);
console.log(`  数据库目录: ${db.DATA_DIR}`);
