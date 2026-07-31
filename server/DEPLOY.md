# 部署说明（canto-server）

> 本服务**零第三方依赖**：服务器上只需安装 Node.js（≥18），解压即可运行，无需 npm install。

## 一、包内结构

```
server/
├── app.js            服务入口（HTTP API + 管理后台静态托管）
├── seed.js           种子数据脚本（仅本地开发用，服务器不需要执行）
├── package.json
├── lib/jsondb.js     JSON 文件数据库
├── data/             ★ 数据库文件（题库/关卡/课程/作答记录，已含本地构建好的数据）
│   ├── questions.json
│   ├── levels.json
│   ├── courses.json
│   ├── results.json
│   └── logs.json
└── public/admin/     管理后台网页（浏览器访问 /admin/）
```

## 二、服务器部署步骤（以腾讯云轻量服务器 + 宝塔/纯命令行为例）

1. **安装 Node.js**（如已装可跳过）
   ```bash
   # CentOS/OpenCloudOS
   curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && yum install -y nodejs
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
   node -v   # 确认 >= 18
   ```

2. **上传并解压**
   ```bash
   mkdir -p /www/canto && cd /www/canto
   # 上传 canto-server-*.zip 到此目录后：
   unzip canto-server-*.zip
   cd server
   ```

3. **试运行**
   ```bash
   node app.js
   # 看到 [canto-server] running at http://127.0.0.1:3000 即成功
   # 浏览器访问 http://服务器IP:3000/admin/ 应能打开管理后台
   ```

4. **常驻运行（推荐 pm2）**
   ```bash
   npm install -g pm2
   pm2 start app.js --name canto
   pm2 save && pm2 startup   # 开机自启
   ```

5. **防火墙 / 安全组**：放行 3000 端口（或用 Nginx 反代 80/443，见下）

## 三、上线前必做（重要）

| 事项 | 说明 |
|---|---|
| **HTTPS 域名** | 微信小程序正式环境只允许 https 请求：域名解析到服务器 → Nginx 反代 3000 端口 → 申请免费 SSL 证书；然后把小程序 `miniprogram/utils/api.js` 里 `REMOTE.baseUrl` 改为 `https://你的域名`，并在微信公众平台配置 request 合法域名 |
| **管理后台鉴权（现状）** | 已实现登录鉴权：`POST /api/admin/login` 校验 `data/admins.json` 中的账号（用户名 + sha256 口令），签发 token；其余 `/api/admin/*` 均需请求头带 `x-auth-token`（会话 12 小时滑动续期，服务重启失效），并按角色权限（super/editor/teacher/tutor/finance）校验访问范围 |
| **HTTPS 反代（待办）** | 会话 token 走明文 HTTP 有被窃听风险，公网上线前须用 Nginx 反代并启用 HTTPS（配置见上「HTTPS 域名」一行）|
| **口令与会话加固（待办）** | 上线前应强制修改默认账号口令、制定口令复杂度策略；会话现为单机内存态，若需多实例部署再引入持久化会话（如 Redis）|
| **数据备份** | `data/` 目录即全部数据，建议 crontab 每日打包备份一份 |

## 四、数据说明

- 数据库为 `data/` 下的 JSON 文件，**人类可读、可直接备份迁移**
- 起步期（几千学生）性能足够；用户量大后可平滑迁移 MySQL（接口层不变）
- `results.json`（关卡结算）与 `logs.json`（单题埋点）由小程序自动上报，是教务统计的数据来源

## 五、本地开发

```powershell
cd server
node seed.js   # 重建种子数据（会覆盖题库/关卡/课程）
node app.js    # 启动，浏览器访问 http://127.0.0.1:3000/admin/
```

小程序端已内置降级：服务器不可用时自动回落本地 Mock 数据，不影响演示。
