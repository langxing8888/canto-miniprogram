/**
 * 轻量 JSON 文件数据库
 * - 每个集合对应 data/ 下一个 .json 文件
 * - 原子写入（先写临时文件再改名），避免断电写坏
 * - 起步期够用；数据量大后可平滑迁移 MySQL，接口层不变
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const cache = {};

function fileOf(name) {
  return path.join(DATA_DIR, name + '.json');
}

function load(name, def) {
  if (cache[name] !== undefined) return cache[name];
  try {
    const raw = fs.readFileSync(fileOf(name), 'utf8');
    cache[name] = JSON.parse(raw);
  } catch (e) {
    cache[name] = def === undefined ? null : def;
  }
  return cache[name];
}

function save(name, data) {
  cache[name] = data;
  const file = fileOf(name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/** 追加到数组集合（带容量上限，防止无限膨胀） */
function append(name, items, cap) {
  let list = load(name, []);
  list = list.concat(items);
  if (cap && list.length > cap) list = list.slice(list.length - cap);
  save(name, list);
  return list.length;
}

module.exports = { load, save, append, DATA_DIR };
