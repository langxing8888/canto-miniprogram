/**
 * 腾讯云 API 轻量客户端（零第三方依赖）
 * - TC3-HMAC-SHA256 签名（官方 v3 签名算法）
 * - TTS 语音合成 TextToVoice（粤语音色 101019 智彤）
 */
const crypto = require('crypto');
const https = require('https');

function sha256hex(msg) {
  return crypto.createHash('sha256').update(msg).digest('hex');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', key).update(msg).digest();
}

/** 通用腾讯云 v3 请求 */
function tcRequest({ secretId, secretKey, service, host, action, version, region, payloadObj }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify(payloadObj);

  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:application/json; charset=utf-8\nhost:${host}\n`,
    'content-type;host',
    sha256hex(payload),
  ].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', timestamp, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const secretDate = hmac('TC3' + secretKey, date);
  const secretService = hmac(secretDate, service);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');
  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, ` +
    `SignedHeaders=content-type;host, Signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        method: 'POST',
        path: '/',
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          Host: host,
          Authorization: authorization,
          'X-TC-Action': action,
          'X-TC-Version': version,
          'X-TC-Timestamp': timestamp,
          'X-TC-Region': region,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(raw);
            if (j.Response && j.Response.Error) reject(new Error(j.Response.Error.Message));
            else resolve(j.Response);
          } catch (e) {
            reject(new Error('bad response: ' + raw.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('tts timeout')));
    req.write(payload);
    req.end();
  });
}

/** 粤语 TTS：文本 -> MP3 Buffer */
async function synthesizeCantonese(secretId, secretKey, text, region) {
  const resp = await tcRequest({
    secretId,
    secretKey,
    service: 'tts',
    host: 'tts.tencentcloudapi.com',
    action: 'TextToVoice',
    version: '2019-08-23',
    region: region || 'ap-guangzhou',
    payloadObj: {
      Text: text,
      SessionId: 'canto-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
      VoiceType: 101019, // 智彤 · 粤语女声
      Codec: 'mp3',
      Volume: 5,
      Speed: 0,
      ModelType: 1,
    },
  });
  return Buffer.from(resp.Audio, 'base64');
}

/** COS PUT 对象（XML API 签名，q-sign-algorithm=sha1） */
function cosPutObject(secretId, secretKey, bucketHost, key, buffer, contentType) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  const httpString = `put\n${key}\n\nhost=${bucketHost}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  const auth =
    `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=host&q-url-param-list=&q-signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: bucketHost,
        method: 'PUT',
        path: key,
        timeout: 20000,
        headers: {
          Host: bucketHost,
          Authorization: auth,
          'Content-Type': contentType || 'application/octet-stream',
          'Content-Length': buffer.length,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(`https://${bucketHost}${key}`);
          else reject(new Error(`cos put ${res.statusCode}: ${raw.slice(0, 200)}`));
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('cos timeout')));
    req.write(buffer);
    req.end();
  });
}

/** 粤语语音识别（一句话识别，16k_yue 引擎）：mp3 Buffer -> 转写文本 */
async function recognizeCantonese(secretId, secretKey, audioBuffer, region) {
  const resp = await tcRequest({
    secretId,
    secretKey,
    service: 'asr',
    host: 'asr.tencentcloudapi.com',
    action: 'SentenceRecognition',
    version: '2019-06-14',
    region: region || 'ap-guangzhou',
    payloadObj: {
      ProjectId: 0,
      SubServiceType: 2,
      EngSerViceType: '16k_yue', // 粤语专用引擎
      SourceType: 1,
      VoiceFormat: 'mp3',
      Data: audioBuffer.toString('base64'),
      DataLen: audioBuffer.length,
      UsrAudioKey: 'canto-' + Date.now() + '-' + Math.floor(Math.random() * 10000),
    },
  });
  return resp.Result || '';
}

/** COS 列桶统计用量（对象数 + 总字节，仅取前 1000 个对象，起步期够用） */
function cosListUsage(secretId, secretKey, bucketHost) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  const httpString = `get\n/\nmax-keys=1000\nhost=${bucketHost}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  const auth =
    `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=host&q-url-param-list=max-keys&q-signature=${signature}`;

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: bucketHost, method: 'GET', path: '/?max-keys=1000', timeout: 15000, headers: { Host: bucketHost, Authorization: auth } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`cos list ${res.statusCode}`));
          let bytes = 0;
          let objects = 0;
          raw.replace(/<Size>(\d+)<\/Size>/g, (m, s) => {
            bytes += parseInt(s, 10);
            objects += 1;
            return m;
          });
          resolve({ objects, bytes });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('cos timeout')));
    req.end();
  });
}

/** COS 删除对象（key 需以 / 开头） */
function cosDeleteObject(secretId, secretKey, bucketHost, key) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  const httpString = `delete\n${key}\n\nhost=${bucketHost}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  const auth =
    `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: bucketHost, method: 'DELETE', path: key, timeout: 15000, headers: { Host: bucketHost, Authorization: auth } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => (res.statusCode >= 200 && res.statusCode < 300 ? resolve(true) : reject(new Error(`cos delete ${res.statusCode}: ${raw.slice(0, 150)}`))));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('cos timeout')));
    req.end();
  });
}

/** COS 列举指定前缀下的对象（返回 [{key,size,lastModified}]）
 * 复用已验证可跑的单参数(max-keys)签名方式，前缀在 Node 侧过滤，避免多参数签名踩坑 */
function cosListPrefix(secretId, secretKey, bucketHost, prefix) {
  const now = Math.floor(Date.now() / 1000);
  const keyTime = `${now - 60};${now + 600}`;
  const signKey = crypto.createHmac('sha1', secretKey).update(keyTime).digest('hex');
  const httpString = `get\n/\nmax-keys=1000\nhost=${bucketHost}\n`;
  const stringToSign = `sha1\n${keyTime}\n${crypto.createHash('sha1').update(httpString).digest('hex')}\n`;
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  const auth =
    `q-sign-algorithm=sha1&q-ak=${secretId}&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=host&q-url-param-list=max-keys&q-signature=${signature}`;
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: bucketHost, method: 'GET', path: '/?max-keys=1000', timeout: 15000, headers: { Host: bucketHost, Authorization: auth } },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`cos listPrefix ${res.statusCode}: ${raw.slice(0, 150)}`));
          const items = [];
          const re = /<Contents>[\s\S]*?<Key>(.*?)<\/Key>[\s\S]*?<LastModified>(.*?)<\/LastModified>[\s\S]*?<Size>(\d+)<\/Size>[\s\S]*?<\/Contents>/g;
          let m;
          while ((m = re.exec(raw))) {
            if (!prefix || m[1].indexOf(prefix) === 0) items.push({ key: m[1], lastModified: m[2], size: parseInt(m[3], 10) });
          }
          resolve(items);
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('cos timeout')));
    req.end();
  });
}

module.exports = { synthesizeCantonese, cosPutObject, recognizeCantonese, tcRequest, cosListUsage, cosDeleteObject, cosListPrefix };
