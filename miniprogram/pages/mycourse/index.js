/**
 * 我的课程（1对1）
 * - 课时包卡：剩余/已上/总课时 + 到期时间
 * - 课程列表：开课前 5 分钟 ~ 结束时间内显示会议号可复制（服务端时间窗控制）
 * - 取消预约：开课前均可
 */
const api = require('../../utils/api');
const edition = require('../../utils/edition');

const STATUS_TEXT = { booked: '已预约', done: '已完成', cancelled: '已取消' };

Page({
  data: {
    logged: false,
    pack: { total: 0, used: 0, remain: 0, expireText: '' },
    attendStat: { totalDone: 0, present: 0, leave: 0, absent: 0, rate: 0 },
    bookings: [],
    loading: true,
    hwUnread: 0,
  },

  onShow() {
    if (!edition.guardStudentPage()) return; // 用户版不可用（学员专属）
    const logged = !!wx.getStorageSync('userToken');
    this.setData({ logged });
    if (logged) this.refresh();
    else this.setData({ loading: false });
    // 作业相关未读通知数（红点）
    if (logged) {
      api.fetchNotices().then((d) => {
        const hw = (d.list || []).filter((n) => !n.read && (n.type === 'hw_due' || n.type === 'hw_remind' || n.type === 'hw_graded'));
        this.setData({ hwUnread: hw.length });
      }).catch(() => {});
    }
    // 页面停留期间每 30 秒刷新一次（时间窗到点自动亮出会议号）
    this.timer = setInterval(() => {
      if (this.data.logged) this.refresh(true);
    }, 30000);
  },

  onHide() {
    if (this.timer) clearInterval(this.timer);
  },

  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },

  refresh(silent) {
    if (!silent) this.setData({ loading: true });
    api
      .fetchMyCourse()
      .then((d) => {
        const now = Date.now();
        const ATT = { present: '已出勤', leave: '已请假', absent: '缺课', none: '待点名' };
        const bookings = d.bookings.map((b) => ({
          ...b,
          statusText: STATUS_TEXT[b.status] || b.status,
          attendText: b.status === 'done' ? (ATT[b.attend] || '') : '',
          canCancel: b.status === 'booked' && !b.meetingUrl,
          waitingLink: b.status === 'booked' && !b.meetingUrl && b.linkAt > now,
        }));
        this.setData({
          pack: {
            total: d.pack.total,
            used: d.pack.used,
            remain: d.pack.remain,
            expireText: d.pack.expireAt ? new Date(d.pack.expireAt).toLocaleDateString() : '',
          },
          attendStat: d.attendStat || { totalDone: 0, present: 0, leave: 0, absent: 0, rate: 0 },
          bookings,
          loading: false,
        });
      })
      .catch((e) => {
        this.setData({ loading: false });
        if (!silent) wx.showToast({ title: e.message || '加载失败', icon: 'none' });
      });
  },

  onGoBooking() {
    if (!this.data.logged) return this.goLogin();
    if (this.data.pack.remain <= 0) {
      return wx.showModal({ title: '课时不足', content: '当前剩余课时为 0，请联系老师充值课时包后再约课。', showCancel: false });
    }
    wx.navigateTo({ url: '/pages/booking/index' });
  },

  onGoTimetable() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/timetable/index' });
  },

  onGoHomework() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/homework/index' });
  },

  onGoMaterials() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/mymaterials/index' });
  },

  onGoNotes() {
    if (!this.data.logged) return this.goLogin();
    wx.navigateTo({ url: '/pages/notes/index' });
  },

  goLogin() {
    wx.showToast({ title: '请先到「我的」页登录', icon: 'none' });
    setTimeout(() => wx.switchTab({ url: '/pages/profile/index' }), 800);
  },

  onCopyLink(e) {
    const { url, code } = e.currentTarget.dataset;
    wx.setClipboardData({
      data: url || code,
      success: () =>
        wx.showModal({
          title: '会议链接已复制',
          content: `打开腾讯会议 App 粘贴即可入会\n会议号：${code || '见链接'}`,
          showCancel: false,
          confirmText: '知道了',
        }),
    });
  },

  onCancelBooking(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '取消预约',
      content: '确定取消这节课吗？时段将释放给其他同学。',
      success: (r) => {
        if (!r.confirm) return;
        api
          .cancelBooking(id)
          .then(() => {
            wx.showToast({ title: '已取消', icon: 'success' });
            this.refresh();
          })
          .catch((err) => wx.showToast({ title: err.message || '取消失败', icon: 'none' }));
      },
    });
  },
});
