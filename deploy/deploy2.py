# -*- coding: utf-8 -*-
"""部署 v2：SFTP 递归上传 server 目录 -> pm2 启动 -> Nginx 反代 -> 全链路验证"""
import os
import sys
import paramiko
import creds  # 统一从 deploy.local.json / 环境变量读取凭据，不再硬编码

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HOST = creds.HOST
PASSWORD = creds.SSH_PASSWORD
NODE_BIN = creds.NODE_BIN
LOCAL_SERVER = r'c:\Users\27806\Desktop\xuexi\server'
REMOTE_TMP = '/tmp/canto-src'

# ---------- 0. 部署前门禁：先本地预演（语法+启服+冒烟），不过不传 ----------
# 把首次反馈从“生产”提前到“本地”；应急可用 --skip-verify 跳过
if '--skip-verify' not in sys.argv:
    import subprocess
    _v = subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'verify_local.py')])
    if _v.returncode != 0:
        sys.exit('[部署中止] 本地预演未通过，已阻止上传到生产。修复后重试，或用 --skip-verify 强制跳过。')
    print('\n── 本地预演通过，开始部署 ──\n')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(hostname=HOST, port=22, username=creds.SSH_USER, password=PASSWORD, timeout=15)

def run(cmd, sudo=False, show=True):
    if sudo:
        cmd = f"echo '{PASSWORD}' | sudo -S bash -c \"{cmd}\""
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=90)
    out = stdout.read().decode('utf-8', 'ignore').strip()
    err = stderr.read().decode('utf-8', 'ignore').strip()
    if show:
        print(f'$ {cmd[:100]}')
        if out:
            print(out)
        if err and 'password for' not in err.lower():
            print('[stderr]', err[:400])
    return out

# ---------- 1. 递归上传 server 目录到 /tmp（跳过 dist 等无关目录） ----------
run(f'rm -rf {REMOTE_TMP} && mkdir -p {REMOTE_TMP}')
sftp = ssh.open_sftp()

def upload_dir(local, remote):
    try:
        sftp.mkdir(remote)
    except IOError:
        pass
    for name in os.listdir(local):
        lp = os.path.join(local, name)
        rp = f'{remote}/{name}'
        if os.path.isdir(lp):
            upload_dir(lp, rp)
        else:
            sftp.put(lp, rp)

upload_dir(LOCAL_SERVER, REMOTE_TMP)
sftp.close()
print('[ok] server 目录已上传')

# ---------- 2. 落位 /www/canto/server 并用 pm2 启动（保留服务器上的 data：密钥+线上作答数据） ----------
# 部署前快照：把现有 data 打包到持久备份目录（翻车可回滚），保留最近 10 份
run(
    "if [ -d /www/canto/server/data ]; then mkdir -p /www/canto/backups && "
    "tar -czf /www/canto/backups/predeploy-$(date +%Y%m%d-%H%M%S).tar.gz -C /www/canto/server data && "
    "ls -1t /www/canto/backups/predeploy-*.tar.gz | tail -n +11 | xargs -r rm -f; fi",
    sudo=True,
)
run(
    "if [ -d /www/canto/server/data ]; then rm -rf /tmp/canto-data-keep && cp -r /www/canto/server/data /tmp/canto-data-keep; fi && "
    "if [ -d /www/canto/server/public/audio ]; then rm -rf /tmp/canto-audio-keep && cp -r /www/canto/server/public/audio /tmp/canto-audio-keep; fi && "
    "if [ -d /www/canto/server/public/materials ]; then rm -rf /tmp/canto-mat-keep && cp -r /www/canto/server/public/materials /tmp/canto-mat-keep; fi && "
    f"rm -rf /www/canto/server && mkdir -p /www/canto && cp -r {REMOTE_TMP} /www/canto/server && "
    "if [ -d /tmp/canto-data-keep ]; then rm -rf /www/canto/server/data && mv /tmp/canto-data-keep /www/canto/server/data; fi && "
    "if [ -d /tmp/canto-audio-keep ]; then mkdir -p /www/canto/server/public && rm -rf /www/canto/server/public/audio && mv /tmp/canto-audio-keep /www/canto/server/public/audio; fi && "
    "if [ -d /tmp/canto-mat-keep ]; then mkdir -p /www/canto/server/public && rm -rf /www/canto/server/public/materials && mv /tmp/canto-mat-keep /www/canto/server/public/materials; fi && "
    "ls /www/canto/server",
    sudo=True,
)
run(
    f"export PATH={NODE_BIN}:$PATH && cd /www/canto/server && "
    f"pm2 delete canto >/dev/null 2>&1; pm2 start app.js --name canto && pm2 save",
    sudo=True,
)
run("sleep 1 && curl -s http://127.0.0.1:3000/api/health && echo && curl -s http://127.0.0.1:3000/api/levels | head -c 120")

# ---------- 3. Nginx 反代：/api/ 与 /admin/ -> 127.0.0.1:3000 ----------
proxy_conf = (
    "location ^~ /api/ {\\n"
    "    proxy_pass http://127.0.0.1:3000;\\n"
    "    proxy_http_version 1.1;\\n"
    "    proxy_set_header Host \\$host;\\n"
    "    proxy_set_header X-Real-IP \\$remote_addr;\\n"
    "    proxy_set_header X-Forwarded-For \\$proxy_add_x_forwarded_for;\\n"
    "}\\n"
    "location ^~ /admin/ {\\n"
    "    proxy_pass http://127.0.0.1:3000;\\n"
    "    proxy_http_version 1.1;\\n"
    "    proxy_set_header Host \\$host;\\n"
    "}\\n"
    "location ^~ /audio/ {\\n"
    "    alias /www/canto/server/public/audio/;\\n"
    "    expires 30d;\\n"
    "    add_header Accept-Ranges bytes;\\n"
    "}\\n"
    "location ^~ /materials/ {\\n"
    "    alias /www/canto/server/public/materials/;\\n"
    "    expires 7d;\\n"
    "}\\n"
    "location ^~ /annotate/ {\\n"
    "    proxy_pass http://127.0.0.1:3000;\\n"
    "    proxy_http_version 1.1;\\n"
    "    proxy_set_header Host \\$host;\\n"
    "}\\n"
    "location ^~ /teacher/ {\\n"
    "    proxy_pass http://127.0.0.1:3000;\\n"
    "    proxy_http_version 1.1;\\n"
    "    proxy_set_header Host \\$host;\\n"
    "}\\n"
    "location ^~ /legal/ {\\n"
    "    proxy_pass http://127.0.0.1:3000;\\n"
    "    proxy_http_version 1.1;\\n"
    "    proxy_set_header Host \\$host;\\n"
    "}\\n"
)
ext_dir = '/www/server/panel/vhost/nginx/extension/yy.fla.wang'
run(f"mkdir -p {ext_dir} && printf '{proxy_conf}' > {ext_dir}/canto.conf && cat {ext_dir}/canto.conf", sudo=True)
run("/www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload && echo RELOADED", sudo=True)

# ---------- 4. 走公网域名全链路验证 ----------
run("curl -s https://yy.fla.wang/api/health && echo && curl -s -o /dev/null -w 'admin http %{http_code}' https://yy.fla.wang/admin/")

# ---------- 5. 开机自启（pm2 startup） ----------
run(f"export PATH={NODE_BIN}:$PATH && pm2 startup systemd -u root --hp /root >/dev/null 2>&1; pm2 save >/dev/null 2>&1; echo STARTUP_OK", sudo=True)

ssh.close()
print('\n[done]')
