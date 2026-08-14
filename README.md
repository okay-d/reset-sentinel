# Reset Sentinel

[中文说明](README.zh-CN.md)

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
