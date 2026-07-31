/**
 * 微信小程序服务端 API（零第三方依赖）
 * - code2Session：登录凭证换 openid
 * - getPhoneNumber：手机号快速验证（需企业主体 + 已开通该能力）
 * - access_token 内存缓存（2 小时有效，提前 5 分钟刷新）
 * 注意：调用 cgi-bin/token 需在微信公众平台把服务器 IP 加入「IP 白名单」
 */
const https = require('https');

function httpsJson(method, host, path, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj ? JSON.stringify(bodyObj) : null;
    const req = https.request(
      {
        hostname: host,
        method,
        path,
        timeout: 10000,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error('bad wx response: ' + raw.slice(0, 120)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('wx api timeout')));
    if (payload) req.write(payload);
    req.end();
  });
}

let tokenCache = { token: '', exp: 0 };

async function getAccessToken(appId, appSecret) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const r = await httpsJson('GET', 'api.weixin.qq.com', `/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`);
  if (!r.access_token) throw new Error(`access_token 获取失败：${r.errcode} ${r.errmsg}`);
  tokenCache = { token: r.access_token, exp: Date.now() + (r.expires_in - 300) * 1000 };
  return tokenCache.token;
}

/** 登录凭证 code -> { openid, session_key } */
async function code2Session(appId, appSecret, jsCode) {
  const r = await httpsJson('GET', 'api.weixin.qq.com', `/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${jsCode}&grant_type=authorization_code`);
  if (!r.openid) throw new Error(`code2Session 失败：${r.errcode} ${r.errmsg}`);
  return r;
}

/** 手机号快速验证 code -> 手机号（能力未开通/个人主体会抛错，调用方需降级） */
async function getPhoneNumber(appId, appSecret, phoneCode) {
  const token = await getAccessToken(appId, appSecret);
  const r = await httpsJson('POST', 'api.weixin.qq.com', `/wxa/business/getuserphonenumber?access_token=${token}`, { code: phoneCode });
  if (r.errcode !== 0 || !r.phone_info) throw new Error(`获取手机号失败：${r.errcode} ${r.errmsg}`);
  return r.phone_info.purePhoneNumber;
}

/* ===== 服务号（公众号）模板消息 ===== */
let mpTokenCache = { token: '', exp: 0 };

async function getMpAccessToken(mpAppId, mpSecret) {
  if (mpTokenCache.token && Date.now() < mpTokenCache.exp) return mpTokenCache.token;
  const r = await httpsJson('GET', 'api.weixin.qq.com', `/cgi-bin/token?grant_type=client_credential&appid=${mpAppId}&secret=${mpSecret}`);
  if (!r.access_token) throw new Error(`服务号 access_token 失败：${r.errcode} ${r.errmsg}`);
  mpTokenCache = { token: r.access_token, exp: Date.now() + (r.expires_in - 300) * 1000 };
  return mpTokenCache.token;
}

/**
 * 服务号模板消息推送（学生作业提醒/续费提醒等）
 * @param mp   secrets.mp: { appId, appSecret }
 * @param toOpenId  服务号侧 openid（经 UnionID 与小程序用户关联）
 * @param templateId 模板 ID
 * @param dataObj   模板变量 { keyword1: {value}, ... }
 * @param miniProgram 可选：点击跳小程序 { appid, pagepath }
 */
async function sendMpTemplate(mp, toOpenId, templateId, dataObj, miniProgram) {
  const token = await getMpAccessToken(mp.appId, mp.appSecret);
  const r = await httpsJson('POST', 'api.weixin.qq.com', `/cgi-bin/message/template/send?access_token=${token}`, {
    touser: toOpenId,
    template_id: templateId,
    miniprogram: miniProgram,
    data: dataObj,
  });
  if (r.errcode !== 0) throw new Error(`模板消息失败：${r.errcode} ${r.errmsg}`);
  return true;
}

module.exports = { code2Session, getPhoneNumber, getAccessToken, sendMpTemplate };
