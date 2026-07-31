/**
 * 微信支付 v3（JSAPI）零依赖封装 —— 录播课单课买断 / 会员订阅
 * ------------------------------------------------------------------
 * 设计原则：结构完整、拿到商户号即可用；未配置时 isConfigured()=false，
 * 上层下单接口据此返回「支付未开通」，整套下单/订单流程仍可结构性联调。
 *
 * secrets.wxpay 需要（拿到商户资质后填入 server/data/secrets.json）：
 *   { mchid, serialNo, apiV3Key, privateKey }  // privateKey 为 apiclient_key.pem 文本(PEM)
 * appid 复用 secrets.wechat.appId（同一小程序主体）。
 */
const https = require('https');
const crypto = require('crypto');

const HOST = 'api.mch.weixin.qq.com';

/** 是否已具备真实支付能力（商户号 + 证书私钥 + APIv3密钥 齐全） */
function isConfigured(sec) {
  const w = sec && sec.wxpay;
  return !!(w && w.mchid && w.serialNo && w.apiV3Key && w.privateKey);
}

function httpsRequest(method, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: HOST, path, method, headers }, (r) => {
      let raw = '';
      r.on('data', (c) => (raw += c));
      r.on('end', () => resolve({ status: r.statusCode, body: raw, headers: r.headers }));
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/** 用商户私钥对「method\nurl\ntimestamp\nnonce\nbody\n」做 SHA256-RSA 签名（v3 鉴权） */
function buildAuthToken(sec, method, urlPath, bodyStr) {
  const { mchid, serialNo, privateKey } = sec.wxpay;
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts = Math.floor(Date.now() / 1000).toString();
  const message = `${method}\n${urlPath}\n${ts}\n${nonce}\n${bodyStr || ''}\n`;
  const signature = crypto.createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",`
    + `signature="${signature}",timestamp="${ts}",serial_no="${serialNo}"`;
}

/**
 * JSAPI 下单，返回 { prepayId }。
 * @param {object} sec  secrets（含 wxpay + wechat.appId）
 * @param {object} o    { description, outTradeNo, amountFen, openid, notifyUrl }
 */
async function createJsapiTransaction(sec, o) {
  const appid = sec.wechat.appId;
  const body = JSON.stringify({
    appid,
    mchid: sec.wxpay.mchid,
    description: o.description.slice(0, 120),
    out_trade_no: o.outTradeNo,
    notify_url: o.notifyUrl,
    amount: { total: o.amountFen, currency: 'CNY' },
    payer: { openid: o.openid },
  });
  const urlPath = '/v3/pay/transactions/jsapi';
  const auth = buildAuthToken(sec, 'POST', urlPath, body);
  const r = await httpsRequest('POST', urlPath, {
    Authorization: auth,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'canto-wxpay/1.0',
  }, body);
  const data = JSON.parse(r.body || '{}');
  if (r.status !== 200 || !data.prepay_id) {
    throw new Error(`下单失败：${data.code || r.status} ${data.message || r.body.slice(0, 120)}`);
  }
  return { prepayId: data.prepay_id };
}

/** 生成小程序 wx.requestPayment 所需参数（对 appId\nts\nnonce\npackage\n 用商户私钥 RSA 签名） */
function buildMiniPayParams(sec, prepayId) {
  const appId = sec.wechat.appId;
  const timeStamp = Math.floor(Date.now() / 1000).toString();
  const nonceStr = crypto.randomBytes(16).toString('hex');
  const pkg = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${pkg}\n`;
  const paySign = crypto.createSign('RSA-SHA256').update(message).sign(sec.wxpay.privateKey, 'base64');
  return { timeStamp, nonceStr, package: pkg, signType: 'RSA', paySign };
}

/**
 * 回调解密：微信用 APIv3Key 对 resource 做 AEAD_AES_256_GCM 加密，
 * 能正确解密即证明来自微信（只有微信与商户共享 apiV3Key）。返回明文交易对象。
 */
function decryptNotifyResource(sec, resource) {
  const key = Buffer.from(sec.wxpay.apiV3Key, 'utf8');
  const nonce = Buffer.from(resource.nonce, 'utf8');
  const aad = Buffer.from(resource.associated_data || '', 'utf8');
  const data = Buffer.from(resource.ciphertext, 'base64');
  const tag = data.slice(data.length - 16);
  const ct = data.slice(0, data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  decipher.setAAD(aad);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

module.exports = { isConfigured, createJsapiTransaction, buildMiniPayParams, decryptNotifyResource };
