# -*- coding: utf-8 -*-
"""本地预演验证：部署到生产【之前】先在本机跑通，把首次反馈从「生产」提前到「本地」。

流程：
  1) node --check 逐个校验后端 JS 语法（语法门禁）
  2) 本地以 PORT=3999 启动 server/app.js（读本地 server/data，与生产隔离）
  3) 冒烟测试若干免云端点：/api/health、/api/levels、/api/admin/login 路由可用性
  4) 关闭本地服务，全绿返回 0，任一失败返回非 0（供 deploy 前置门禁调用）

用法： python deploy/verify_local.py
"""
import os
import sys
import time
import json
import subprocess
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.join(ROOT, 'server')
PORT = 3999
BASE = 'http://127.0.0.1:%d' % PORT
JS_FILES = ['app.js', 'seed.js', os.path.join('lib', 'jsondb.js'),
            os.path.join('lib', 'tencentcloud.js'), os.path.join('lib', 'wechat.js'),
            os.path.join('lib', 'wxpay.js')]

fail = []


def step(msg):
    print('\n▶ ' + msg)


# ---------- 1. 语法门禁 ----------
step('1/3 node --check 语法校验')
for f in JS_FILES:
    p = os.path.join(SERVER, f)
    if not os.path.exists(p):
        continue
    r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
    if r.returncode == 0:
        print('   ✓', f)
    else:
        print('   ✗', f, r.stderr.strip()[:200])
        fail.append('语法:' + f)

if fail:
    print('\n[中止] 语法未通过，不启动服务：', fail)
    sys.exit(1)

# ---------- 2. 本地启动 ----------
step('2/3 本地启动 server（PORT=%d，读本地 data）' % PORT)
env = dict(os.environ, PORT=str(PORT))
proc = subprocess.Popen(['node', 'app.js'], cwd=SERVER, env=env,
                        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)


def get_json(path, method='GET', body=None, timeout=5):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 headers={'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read())


# 轮询等待就绪
ready = False
for _ in range(30):
    if proc.poll() is not None:
        print('   ✗ 服务进程意外退出：')
        print((proc.stdout.read() or '')[:500])
        sys.exit(1)
    try:
        st, _ = get_json('/api/health')
        if st == 200:
            ready = True
            break
    except Exception:
        time.sleep(0.4)

if not ready:
    print('   ✗ 服务 6 秒内未就绪')
    proc.terminate()
    sys.exit(1)
print('   ✓ 服务已就绪', BASE)

# ---------- 3. 冒烟测试 ----------
step('3/3 冒烟测试（免云端点）')
try:
    st, d = get_json('/api/health')
    print('   %s /api/health ->' % ('✓' if st == 200 else '✗'), st)
    if st != 200:
        fail.append('health')

    st, d = get_json('/api/levels')
    ok = st == 200 and isinstance(d, dict) and d.get('ok')
    print('   %s /api/levels ->' % ('✓' if ok else '✗'), st, '关卡数=%s' % (len(d.get('data', [])) if isinstance(d, dict) else '?'))
    if not ok:
        fail.append('levels')

    # 登录路由：断言路由与数据层可用（返回带 ok 字段的 JSON 即算通，无需真凭据）
    try:
        st, d = get_json('/api/admin/login', 'POST', {'username': '__probe__', 'password': 'x'})
    except urllib.error.HTTPError as e:
        st, d = e.code, json.loads(e.read())
    routed = isinstance(d, dict) and ('ok' in d)
    print('   %s /api/admin/login 路由可用 ->' % ('✓' if routed else '✗'), st)
    if not routed:
        fail.append('login-route')
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

# ---------- 结论 ----------
if fail:
    print('\n❌ 本地预演失败：', fail, '（请修复后再部署）')
    sys.exit(1)
print('\n✅ 本地预演全部通过，可以部署。')
sys.exit(0)
