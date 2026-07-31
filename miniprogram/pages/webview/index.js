/**
 * 通用 web-view 页：打开后台配置的 HTTPS 链接（用户协议 / 隐私政策等）
 * 需在小程序管理后台「开发 - 业务域名」里配置该域名白名单
 */
Page({
  data: { url: '' },
  onLoad(options) {
    const url = decodeURIComponent(options.url || '');
    const title = decodeURIComponent(options.title || '');
    if (title) wx.setNavigationBarTitle({ title });
    this.setData({ url });
  },
});
