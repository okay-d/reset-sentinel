# 重置哨兵网页版

React + Next.js + Tailwind CSS 的公开监控页面。

## 本地运行

```powershell
cd web
npm install
Copy-Item .env.example .env.local
npm run dev
```

默认请求 `http://127.0.0.1:3000`，可以在 `.env.local` 中修改 `NEXT_PUBLIC_API_BASE_URL`。

网页版不需要登录。用户输入邮箱后，后端新增一条邮箱订阅；SMTP 配置和发送凭证只放在 `server/.env`，不要提交到仓库。
