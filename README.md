# Reset Sentinel

Open-source web version of Reset Sentinel: a small monitoring service that checks public X posts, organizes reset and speech records into calendars, and sends email alerts when a new match is found.

![Reset Sentinel web dashboard](docs/screenshots/web-dashboard.png)

## Features

- Monitor public posts on a schedule and identify relevant content with keywords.
- Display reset records, speech records, recent hits, and selected-day details.
- Subscribe to email alerts without user registration or login.
- Configure SMTP and manage email subscribers from the existing admin page.
- Keep proxy command execution optional: when `CLASHCTL_COMMAND` is empty, the service uses the system proxy and does not run `clashctl`.
- Run locally with mock data before connecting a real data source.

## Project structure

```text
web/                 Next.js + React + Tailwind CSS frontend
server/              NestJS backend, monitor service, SQLite, and SMTP alerts
admin/index.html     Static admin page for SMTP and subscriber management
docs/screenshots/    README product screenshots
```

## Quick start

### 1. Start the backend

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run build
npm run start
```

### 2. Start the frontend

```powershell
cd web
npm install
Copy-Item .env.example .env.local
npm run dev
```

The frontend uses `http://127.0.0.1:3000` by default. If the backend runs elsewhere, set `NEXT_PUBLIC_API_BASE_URL` in `web/.env.local`.

## Email alerts

You can configure SMTP either through `server/.env` or through `admin/index.html` in the email settings section. The public web page only asks for an email address; users do not need an account.

The admin page supports:

- SMTP host, port, secure mode, username, sender, and authorization code.
- A test email before enabling production alerts.
- Masked SMTP credentials with explicit reveal controls.
- Enabling, disabling, and deleting email subscribers.

The SMTP password is stored in the local SQLite `meta` table when saved from the admin page. Restrict database file permissions in production and never commit the database or `.env` file.

## Data source and proxy

The open-source copy contains no X login cookies, production database, user email list, avatars, logs, SMTP credentials, or production environment files. To use the real crawler, prepare your own local cookie file and set `X_COOKIES_FILE`; do not commit it.

For a machine that already has a system proxy, leave this variable empty:

```env
CLASHCTL_COMMAND=
```

The backend will not execute a proxy-switch command in that mode. Only configure `CLASHCTL_COMMAND` when the server is intentionally allowed to run a local proxy control command.

## Security notes

- Copy `.env.example` to `.env` and replace every placeholder before deployment.
- Use a long random value for `JWT_SECRET` and `ADMIN_TOKEN`.
- Keep `DB_PATH`, cookie files, logs, and SMTP credentials outside version control.
- Do not use real SMTP credentials in screenshots, issues, or pull requests.

## License

This project is released under the [MIT License](LICENSE).

---

# 重置哨兵（中文说明）

这是“重置哨兵”的网页端与后端开源版本：定时检查公开 X 动态，使用关键词识别相关内容，将重置记录和发言记录整理成日历，并在出现新命中时发送邮件提醒。

## 功能

- 定时监控公开动态并识别关键词。
- 展示重置记录、发言记录、最近命中和指定日期详情。
- 用户无需注册或登录，输入邮箱即可订阅提醒。
- 在 `admin/index.html` 中配置 SMTP、发送测试邮件和管理订阅邮箱。
- `CLASHCTL_COMMAND` 为空时不执行 `clashctl`，直接使用系统代理。
- 支持先用 mock 数据启动，确认页面后再接入真实数据源。

## 本地启动

后端：

```powershell
cd server
Copy-Item .env.example .env
npm install
npm run build
npm run start
```

前端：

```powershell
cd web
npm install
Copy-Item .env.example .env.local
npm run dev
```

默认前端请求 `http://127.0.0.1:3000`。后端地址不同时，修改 `web/.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL`。

## 敏感信息说明

开源仓库不包含 X Cookie、真实数据库、用户邮箱、头像、日志、SMTP 密码和生产环境配置。使用真实爬虫时，请在本地准备自己的 Cookie 文件，并通过 `X_COOKIES_FILE` 指定，禁止提交到仓库。

项目使用 MIT License，详见 [LICENSE](LICENSE)。
