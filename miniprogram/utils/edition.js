/**
 * 双版本体系：student 学员版（全功能）/ user 用户版（仅自学功能）
 * - 后台开关（versionSwitch）关闭时恒为学员版，不弹选择（兼容早期全员学员）
 * - 开关开启后：首页弹版本二选一，选择结果本地记忆，个人中心可随时切换
 */

/** 后台是否开启了版本切换（app 启动时从服务器同步到本地） */
function switchEnabled() {
  return !!wx.getStorageSync('versionSwitch');
}

/** 当前版本：'student' | 'user' | ''（开关开启但尚未选择） */
function getEdition() {
  if (!switchEnabled()) return 'student';
  return wx.getStorageSync('edition') || '';
}

function setEdition(e) {
  wx.setStorageSync('edition', e === 'user' ? 'user' : 'student');
}

/** 是否学员版（未开启开关/未选择时按学员处理，由首页弹窗兜底引导选择） */
function isStudent() {
  return getEdition() !== 'user';
}

/** 是否需要弹版本选择（开关开启且从未选择过） */
function needChoose() {
  return switchEnabled() && !wx.getStorageSync('edition');
}

/** 学员专属页面守卫：用户版进入时提示并退回 */
function guardStudentPage() {
  if (getEdition() !== 'user') return true;
  wx.showModal({
    title: '学员专属功能',
    content: '当前为用户版。约课、教材、作业等服务面向机构学员开放。可在「我的」页切换为学员版，或联系客服了解课程。',
    showCancel: false,
    confirmText: '知道了',
    success: () => {
      wx.navigateBack({
        delta: 1,
        fail: () => wx.switchTab({ url: '/pages/levels/index' }),
      });
    },
  });
  return false;
}

module.exports = { switchEnabled, getEdition, setEdition, isStudent, needChoose, guardStudentPage };
