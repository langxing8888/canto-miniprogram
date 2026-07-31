/**
 * 示例题库（Mock，覆盖全部题型）
 * 题型 type:
 *  - pic_choice      看图选词 / 听音选图（2x2 大卡片，点卡即判）
 *  - choice          文字选择题（翻译/辨析/汉字选粤拼/粤拼选汉字/听音选词选句）
 *  - sentence_order  单词排序成句 / 听音排序（点击词块飞入槽位，提交判定）
 *  - speaking        口语题（首版占位，可跳过）
 * 字段约定：
 *  - stem.audioUrl   有值则显示左上角小人播放入口并自动播放一次
 *  - stem.slowable   听力题为 true，显示「小乌龟」慢速按钮
 *  - Mock 阶段音频为本地占位文件，正式版由后台 TTS 生成后替换
 */
const A1 = '/assets/audio/demo1.wav';
const A2 = '/assets/audio/demo2.wav';
const A3 = '/assets/audio/demo3.wav';

module.exports = [
  /* ================= 第1关：茶餐厅点单 ================= */
  {
    id: 'q1',
    type: 'pic_choice',
    title: '听录音，选出对应的图片',
    stem: { text: '奶茶', jyut: 'naai5 caa4', audioUrl: A1 },
    options: [
      { id: 'a', emoji: '🧋', label: '奶茶' },
      { id: 'b', emoji: '☕', label: '咖啡' },
      { id: 'c', emoji: '🥤', label: '汽水' },
      { id: 'd', emoji: '🍺', label: '啤酒' },
    ],
    answer: 'a',
  },
  {
    id: 'q2',
    type: 'choice',
    title: '选择正确的翻译',
    stem: { text: '唔该，埋单！', jyut: 'm4 goi1, maai4 daan1', audioUrl: A2 },
    options: [
      { id: 'a', text: '麻烦你，结账！' },
      { id: 'b', text: '请给我菜单' },
      { id: 'c', text: '谢谢招待' },
      { id: 'd', text: '打包带走' },
    ],
    answer: 'a',
  },
  {
    id: 'q3',
    type: 'sentence_order',
    title: '把普通话翻译成粤语',
    prompt: '我想要一杯冻奶茶',
    stem: { audioUrl: A3 },
    tokens: [
      { text: '我', jyut: 'ngo5' },
      { text: '想要', jyut: 'soeng2 jiu3' },
      { text: '一杯', jyut: 'jat1 bui1' },
      { text: '冻', jyut: 'dung3' },
      { text: '奶茶', jyut: 'naai5 caa4' },
    ],
    distractors: [{ text: '热', jyut: 'jit6' }],
  },
  {
    id: 'q4',
    type: 'pic_choice',
    title: '看图片，选出正确的词',
    stem: { emoji: '🍞🧈' },
    options: [
      { id: 'a', label: '菠萝油', jyut: 'bo1 lo4 jau4' },
      { id: 'b', label: '蛋挞', jyut: 'daan6 taat1' },
      { id: 'c', label: '西多士', jyut: 'sai1 do1 si2' },
      { id: 'd', label: '云吞面', jyut: 'wan4 tan1 min6' },
    ],
    answer: 'a',
  },
  {
    id: 'q5',
    type: 'choice',
    title: '为汉字选择正确的粤拼',
    stem: { text: '食' },
    options: [
      { id: 'a', text: 'sik6' },
      { id: 'b', text: 'si6' },
      { id: 'c', text: 'zik6' },
      { id: 'd', text: 'sek3' },
    ],
    answer: 'a',
  },
  {
    id: 'q6',
    type: 'choice',
    title: '为粤拼选择正确的汉字',
    stem: { text: 'caa4' },
    options: [
      { id: 'a', text: '茶' },
      { id: 'b', text: '叉' },
      { id: 'c', text: '车' },
      { id: 'd', text: '差' },
    ],
    answer: 'a',
  },
  {
    id: 'q7',
    type: 'choice',
    title: '听录音，选出你听到的句子',
    stem: { text: '你食咗饭未？', jyut: 'nei5 sik6 zo2 faan6 mei6', audioUrl: A1, slowable: true, hideText: true },
    options: [
      { id: 'a', text: '你食咗饭未？' },
      { id: 'b', text: '你饮咗茶未？' },
      { id: 'c', text: '你落咗单未？' },
      { id: 'd', text: '你买咗嘢未？' },
    ],
    answer: 'a',
  },
  {
    id: 'q8',
    type: 'sentence_order',
    title: '听录音，把句子排列出来',
    stem: { audioUrl: A2, slowable: true },
    tokens: [
      { text: '唔该', jyut: 'm4 goi1' },
      { text: '俾', jyut: 'bei2' },
      { text: '杯', jyut: 'bui1' },
      { text: '水', jyut: 'seoi2' },
      { text: '我', jyut: 'ngo5' },
    ],
    distractors: [],
  },
  {
    id: 'q9',
    type: 'choice',
    title: '在茶餐厅想再要一杯柠檬茶，应该点讲？',
    stem: { text: '选出最合适的表达' },
    options: [
      { id: 'a', text: '唔该，加多杯柠茶' },
      { id: 'b', text: '喂，柠茶快啲' },
      { id: 'c', text: '我要柠茶你知唔知' },
      { id: 'd', text: '柠茶喺边度' },
    ],
    answer: 'a',
  },
  {
    id: 'q10',
    type: 'speaking',
    subtype: '朗读句子',
    stem: { text: '唔该，埋单', jyut: 'm4 goi1, maai4 daan1', audioUrl: A3 },
  },

  /* ================= 第2关：日常问候 ================= */
  {
    id: 'q11',
    type: 'pic_choice',
    title: '听录音，选出对应的图片',
    stem: { text: '早晨', jyut: 'zou2 san4', audioUrl: A1 },
    options: [
      { id: 'a', emoji: '🌅', label: '早晨' },
      { id: 'b', emoji: '🌙', label: '晚安' },
      { id: 'c', emoji: '👋', label: '再见' },
      { id: 'd', emoji: '🙏', label: '多谢' },
    ],
    answer: 'a',
  },
  {
    id: 'q12',
    type: 'choice',
    title: '选择正确的翻译',
    stem: { text: '唔该晒！', jyut: 'm4 goi1 saai3', audioUrl: A2 },
    options: [
      { id: 'a', text: '太感谢你了！（劳烦别人后）' },
      { id: 'b', text: '不用客气！' },
      { id: 'c', text: '对不起！' },
      { id: 'd', text: '没关系！' },
    ],
    answer: 'a',
  },
  {
    id: 'q13',
    type: 'choice',
    title: '收到朋友送嘅礼物，道谢应该讲？',
    stem: { text: '「多谢」定「唔该」？' },
    options: [
      { id: 'a', text: '多谢' },
      { id: 'b', text: '唔该' },
      { id: 'c', text: '唔使' },
      { id: 'd', text: '好话' },
    ],
    answer: 'a',
  },
  {
    id: 'q14',
    type: 'sentence_order',
    title: '把普通话翻译成粤语',
    prompt: '你叫什么名字呀？',
    stem: { audioUrl: A3 },
    tokens: [
      { text: '你', jyut: 'nei5' },
      { text: '叫', jyut: 'giu3' },
      { text: '咩', jyut: 'me1' },
      { text: '名', jyut: 'meng2' },
      { text: '呀', jyut: 'aa3' },
    ],
    distractors: [{ text: '边个', jyut: 'bin1 go3' }],
  },
  {
    id: 'q15',
    type: 'choice',
    title: '为汉字选择正确的粤拼',
    stem: { text: '唔' },
    options: [
      { id: 'a', text: 'm4' },
      { id: 'b', text: 'ng5' },
      { id: 'c', text: 'wu4' },
      { id: 'd', text: 'mou5' },
    ],
    answer: 'a',
  },
  {
    id: 'q16',
    type: 'choice',
    title: '为粤拼选择正确的词语',
    stem: { text: 'zou2 san4' },
    options: [
      { id: 'a', text: '早晨' },
      { id: 'b', text: '早唞' },
      { id: 'c', text: '走先' },
      { id: 'd', text: '祖先' },
    ],
    answer: 'a',
  },
  {
    id: 'q17',
    type: 'choice',
    title: '听录音，选出你听到的词',
    stem: { text: '几耐', jyut: 'gei2 noi6', audioUrl: A1, slowable: true, hideText: true },
    options: [
      { id: 'a', text: '几耐' },
      { id: 'b', text: '几多' },
      { id: 'c', text: '几时' },
      { id: 'd', text: '几好' },
    ],
    answer: 'a',
  },
  {
    id: 'q18',
    type: 'sentence_order',
    title: '听录音，把句子排列出来',
    stem: { audioUrl: A2, slowable: true },
    tokens: [
      { text: '好耐', jyut: 'hou2 noi6' },
      { text: '冇', jyut: 'mou5' },
      { text: '见', jyut: 'gin3' },
      { text: '喇', jyut: 'laa3' },
    ],
    distractors: [{ text: '唔', jyut: 'm4' }],
  },
  {
    id: 'q19',
    type: 'pic_choice',
    title: '看图片，选出正确的词',
    stem: { emoji: '👋' },
    options: [
      { id: 'a', label: '拜拜', jyut: 'baai1 baai3' },
      { id: 'b', label: '早晨', jyut: 'zou2 san4' },
      { id: 'c', label: '你好', jyut: 'nei5 hou2' },
      { id: 'd', label: '多谢', jyut: 'do1 ze6' },
    ],
    answer: 'a',
  },
  {
    id: 'q20',
    type: 'speaking',
    subtype: '跟读单词',
    stem: { text: '早晨', jyut: 'zou2 san4', audioUrl: A3 },
  },

  /* ================= 第3关：出行交通 ================= */
  {
    id: 'q21',
    type: 'pic_choice',
    title: '听录音，选出对应的图片',
    stem: { text: '巴士', jyut: 'baa1 si2', audioUrl: A1 },
    options: [
      { id: 'a', emoji: '🚌', label: '巴士' },
      { id: 'b', emoji: '🚇', label: '地铁' },
      { id: 'c', emoji: '🚕', label: '的士' },
      { id: 'd', emoji: '🚲', label: '单车' },
    ],
    answer: 'a',
  },
  {
    id: 'q22',
    type: 'choice',
    title: '选择正确的翻译',
    stem: { text: '点去地铁站呀？', jyut: 'dim2 heoi3 dei6 tit3 zaam6 aa3', audioUrl: A2 },
    options: [
      { id: 'a', text: '地铁站怎么走呀？' },
      { id: 'b', text: '地铁站在哪层呀？' },
      { id: 'c', text: '地铁几点开呀？' },
      { id: 'd', text: '地铁票多少钱呀？' },
    ],
    answer: 'a',
  },
  {
    id: 'q23',
    type: 'sentence_order',
    title: '把普通话翻译成粤语',
    prompt: '我想搭出租车去机场',
    stem: { audioUrl: A3 },
    tokens: [
      { text: '我', jyut: 'ngo5' },
      { text: '想', jyut: 'soeng2' },
      { text: '搭', jyut: 'daap3' },
      { text: '的士', jyut: 'dik1 si2' },
      { text: '去', jyut: 'heoi3' },
      { text: '机场', jyut: 'gei1 coeng4' },
    ],
    distractors: [{ text: '巴士', jyut: 'baa1 si2' }],
  },
  {
    id: 'q24',
    type: 'choice',
    title: '喺街边想礼貌咁问路，开头应该讲？',
    stem: { text: '选出最合适的表达' },
    options: [
      { id: 'a', text: '唔该，借问声…' },
      { id: 'b', text: '喂，你过嚟' },
      { id: 'c', text: '你识唔识路㗎' },
      { id: 'd', text: '快啲话我知' },
    ],
    answer: 'a',
  },
  {
    id: 'q25',
    type: 'choice',
    title: '为汉字选择正确的粤拼',
    stem: { text: '行（行路）' },
    options: [
      { id: 'a', text: 'haang4' },
      { id: 'b', text: 'hong4' },
      { id: 'c', text: 'hang6' },
      { id: 'd', text: 'gaang1' },
    ],
    answer: 'a',
  },
  {
    id: 'q26',
    type: 'choice',
    title: '为粤拼选择正确的词语',
    stem: { text: 'dei6 tit3' },
    options: [
      { id: 'a', text: '地铁' },
      { id: 'b', text: '地毯' },
      { id: 'c', text: '低调' },
      { id: 'd', text: '大堂' },
    ],
    answer: 'a',
  },
  {
    id: 'q27',
    type: 'choice',
    title: '听录音，选出你听到的句子',
    stem: { text: '喺边度落车呀？', jyut: 'hai2 bin1 dou6 lok6 ce1 aa3', audioUrl: A1, slowable: true, hideText: true },
    options: [
      { id: 'a', text: '喺边度落车呀？' },
      { id: 'b', text: '喺边度上车呀？' },
      { id: 'c', text: '喺边度买飞呀？' },
      { id: 'd', text: '喺边度等车呀？' },
    ],
    answer: 'a',
  },
  {
    id: 'q28',
    type: 'sentence_order',
    title: '听录音，把句子排列出来',
    stem: { audioUrl: A2, slowable: true },
    tokens: [
      { text: '前面', jyut: 'cin4 min6' },
      { text: '转左', jyut: 'zyun3 zo2' },
      { text: '就', jyut: 'zau6' },
      { text: '到', jyut: 'dou3' },
      { text: '喇', jyut: 'laa3' },
    ],
    distractors: [{ text: '转右', jyut: 'zyun3 jau6' }],
  },
  {
    id: 'q29',
    type: 'pic_choice',
    title: '看图片，选出正确的词',
    stem: { emoji: '🚇' },
    options: [
      { id: 'a', label: '地铁', jyut: 'dei6 tit3' },
      { id: 'b', label: '巴士', jyut: 'baa1 si2' },
      { id: 'c', label: '电车', jyut: 'din6 ce1' },
      { id: 'd', label: '渡轮', jyut: 'dou6 leon4' },
    ],
    answer: 'a',
  },
  {
    id: 'q30',
    type: 'speaking',
    subtype: '声调模仿',
    stem: { text: '九', jyut: 'gau2', audioUrl: A3 },
  },
];
