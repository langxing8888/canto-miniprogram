const store = require('./utils/store');
const api = require('./utils/api');

App({
  onLaunch() {
    store.init();
    // 预取服务器题库，失败自动降级本地 Mock
    api.syncRemote();
    // 同步小程序全局配置（双版本开关 + 协议链接）；失败保持旧值
    api.fetchAppConfig()
      .then((cfg) => {
        wx.setStorageSync('versionSwitch', !!cfg.versionSwitch);
        wx.setStorageSync('legalUrls', { ua: cfg.uaUrl || '', privacy: cfg.privacyUrl || '' });
      })
      .catch(() => {});
  },
});
