import sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import paramiko
import creds  # 统一读凭据，不再硬编码

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(creds.HOST, 22, creds.SSH_USER, creds.SSH_PASSWORD, timeout=20)


def run(cmd, timeout=120):
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors='replace')
    err = stderr.read().decode(errors='replace')
    print('$', cmd[:80])
    if out.strip():
        print(out.strip()[:600])
    if err.strip():
        print('[err]', err.strip()[:300])
    return out


run('which pdftoppm || echo NOT_INSTALLED')
run("sudo DEBIAN_FRONTEND=noninteractive apt-get install -y poppler-utils 2>&1 | tail -2", timeout=300)
run('pdftoppm -v 2>&1 | head -1')
cli.close()
