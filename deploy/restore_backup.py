# -*- coding: utf-8 -*-
"""
备份解密还原工具（粤讲粤醒目）
============================
一键从 COS 下载最新加密备份 → 解密 → 解压到本地，得到可用的 data/materials/audio。

用法：
    python restore_backup.py            # 下载并还原 COS 上最新的加密备份
    python restore_backup.py <文件名>    # 还原指定的 .enc 备份（文件名从后台备份监控可见）

原理：备份包上传 COS 前用 AES-256-CBC 加密（密文头部 16 字节是 IV）。
      密钥 = sha256('canto-backup::' + 服务器 secrets 里的 backupKey 或 腾讯云 secretKey)。
      本脚本自动从服务器读取密钥，无需手动输入。
"""
import sys, os, time, hmac, hashlib, json, re, urllib.request, urllib.error
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import paramiko
from hashlib import sha256
import creds  # 统一读凭据，不再硬编码

# ---- 配置（与服务器一致）----
HOST = creds.HOST
SSH_PW = creds.SSH_PASSWORD
COS = creds.COS_HOST
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'restore_out')

# ---- 1. 从服务器读取加密密钥素材 ----
print('[1/5] 连接服务器读取密钥…')
cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(HOST, 22, 'ubuntu', SSH_PW, timeout=20)
_, so, _ = cli.exec_command("echo '%s' | sudo -S cat /www/canto/server/data/secrets.json 2>/dev/null" % SSH_PW)
raw = so.read().decode(errors='replace')
cli.close()
sec = json.loads(raw[raw.index('{'):])
material = sec.get('backupKey') or sec.get('tencent', {}).get('secretKey') or 'canto-fallback-key'
aes_key = sha256(('canto-backup::' + material).encode()).digest()  # 32 bytes
sid = sec['tencent']['secretId']
skey = sec['tencent']['secretKey']


def cos_auth(method, key, params=''):
    now = int(time.time()); kt = '%d;%d' % (now - 60, now + 600)
    sign_key = hmac.new(skey.encode(), kt.encode(), hashlib.sha1).hexdigest()
    http_str = '%s\n%s\n%s\nhost=%s\n' % (method, key, params, COS)
    sts = 'sha1\n%s\n%s\n' % (kt, hashlib.sha1(http_str.encode()).hexdigest())
    sig = hmac.new(sign_key.encode(), sts.encode(), hashlib.sha1).hexdigest()
    plist = 'max-keys' if params else ''
    return ('q-sign-algorithm=sha1&q-ak=%s&q-sign-time=%s&q-key-time=%s'
            '&q-header-list=host&q-url-param-list=%s&q-signature=%s' % (sid, kt, kt, plist, sig))


# ---- 2. 找到要还原的备份对象 ----
target = sys.argv[1] if len(sys.argv) > 1 else None
if not target:
    print('[2/5] 列举 COS 备份，取最新…')
    req = urllib.request.Request('https://%s/?max-keys=1000' % COS, headers={'Authorization': cos_auth('get', '/', 'max-keys=1000')})
    xml = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'replace')
    encs = re.findall(r'<Key>(backups/[^<]+\.enc)</Key>', xml)
    if not encs:
        print('COS 上没有 .enc 加密备份。'); sys.exit(1)
    target = sorted(encs)[-1]  # 文件名含时间戳，排序取最新
else:
    if not target.startswith('backups/'):
        target = 'backups/' + target
print('    目标备份:', target)

# ---- 3. 下载密文 ----
print('[3/5] 下载密文…')
enc = urllib.request.urlopen('https://%s/%s' % (COS, target), timeout=60).read()
print('    密文大小: %d 字节' % len(enc))

# ---- 4. AES-256-CBC 解密（头部 16 字节为 IV）----
print('[4/5] 解密…')
try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    iv, ct = enc[:16], enc[16:]
    dec = Cipher(algorithms.AES(aes_key), modes.CBC(iv)).decryptor()
    data = dec.update(ct) + dec.finalize()
    pad = data[-1]           # PKCS7 去填充
    data = data[:-pad] if 1 <= pad <= 16 else data
except ImportError:
    print('    需要 cryptography 库：pip install cryptography'); sys.exit(1)

# ---- 5. 落盘 + 解压 ----
os.makedirs(OUT_DIR, exist_ok=True)
tgz = os.path.join(OUT_DIR, os.path.basename(target).replace('.enc', ''))
with open(tgz, 'wb') as f:
    f.write(data)
print('[5/5] 已解密还原为 tar.gz:', tgz)
try:
    import tarfile
    with tarfile.open(tgz, 'r:gz') as t:
        t.extractall(OUT_DIR)
    print('    已解压到:', OUT_DIR)
    print('    含目录:', [n for n in os.listdir(OUT_DIR) if os.path.isdir(os.path.join(OUT_DIR, n))])
except Exception as e:
    print('    解压失败（但 tar.gz 已生成，可手动解压）:', e)

print('\n✅ 完成。data/ 即为还原出的完整业务数据；如需上线恢复，将 data 覆盖到服务器 /www/canto/server/data 后重启 pm2。')
