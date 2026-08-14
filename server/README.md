# 重置哨兵 · NestJS 后端

监控 X 账号推文、关键词命中、提供小程序接口与实时推送。NestJS + TypeORM 风格模块化（存储层用 Node 内置 `node:sqlite`，零原生依赖）。

## 快速开始

要求：Node.js ≥ 22.5（自带 `node:sqlite`）。

```powershell
cd server
npm install
npm run build
node dist/main.js
```

默认监听 `3000` 端口，与小程序 `config.ts` 一致。启动后立即拉取一次，之后每 5 分钟轮询（±25% 随机抖动）。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `X_ACCOUNT` | `thsottiaux` | 被监控账号 |
| `KEYWORDS` | `reset,重置` | 命中关键词 |
| `POLL_INTERVAL_MIN` | `5` | 轮询间隔（分钟） |
| `POLL_JITTER` | `0.25` | 间隔随机抖动 |
| `PORT` | `3000` | HTTP 端口 |
| `FETCH_MODE` | `crawler` | `crawler`（Cookie 访问官方 `x.com`）或 `mock`（离线开发） |
| `X_BEARER_TOKEN` | 空 | 官方 X API Token |
| `USE_CRAWLER` | `1` | Playwright 爬虫开关 |
| `CRAWLER_CHANNEL` | 空 | 浏览器渠道（`chrome`/`msedge`，空=自动探测） |
| `X_COOKIES_FILE` | `../backend/cookies.json` | 官方 `x.com` 爬虫使用的 Cookie JSON 路径，可在 `.env` 中自定义 |
| `CLASHCTL_COMMAND` | 空 | 可选的 mihomo 开关命令；为空时使用系统代理，不执行任何命令 |
| `CLASHCTL_SHELL` | `/bin/bash` | 执行 `clashctl` 的 Shell；命令是终端函数/别名时需要通过 Bash 加载 |
| `DB_PATH` | `server/data/sentinel.db` | SQLite 数据库 |
| `WX_APPID` / `WX_APPSECRET` | 空 | 微信小程序凭证（未配置时登录降级为 mock openid） |
| `WX_SUBSCRIBE_TMPL_ID` | 空 | 订阅消息模板 ID（未配置时不推送） |
| `SMTP_HOST` | 空 | 邮件 SMTP 服务器地址（为空时不发送邮件） |
| `SMTP_PORT` | `465` | 邮件 SMTP 端口 |
| `SMTP_SECURE` | `true` | 是否使用 TLS；465 通常为 `true`，587 通常设为 `false` |
| `SMTP_USER` | 空 | SMTP 用户名 |
| `SMTP_PASS` | 空 | SMTP 密码或授权码 |
| `SMTP_FROM` | `SMTP_USER` | 发件人地址 |
| `JWT_SECRET` | 开发默认值 | 会话签名密钥，生产必须修改 |
| `ADMIN_TOKEN` | 必填 | 后台管理口令（管理页面请求头 `x-admin-token`），请使用随机长字符串 |

## 接口

**小程序契约（无需认证）**
- `GET /api/calendar?type=reset|speech&days=365`
- `GET /api/hits?page&size&date`
- `GET /api/posts?date`
- `GET /api/subscribe/status`、`POST /api/subscribe`、`POST /api/login`
- `POST /api/email-subscriptions`（网页版输入邮箱即可订阅提醒，无需登录）
- `GET /api/codex-resets`、`GET/POST /api/codex-resets/requests`
- `WS /api/codex-resets/requests/live`（求重置实时推送）
- `GET /api/health`

**登录（参考桃桃优选）**
- `POST /auth/login`（`{code}` → `{token, user}`，开发模式回退 `dev_` openid）
- `GET /auth/user`（Bearer token → 当前用户）
- `POST /auth/update-profile`（`{nickname}`，Bearer → 更新昵称）
- `POST /auth/upload-avatar`（multipart 字段 `avatar`，Bearer → 上传头像，返回 `{avatar, user}`）
- 头像静态访问：`/uploads/avatars/...`（文件保存在 `server/uploads/`）
- 订阅提醒需先登录：小程序提醒页未登录时只显示「微信登录后开启提醒」
- 登录后弹出「完善资料」弹窗：选择头像（`chooseAvatar`）+ 输入昵称（`type="nickname"`）→ 上传头像 + 更新昵称

