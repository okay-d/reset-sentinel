# 重置哨兵 · 开源版

这是“重置哨兵”的网页版和后端开源副本：后端定时读取公开动态，通过关键词识别相关内容，网页端展示重置记录、发言记录和日历，并支持邮箱提醒。

## 目录

- `web/`：Next.js + React + Tailwind CSS 网页端
- `server/`：NestJS 后端、监控服务、SQLite 数据库和 SMTP 邮件提醒
- `admin/index.html`：现有后台管理页面，可配置 SMTP、管理邮箱订阅和发送测试邮件

## 本地启动

先启动后端：

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run build
npm run start
```

再启动网页端：

```powershell
cd web
npm install
Copy-Item .env.example .env.local
npm run dev
```

默认网页端请求 `http://127.0.0.1:3000`。如果后端地址不同，修改 `web/.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL`。

## 数据源与敏感信息

开源仓库不包含 X 登录 Cookie、真实数据库、用户邮箱、头像、日志、SMTP 密码和生产环境配置。需要抓取真实公开动态时，请在本地准备自己的 Cookie，并通过 `X_COOKIES_FILE` 指向本地文件；不要提交该文件。

SMTP 可以通过 `server/.env` 配置，也可以打开 `admin/index.html` 在“邮箱提醒”页面配置。后台密码会保存到本地 SQLite 的 `meta` 表，生产环境必须限制数据库文件权限。

本地没有 `clashctl` 时，保持 `CLASHCTL_COMMAND` 为空；程序不会执行代理开关命令，而是使用系统代理。服务器需要自动切换代理时，再配置对应命令。

## 开源许可

本项目使用 [MIT License](LICENSE)。
