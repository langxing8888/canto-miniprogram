/**
 * 自定义 TabBar：四大入口（闯关 / AI纠音 / 录播课 / 我的）
 * 矢量图标与全局图标体系同风格
 */
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/levels/index', text: '闯关', icon: 'flag' },
      { pagePath: '/pages/practice/index', text: 'AI纠音', icon: 'mic' },
      { pagePath: '/pages/courses/index', text: '录播课', icon: 'play' },
      { pagePath: '/pages/profile/index', text: '我的', icon: 'user' },
    ],
  },

  methods: {
    switchTab(e) {
      const { index, path } = e.currentTarget.dataset;
      if (index === this.data.selected) return;
      wx.switchTab({ url: path });
    },

    /** 中间 CTA：直达课程管理页（约课/课表/作业/教材/笔记入口） */
    goCourse() {
      wx.navigateTo({ url: '/pages/mycourse/index' });
    },
  },
});