**后台管理（请求头 `x-admin-token`）**
- `GET /api/admin/status`、`GET/POST/PUT/DELETE /api/admin/accounts...`
- `GET /api/admin/subscriptions`、`POST /api/admin/test-push`
- 管理页面见 `admin/index.html`（本地浏览器打开即可）

**参考「重置雷达」契约（需 Bearer token）**
- `POST /session`（`{code}` → `{token, expiresAt, profile}`）
- `GET /reset-history/:account/summary`、`/reset-history/:account/history`
- `GET /account-activity/:account/summary`、`/account-activity/:account/history`

## 爬虫

复用旧后端已保存的 `cookies.json`（默认路径 `../backend/cookies.json`），无需重新导出。失效时：

```powershell
cd ../backend
node login-x.js
```

或重新导出 EditThisCookie 覆盖 `cookies.json`。

Linux 服务器部署：`npx playwright install --with-deps chromium`。

## 封号风险

用登录态自动化读取 x.com 违反其服务条款。务必：使用不重要的账号、`POLL_INTERVAL_MIN` 建议 15~30、保留随机抖动、优先家宽 IP。

## 与旧后端的差异

- 存储层从手写 `node:sqlite` 封装迁移为 NestJS `DatabaseService`（逻辑等价，多账号 `account` 列）
- 新增参考契约接口（`/session`、`/reset-history/:account/*`、`/account-activity/:account/*`），升级版小程序可直接对接
- 新增微信模块（code2Session / access_token / 订阅消息推送占位，未配置凭证自动降级）
- `dashboard` / `community-rating` / `message-modal` 等参考接口按二期预留，未臆造契约

## 订阅消息提醒（重置命中 → 微信通知）

流程：
1. 用户在小程序「提醒」页授权订阅 → `POST /api/subscribe` 给该 openid 记 1 次提醒机会
2. 监控轮询发现**新的**关键词命中 → 给所有有剩余机会的用户发模板消息
3. 推送成功扣 1 次机会；未配置凭证/模板时自动降级（记录日志，不扣机会）

启用真实推送需要配置（小程序后台获取）：
```powershell
$env:WX_APPID = '你的 appid'
$env:WX_APPSECRET = '你的 appsecret'
$env:WX_SUBSCRIBE_TMPL_ID = '订阅消息模板 ID'
```

## 网页版邮箱提醒

网页版不要求用户登录。用户提交邮箱后，服务端将地址写入 `email_subscriptions`；监控轮询发现新的关键词命中时，使用 SMTP 发送提醒邮件。也可以直接在现有 `admin/index.html` 的「邮箱提醒」页配置 SMTP，后台保存的配置优先于环境变量配置。

服务端配置示例：

```powershell
$env:SMTP_HOST = 'smtp.example.com'
$env:SMTP_PORT = '465'
$env:SMTP_SECURE = 'true'
$env:SMTP_USER = 'notify@example.com'
$env:SMTP_PASS = '邮箱授权码'
$env:SMTP_FROM = 'notify@example.com'
```

后台邮箱管理接口（均需要 `x-admin-token`）：

- `GET /api/admin/email-subscriptions`
- `PUT /api/admin/email-subscriptions/:id`
- `DELETE /api/admin/email-subscriptions/:id`
- `POST /api/admin/email-subscriptions/:id/test`
- `GET /api/admin/email-config`
- `PUT /api/admin/email-config`
- `POST /api/admin/email-config/test`

后台保存的 SMTP 密码写入 SQLite 的 `meta` 表。生产环境应限制数据库文件权限，并不要把数据库文件提交到公开仓库。

模板「账号更新提醒」（编号 2580）字段映射（`wechat.service.ts` 的 `buildTemplateData`）：
- `phrase1` 账号名称：账号中文名（默认 `提波`，可在 `config.ts` 的 `accountNames` 修改）
- `thing3` 更新内容：推文摘要（20 字内）
- `time5` 更新时间：北京时间
- `phrase2` 备注：重置提醒

注意：微信 `phrase` 字段实测仅支持**纯中文 1~5 个字**（英文、数字、混合、超 5 字都会被拒，报 47003），代码已做过滤。

测试推送（开发环境可用，不扣机会）：
```powershell
$body = '{"all":true}'
Invoke-RestMethod http://127.0.0.1:3000/api/dev/test-push -Method Post -ContentType application/json -Body $body
```
真机预览时在小程序「提醒」页先订阅一次（拿到 openid + 机会），再执行上面的命令即可在手机上收到服务通知。
