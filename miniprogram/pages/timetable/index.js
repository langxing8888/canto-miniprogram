/**
 * 课表页：月历视图（有课日期标角标）+ 当日课程列表
 * 数据源：/api/my/course 的约课记录（含已完成/已预约）
 */
const api = require('../../utils/api');
const edition = require('../../utils/edition');

const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

function ymd(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

Page({
  data: {
    weekHead: WEEK_HEAD,
    year: 0,
    month: 0, // 1-12
    cells: [], // [{day, date, count, isToday, selected}]
    selDate: '',
    dayList: [],
    monthCount: 0,
  },

  onLoad() {
    const now = new Date();
    this.bookings = [];
    this.setData({ year: now.getFullYear(), month: now.getMonth() + 1, selDate: ymd(now) });
  },

  onShow() {
    if (!edition.guardStudentPage()) return;
    if (!wx.getStorageSync('userToken')) {
      wx.showToast({ title: '请先到「我的」页登录', icon: 'none' });
      return;
    }
    api
      .fetchMyCourse()
      .then((d) => {
        this.bookings = d.bookings.filter((b) => b.status !== 'cancelled');
        // 首次进入自动定位到「最近有课」的月份 + 选中那天（避免约在下月而当前月空白看不到）
        if (!this._positioned) {
          this._positioned = true;
          const todayStr = ymd(new Date());
          const upcoming = this.bookings
            .filter((b) => b.date >= todayStr)
            .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))[0];
          const target = upcoming || this.bookings.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
          if (target) {
            const [ty, tm] = target.date.split('-');
            this.setData({ year: +ty, month: +tm, selDate: target.date });
          }
        }
        this.buildCalendar();
      })
      .catch(() => this.buildCalendar());
  },

  buildCalendar() {
    const { year, month, selDate } = this.data;
    const first = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const leading = (first.getDay() + 6) % 7; // 周一起
    const today = ymd(new Date());
    const countBy = {};
    this.bookings.forEach((b) => {
      countBy[b.date] = (countBy[b.date] || 0) + 1;
    });
    const cells = [];
    for (let i = 0; i < leading; i++) cells.push({ day: '', date: '' });
    let monthCount = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const count = countBy[date] || 0;
      monthCount += count;
      cells.push({ day: d, date, count, isToday: date === today, selected: date === selDate });
    }
    this.setData({ cells, monthCount }, () => this.pickDay(selDate));
  },

  onPrevMonth() {
    let { year, month } = this.data;
    month -= 1;
    if (month < 1) { month = 12; year -= 1; }
    this.setData({ year, month }, () => this.buildCalendar());
  },

  onNextMonth() {
    let { year, month } = this.data;
    month += 1;
    if (month > 12) { month = 1; year += 1; }
    this.setData({ year, month }, () => this.buildCalendar());
  },

  onTapDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({
      selDate: date,
      cells: this.data.cells.map((c) => ({ ...c, selected: c.date === date })),
    });
    this.pickDay(date);
  },

  pickDay(date) {
    const dayList = this.bookings
      .filter((b) => b.date === date)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((b) => ({ ...b, statusText: b.status === 'done' ? '已完成' : '已预约' }));
    this.setData({ selDate: date, dayList });
  },

  goCourse() {
    wx.navigateTo({ url: '/pages/mycourse/index' });
  },
});
