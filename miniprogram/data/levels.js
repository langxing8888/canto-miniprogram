/**
 * 示例关卡配置（Mock）
 * 后续接后端时，此文件由 GET /levels 接口替代
 */
module.exports = [
  {
    id: 'L1',
    name: '第1关：茶餐厅点单',
    desc: '学会用粤语点奶茶、菠萝油同埋埋单',
    questionIds: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'],
    passThreshold: 8, // 首答对 8 题以上算通关
  },
  {
    id: 'L2',
    name: '第2关：日常问候',
    desc: '早晨、唔该晒，打招呼唔使怕',
    questionIds: ['q11', 'q12', 'q13', 'q14', 'q15', 'q16', 'q17', 'q18', 'q19', 'q20'],
    passThreshold: 8,
  },
  {
    id: 'L3',
    name: '第3关：出行交通',
    desc: '搭巴士定搭地铁？问路都识讲',
    questionIds: ['q21', 'q22', 'q23', 'q24', 'q25', 'q26', 'q27', 'q28', 'q29', 'q30'],
    passThreshold: 8,
  },
];
