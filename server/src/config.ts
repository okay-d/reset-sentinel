import * as path from 'node:path'
import * as fs from 'node:fs'

/** 启动时自动加载 .env（不依赖 --env-file 启动参数） */
function loadEnvFile() {
  const candidates = [
    path.resolve('.env'),
    path.resolve(__dirname, '..', '..', '.env'),
    path.resolve(__dirname, '..', '.env'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      if (process.env[key] !== undefined) continue
      let value = trimmed.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
    return
  }
}

loadEnvFile()

function resolveFirst(...candidates: string[]): string {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  return candidates[0]
}

/** 订阅模板 ID 列表（一次性订阅一次最多授权 3 个标题不同的模板，点一次 = 多次提醒机会） */
const subscribeTmplIds = (
  process.env.WX_SUBSCRIBE_TMPL_IDS ||
  process.env.WX_SUBSCRIBE_TMPL_ID ||
  ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const config = {
  /** 被监控的 X 账号 */
  account: process.env.X_ACCOUNT || 'thsottiaux',

  /** 订阅消息中展示的账号名称 */
  accountNames: { thsottiaux: '提波' },

  /** 关键词命中规则 */
  keywords: (process.env.KEYWORDS || 'reset,重置')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  /** 轮询间隔（分钟）与随机抖动 */
  pollIntervalMin: Number(process.env.POLL_INTERVAL_MIN || 5),
  pollJitter: Number(process.env.POLL_JITTER || 0.25),

  /** HTTP 端口 */
  port: Number(process.env.PORT || 3000),

  /** 抓取模式：只有 mock 可离线模拟，其余配置值统一收敛到官方 x.com Cookie 爬虫 */
  fetchMode: process.env.FETCH_MODE === 'mock' ? 'mock' : 'crawler',

  /** 官方 x.com Cookie 爬虫开关 */
  useCrawler: process.env.USE_CRAWLER !== '0' && process.env.USE_CRAWLER?.toLowerCase() !== 'false',

  /** 爬虫设置 */
  crawlerChannel: process.env.CRAWLER_CHANNEL || '',
  crawlerScrolls: Number(process.env.CRAWLER_SCROLLS || 3),

  maxFetch: Number(process.env.MAX_FETCH || 100),
  /** SQLite 数据库 */
  dbPath: process.env.DB_PATH || path.resolve('data', 'sentinel.db'),

  /** 官方 x.com 爬虫 Cookie：可通过 .env 的 X_COOKIES_FILE 自定义路径 */
  cookiesFile:
    process.env.X_COOKIES_FILE ||
    resolveFirst(path.resolve('..', 'backend', 'cookies.json'), path.resolve('cookies.json')),

  /** 可选代理切换命令；留空表示使用系统代理，不执行任何开关命令 */
  clashctlCommand: process.env.CLASHCTL_COMMAND || '',
  clashctlShell: process.env.CLASHCTL_SHELL || '/bin/bash',

  /** 访问 X 的 HTTP 代理（服务器在国内时必填，如 http://127.0.0.1:7890） */
  httpProxy:
    process.env.X_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.ALL_PROXY ||
    process.env.HTTP_PROXY ||
    '',

  /** 求重置实时推送 WebSocket 路径 */
  wsPath: '/api/codex-resets/requests/live',

  /** 微信能力（未配置时自动降级为 mock） */
  wechat: {
    appid: process.env.WX_APPID || '',
    appsecret: process.env.WX_APPSECRET || '',
    subscribeTmplIds,
    /** 主模板（兼容旧引用） */
    get subscribeTmplId(): string {
      return subscribeTmplIds[0] || ''
    },
    /** 留言通知模板（账号更新提醒模板之外的第二模板） */
    subscribeCommentTmplId: process.env.WX_SUBSCRIBE_COMMENT_TMPL_ID || '',
  },

  /** 邮件提醒能力；SMTP 凭证只在后端环境变量中配置 */
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },

  /** JWT 会话密钥 */
  jwtSecret: process.env.JWT_SECRET || 'replace-this-jwt-secret-in-env',

  /** 后台管理口令（管理页面请求头 x-admin-token） */
  adminToken: process.env.ADMIN_TOKEN || 'replace-this-admin-token-in-env',
}
