/**
 * 约课页：日历式（周视图默认，下拉展开整月，可翻月）+ 选中日的时段列表
 * - 顶部年月 + 展开/收起箭头；周一~日表头
 * - 有可约时段的日期打橙点；点日期 → 下方只看当天时段
 * - 可约显示「预约」，已约显示「已预约」（可点取消）
 */
const api = require('../../utils/api');
const edition = require('../../utils/edition');

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const ymd = (dt) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
/** 时段起始是否仍在未来（按北京时间，与设备时区无关）：date=YYYY-MM-DD, hm=HH:mm */
const futureSlot = (date, hm) => new Date(`${date}T${hm}:00+08:00`).getTime() > Date.now();

Page({
  data: {
    expanded: false,       // false=周视图 / true=月视图
    year: 0, month: 0,     // 当前展示的年、月（月视图翻月用）
    title: '',             // 顶部标题 2026年 07月
    weekHead: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],             // 当前视图的日期格 [{date, day, today, sel, dot, out}]
    activeDate: '',
    curSlots: [],
    slotsByDate: {},
    loading: true,
    todayStr: '',
    minDate: '', maxDate: '', // 可约窗
  },

  onShow() {
    if (!edition.guardStudentPage()) return;
    this.load();
  },

  load() {
    this.setData({ loading: true });
    Promise.all([
      api.fetchOpenSlots(),
      api.fetchMyCourse().catch(() => ({ bookings: [] })),
      api.fetchAppConfig().catch(() => ({})),
    ])
      .then(([open, mine, cfg]) => {
        const now = new Date(Date.now() + 8 * 3600000);
        const todayStr = ymd(now);
        const aheadDays = (cfg && cfg.bookAheadDays >= 1) ? cfg.bookAheadDays : 7;
        const myBooked = (mine.bookings || []).filter((b) => b.status === 'booked');

        const byDate = {};
        open.forEach((sl) => {
          if (!futureSlot(sl.date, sl.start)) return; // 已过起始时间的时段不再展示（按北京时间）
          (byDate[sl.date] = byDate[sl.date] || []).push({
            id: sl.id, start: sl.start, end: sl.end, teacherName: sl.teacherName, booked: false, bookingId: '',
          });
        });
        myBooked.forEach((b) => {
          if (!futureSlot(b.date, b.start)) return; // 已过的已约课归入课表，不在约课日历展示
          (byDate[b.date] = byDate[b.date] || []).push({
            id: b.id, start: b.start, end: b.end, teacherName: b.teacherName, booked: true, bookingId: b.id,
          });
        });
        Object.keys(byDate).forEach((d) => byDate[d].sort((a, b) => a.start.localeCompare(b.start)));

        // 可约窗：今天 ~ 今天+(aheadDays-1) 天
        const maxD = new Date(now.getTime() + (aheadDays - 1) * 86400000);
        const activeDate = (this.data.activeDate && byDate[this.data.activeDate]) ? this.data.activeDate : todayStr;

        this.setData({
          slotsByDate: byDate,
          todayStr,
          minDate: todayStr,
          maxDate: ymd(maxD),
          year: this.data.year || now.getFullYear(),
          month: this.data.month || now.getMonth() + 1,
          activeDate,
          curSlots: byDate[activeDate] || [],
          loading: false,
        }, () => this.buildCells());
      })
      .catch((e) => {
        this.setData({ loading: false });
        wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      });
  },

  /** 根据 expanded/year/month/activeDate 生成日期格 */
  buildCells() {
    const { expanded, year, month, activeDate, todayStr, slotsByDate, minDate, maxDate } = this.data;
    const cells = [];
    const mk = (dt, out) => {
      const date = ymd(dt);
      return {
        date, day: dt.getDate(), out,
        today: date === todayStr,
        sel: date === activeDate,
        dot: !!(slotsByDate[date] && slotsByDate[date].some((s) => !s.booked)),
        mine: !!(slotsByDate[date] && slotsByDate[date].some((s) => s.booked)),
        disabled: date < minDate || date > maxDate,
      };
    };
    if (expanded) {
      // 月视图：整月 + 前置补齐（周一为起始）
      const first = new Date(year, month - 1, 1);
      let lead = (first.getDay() + 6) % 7; // 周一=0
      const daysInMonth = new Date(year, month, 0).getDate();
      for (let i = lead; i > 0; i--) cells.push(mk(new Date(year, month - 1, 1 - i), true));
      for (let d = 1; d <= daysInMonth; d++) cells.push(mk(new Date(year, month - 1, d), false));
      while (cells.length % 7 !== 0) cells.push(mk(new Date(year, month - 1, daysInMonth + (cells.length % 7)), true));
    } else {
      // 周视图：包含 activeDate 的那一周（周一~日）
      const base = new Date(activeDate + 'T00:00:00+08:00');
      const offset = (base.getDay() + 6) % 7;
      const monday = new Date(base.getTime() - offset * 86400000);
      for (let i = 0; i < 7; i++) cells.push(mk(new Date(monday.getTime() + i * 86400000), false));
    }
    this.setData({ cells, title: `${year}年 ${String(month).padStart(2, '0')}月` });
  },

  toggleExpand() {
    const expanded = !this.data.expanded;
    // 展开时把年月对齐到 activeDate 所在月
    const a = new Date(this.data.activeDate + 'T00:00:00+08:00');
    this.setData({ expanded, year: a.getFullYear(), month: a.getMonth() + 1 }, () => this.buildCells());
  },

  prevMonth() {
    let { year, month } = this.data;
    month -= 1; if (month < 1) { month = 12; year -= 1; }
    this.setData({ year, month }, () => this.buildCells());
  },
  nextMonth() {
    let { year, month } = this.data;
    month += 1; if (month > 12) { month = 1; year += 1; }
    this.setData({ year, month }, () => this.buildCells());
  },

  onPickDate(e) {
    const { date, disabled } = e.currentTarget.dataset;
    if (disabled) return wx.showToast({ title: '超出可约范围', icon: 'none' });
    this.setData({ activeDate: date, curSlots: this.data.slotsByDate[date] || [] }, () => this.buildCells());
  },

  onBook(e) {
    const { id, teacher, time } = e.currentTarget.dataset;
    wx.showModal({
      title: '确认预约',
      content: `${time}\n${teacher} 老师 · 1对1 粤语课\n\n预约成功后将占用 1 节课时（课后扣除）`,
      confirmText: '确认预约',
      success: (r) => {
        if (!r.confirm) return;
        api.createBooking(id)
          .then(() => { wx.showToast({ title: '预约成功', icon: 'success' }); this.load(); })
          .catch((err) => { wx.showToast({ title: err.message || '预约失败', icon: 'none' }); this.load(); });
      },
    });
  },

  onCancel(e) {
    const { bookingid, time } = e.currentTarget.dataset;
    if (!bookingid) return;
    wx.showModal({
      title: '取消预约', content: `确定取消 ${time} 的预约吗？`,
      confirmText: '取消预约', confirmColor: '#e5342e',
      success: (r) => {
        if (!r.confirm) return;
        api.cancelBooking(bookingid)
          .then(() => { wx.showToast({ title: '已取消', icon: 'success' }); this.load(); })
          .catch((err) => wx.showToast({ title: err.message || '取消失败', icon: 'none' }));
      },
    });
  },
});
