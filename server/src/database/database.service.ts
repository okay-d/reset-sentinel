import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { config } from '../config'

export interface UpsertPostInput {
  tweetId: string
  account: string
  url: string
  text: string
  createdAt: string
  isReset: boolean
}

export interface ResetEvent {
  id: string
  text: string
  announcedAt: string
}

export interface CalendarDay {
  date: string
  count: number
}

/** 本地时区 YYYY-MM-DD */
function dateKey(d: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name)
  private db: DatabaseSync

  constructor() {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true })
    this.db = new DatabaseSync(config.dbPath)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS posts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tweet_id    TEXT NOT NULL,
        account     TEXT NOT NULL,
        url         TEXT NOT NULL,
        text        TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        day         TEXT NOT NULL,
        fetched_at  TEXT NOT NULL,
        is_reset    INTEGER NOT NULL DEFAULT 0,
        push_status TEXT,
        pushed_at   TEXT,
        UNIQUE (account, tweet_id)
      );
      CREATE INDEX IF NOT EXISTS idx_posts_account_created ON posts(account, created_at);
      CREATE INDEX IF NOT EXISTS idx_posts_account_day ON posts(account, day);
      CREATE INDEX IF NOT EXISTS idx_posts_reset ON posts(account, is_reset);
      CREATE TABLE IF NOT EXISTS meta (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS subscriptions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        openid     TEXT NOT NULL UNIQUE,
        quota      INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_push_at TEXT,
        last_push_error TEXT,
        test_push_at TEXT
      );
      CREATE TABLE IF NOT EXISTS subscription_tmpls (
        openid     TEXT NOT NULL,
        tmpl_id    TEXT NOT NULL,
        quota      INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (openid, tmpl_id)
      );
      CREATE TABLE IF NOT EXISTS feedback (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        content    TEXT NOT NULL,
        contact    TEXT NOT NULL DEFAULT '',
        openid     TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        openid     TEXT NOT NULL UNIQUE,
        nickname   TEXT NOT NULL DEFAULT '',
        avatar     TEXT NOT NULL DEFAULT '',
        status     TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS accounts (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        handle       TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL DEFAULT '',
        keywords     TEXT NOT NULL DEFAULT 'reset,重置',
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS push_logs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        openid       TEXT NOT NULL,
        account      TEXT NOT NULL,
        text         TEXT NOT NULL,
        announced_at TEXT NOT NULL,
        pushed_at    TEXT NOT NULL,
        status       TEXT NOT NULL,
        error        TEXT,
        tmpl_id      TEXT,
        source       TEXT NOT NULL DEFAULT 'auto'
      );
      CREATE INDEX IF NOT EXISTS idx_push_logs_pushed_at ON push_logs(pushed_at);
      CREATE INDEX IF NOT EXISTS idx_push_logs_openid ON push_logs(openid);
      CREATE TABLE IF NOT EXISTS email_subscriptions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT NOT NULL UNIQUE,
        enabled       INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        last_sent_at  TEXT,
        last_error    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_email_subscriptions_enabled ON email_subscriptions(enabled);
    `)
    for (const statement of [
      'ALTER TABLE subscriptions ADD COLUMN last_push_at TEXT',
      'ALTER TABLE subscriptions ADD COLUMN last_push_error TEXT',
      'ALTER TABLE subscriptions ADD COLUMN test_push_at TEXT',
    ]) {
      try {
        this.db.exec(statement)
      } catch {
        // 已存在时忽略，兼容已有数据库。
      }
    }
    this.seedDefaultAccount()
  }

  /** 首次启动时写入默认被监控账号 */
  private seedDefaultAccount() {
    const row = this.db.prepare('SELECT id FROM accounts LIMIT 1').get()
    if (!row) {
      this.db
        .prepare('INSERT INTO accounts (handle, display_name, keywords, enabled, created_at) VALUES (?, ?, ?, 1, ?)')
        .run(config.account, config.accountNames[config.account] || config.account, config.keywords.join(','), new Date().toISOString())
    }
  }

  onModuleDestroy() {
    this.db.close()
  }

  upsertPost(input: UpsertPostInput): { created: boolean } {
    const existed = this.db
      .prepare('SELECT id FROM posts WHERE account = ? AND tweet_id = ?')
      .get(input.account, input.tweetId)
    if (existed) {
      this.db
        .prepare('UPDATE posts SET is_reset = ? WHERE account = ? AND tweet_id = ?')
        .run(input.isReset ? 1 : 0, input.account, input.tweetId)
      return { created: false }
    }
    this.db
      .prepare(
        `INSERT INTO posts (tweet_id, account, url, text, created_at, day, fetched_at, is_reset)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.tweetId,
        input.account,
        input.url,
        input.text,
        new Date(input.createdAt).toISOString(),
        dateKey(new Date(input.createdAt)),
        new Date().toISOString(),
        input.isReset ? 1 : 0,
      )
    return { created: true }
  }

  /** 日历统计：最近 N 天（含 0，升序） */
  getCalendar(type: 'reset' | 'speech', days: number, account = this.getDefaultAccount()): CalendarDay[] {
    const n = Math.min(Math.max(Number(days) || 365, 1), 3650)
    const isReset = type === 'reset' ? 1 : 0
    const rows = this.db
      .prepare('SELECT day, COUNT(*) AS c FROM posts WHERE account = ? AND is_reset = ? GROUP BY day')
      .all(account, isReset) as Array<{ day: string; c: number }>
    const byDay = new Map(rows.map((r) => [r.day, r.c]))
    const result: CalendarDay[] = []
    const cursor = new Date()
    cursor.setHours(0, 0, 0, 0)
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(cursor)
      d.setDate(d.getDate() - i)
      const key = dateKey(d)
      result.push({ date: key, count: byDay.get(key) || 0 })
    }
    return result
  }

  /** 命中记录分页 */
  getHits(page: number, size: number, date?: string, account = this.getDefaultAccount()) {
    const p = Math.max(Number(page) || 1, 1)
    const s = Math.min(Math.max(Number(size) || 20, 1), 100)
    const where = date ? 'account = ? AND is_reset = 1 AND day = ?' : 'account = ? AND is_reset = 1'
    const params = date ? [account, date] : [account]
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS c FROM posts WHERE ${where}`).get(...params) as { c: number }
    ).c
    const list = this.db
      .prepare(
        `SELECT id, url, text, created_at AS createdAt, pushed_at AS pushedAt, push_status AS pushStatus
         FROM posts WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, s, (p - 1) * s)
    return { list, total, page: p, size: s, hasMore: p * s < total }
  }

  getPostsByDate(date: string, account = this.getDefaultAccount()) {
    const list = this.db
      .prepare(
        `SELECT id, url, text, created_at AS createdAt
         FROM posts WHERE account = ? AND day = ? ORDER BY created_at DESC`,
      )
      .all(account, date)
    return { list, total: list.length }
  }

  /** 重置事件（关键词命中推文，倒序） */
  getResetEvents(account = this.getDefaultAccount(), limit = 2000): ResetEvent[] {
    const rows = this.db
      .prepare(
        `SELECT tweet_id, text, created_at FROM posts
         WHERE account = ? AND is_reset = 1 ORDER BY created_at DESC LIMIT ?`,
      )
      .all(account, limit) as Array<{ tweet_id: string; text: string; created_at: string }>
    return rows.map((r) => ({ id: String(r.tweet_id), text: r.text, announcedAt: r.created_at }))
  }

  /** 某账号最近一条已入库推文的 tweet_id（增量抓取判断用） */
  getLatestTweetId(account: string): string | null {
    const row = this.db
      .prepare('SELECT tweet_id FROM posts WHERE account = ? ORDER BY created_at DESC, id DESC LIMIT 1')
      .get(account) as { tweet_id: string } | undefined
    return row ? String(row.tweet_id) : null
  }

  /** 最近一条重置命中推文（后台测试推送用，与自动推送同一数据源） */
  getLatestResetHit(account = this.getDefaultAccount()): {
    account: string
    displayName: string
    text: string
    announcedAt: string
  } | null {
    const row = this.db
      .prepare(
        `SELECT p.text, p.created_at, p.account, a.display_name
         FROM posts p LEFT JOIN accounts a ON a.handle = p.account
         WHERE p.account = ? AND p.is_reset = 1
         ORDER BY p.created_at DESC LIMIT 1`,
      )
      .get(account) as
      | { text: string; created_at: string; account: string; display_name: string }
      | undefined
    if (!row) return null
    return {
      account: row.account,
      displayName: row.display_name || row.account,
      text: row.text,
      announcedAt: row.created_at,
    }
  }

  /** 重置历史摘要（参考契约：/reset-history/{account}/summary） */
  getResetHistorySummary(account = this.getDefaultAccount()) {
    const events = this.getResetEvents(account)
    const calendar: CalendarDay[] = []
    const recordsByDay = new Map<string, Array<Record<string, unknown>>>()
    for (const e of events) {
      const day = e.announcedAt.slice(0, 10)
      const rec = {
        id: e.id,
        resetAt: e.announcedAt,
        resetType: account,
        reason: e.text,
      }
      const list = recordsByDay.get(day) || []
      list.push(rec)
      recordsByDay.set(day, list)
    }
    for (const [day, list] of recordsByDay) {
      calendar.push({ date: day, count: list.length })
    }
    calendar.sort((a, b) => a.date.localeCompare(b.date))
    const latest = events[0]
    const latestDay = latest
      ? {
          date: latest.announcedAt.slice(0, 10),
          count: recordsByDay.get(latest.announcedAt.slice(0, 10))?.length || 1,
          records: recordsByDay.get(latest.announcedAt.slice(0, 10)) || [],
        }
      : null
    return { calendar, latestDay }
  }

  /** 重置历史分页（参考契约：/reset-history/{account}/history） */
  getResetHistory(account = this.getDefaultAccount(), date?: string, before?: string, limit = 20) {
    const where = ['account = ?', 'is_reset = 1']
    const params: Array<string | number> = [account]
    if (date) {
      where.push('day = ?')
      params.push(date)
    }
    if (before) {
      where.push('created_at < ?')
      params.push(before)
    }
    const list = this.db
      .prepare(
        `SELECT tweet_id, text, created_at FROM posts
         WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(...params, limit) as Array<{ tweet_id: string; text: string; created_at: string }>
    const records = list.map((r) => ({
      id: String(r.tweet_id),
      resetAt: r.created_at,
      resetType: account,
      reason: r.text,
    }))
    const nextCursor = records.length >= limit ? records[records.length - 1].resetAt : null
    return { platform: account, records, nextCursor }
  }

  /** 账号动态摘要（参考契约：/account-activity/{account}/summary） */
  getAccountActivitySummary(account = this.getDefaultAccount()) {
    const rows = this.db
      .prepare(
        `SELECT tweet_id, text, created_at FROM posts
         WHERE account = ? ORDER BY created_at DESC LIMIT 2000`,
      )
      .all(account) as Array<{ tweet_id: string; text: string; created_at: string }>
    const byDay = new Map<string, Array<Record<string, unknown>>>()
    for (const r of rows) {
      const day = r.created_at.slice(0, 10)
      const list = byDay.get(day) || []
      list.push({ id: String(r.tweet_id), publishedAt: r.created_at, handle: account, text: r.text })
      byDay.set(day, list)
    }
    const calendar: CalendarDay[] = []
    for (const [day, list] of byDay) calendar.push({ date: day, count: list.length })
    calendar.sort((a, b) => a.date.localeCompare(b.date))
    const latest = rows[0]
    const latestDay = latest
      ? { date: latest.created_at.slice(0, 10), count: byDay.get(latest.created_at.slice(0, 10))?.length || 1, posts: byDay.get(latest.created_at.slice(0, 10)) || [] }
      : null
    return { calendar, latestDay }
  }

  /** 账号动态历史（参考契约：/account-activity/{account}/history） */
  getAccountActivityHistory(account = this.getDefaultAccount(), before?: string, limitDays = 1) {
    const n = Math.min(Math.max(Number(limitDays) || 1, 1), 30)
    const endTs = before ? new Date(before).getTime() : Date.now()
    const start = new Date(endTs - (n - 1) * 86400000)
    start.setHours(0, 0, 0, 0)
    const rows = this.db
      .prepare(
        `SELECT tweet_id, text, created_at FROM posts
         WHERE account = ? AND created_at < ? ORDER BY created_at DESC LIMIT 500`,
      )
      .all(account, new Date(endTs).toISOString()) as Array<{ tweet_id: string; text: string; created_at: string }>
    const days = new Map<string, { date: string; count: number; posts: Array<Record<string, unknown>> }>()
    for (let i = 0; i < n; i++) {
      const d = new Date(start)
      d.setDate(d.getDate() + i)
      days.set(dateKey(d), { date: dateKey(d), count: 0, posts: [] })
    }
    for (const r of rows) {
      const day = dateKey(new Date(r.created_at))
      const item = days.get(day)
      if (item) {
        item.count += 1
        item.posts.push({ id: String(r.tweet_id), publishedAt: r.created_at, handle: account, text: r.text })
      }
    }
    const list = [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
    const nextCursor = list.length && list[0].posts.length ? list[0].posts[0].publishedAt : null
    return { platform: account, days: list, nextCursor }
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
    return row ? row.value : null
  }

  setMeta(key: string, value: string | number) {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, String(value))
  }

  /** 同步求重置周期：新重置日到来时计数归零 */
  syncBegCycle(account = this.getDefaultAccount()): string {
    const latest = this.getResetEvents(account, 1)[0]
    const latestCycle = latest ? latest.announcedAt.slice(0, 10) : ''
    const storedCycle = this.getMeta('beg_cycle_id') || ''
    if (latestCycle && latestCycle !== storedCycle) {
      this.setMeta('beg_cycle_id', latestCycle)
      this.setMeta('beg_count', '0')
    }
    return latestCycle || storedCycle
  }

  countPosts(): number {
    return (this.db.prepare('SELECT COUNT(*) AS c FROM posts').get() as { c: number }).c
  }

  /** 订阅管理：按 openid + 模板记录剩余提醒机会（每授权 1 个模板 = 1 次机会） */

  ensureSubscription(openid: string) {
    const now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT OR IGNORE INTO subscriptions (openid, quota, created_at, updated_at) VALUES (?, 0, ?, ?)',
      )
      .run(openid, now, now)
  }

  /** 增加提醒机会：tmplIds 为本次用户实际授权的模板列表（每模板 +n 次）；
   *  不传 tmplIds 时保持旧行为（仅总次数 +n） */
  addSubscriptionQuota(openid: string, tmplIds?: string | string[], n = 1) {
    this.ensureSubscription(openid)
    const list = tmplIds
      ? (Array.isArray(tmplIds) ? tmplIds : [tmplIds]).filter(Boolean)
      : []
    const now = new Date().toISOString()
    if (list.length > 0) {
      const upsertTmpl = this.db.prepare(
        'INSERT INTO subscription_tmpls (openid, tmpl_id, quota, updated_at) VALUES (?, ?, ?, ?)' +
          ' ON CONFLICT(openid, tmpl_id) DO UPDATE SET quota = quota + excluded.quota, updated_at = excluded.updated_at',
      )
      for (const tmplId of list) upsertTmpl.run(openid, tmplId, n, now)
    }
    this.db
      .prepare('UPDATE subscriptions SET quota = quota + ?, updated_at = ? WHERE openid = ?')
      .run(list.length > 0 ? list.length * n : n, now, openid)
  }

  /** 按模板查询某用户剩余机会明细 */
  getSubscriptionTmplQuotas(openid: string): Array<{ tmplId: string; quota: number }> {
    return (
      this.db
        .prepare('SELECT tmpl_id, quota FROM subscription_tmpls WHERE openid = ? ORDER BY quota DESC, tmpl_id ASC')
        .all(openid) as Array<{ tmpl_id: string; quota: number }>
    ).map((r) => ({ tmplId: String(r.tmpl_id), quota: Number(r.quota) }))
  }

  getSubscriptionQuota(openid: string): number {
    const row = this.db
      .prepare('SELECT quota FROM subscriptions WHERE openid = ?')
      .get(openid) as { quota: number } | undefined
    return row ? Number(row.quota) : 0
  }

  getSubscriptionStatus(openid: string): {
    subscribed: boolean
    quota: number
    tmplQuotas: Array<{ tmplId: string; quota: number }>
    lastPushAt: string | null
    lastPushError: string | null
    testPushAt: string | null
  } {
    const row = this.db
      .prepare('SELECT quota, last_push_at, last_push_error, test_push_at FROM subscriptions WHERE openid = ?')
      .get(openid) as {
      quota: number
      last_push_at: string | null
      last_push_error: string | null
      test_push_at: string | null
    } | undefined
    return {
      subscribed: Boolean(row),
      quota: row ? Number(row.quota) : 0,
      tmplQuotas: this.getSubscriptionTmplQuotas(openid),
      lastPushAt: row?.last_push_at || null,
      lastPushError: row?.last_push_error || null,
      testPushAt: row?.test_push_at || null,
    }
  }

  markTestPushUsed(openid: string): boolean {
    this.ensureSubscription(openid)
    const now = new Date().toISOString()
    const result = this.db
      .prepare('UPDATE subscriptions SET test_push_at = ?, updated_at = ? WHERE openid = ? AND test_push_at IS NULL')
      .run(now, now, openid)
    return result.changes > 0
  }

  recordPushSuccess(openid: string) {
    this.ensureSubscription(openid)
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE subscriptions SET last_push_at = ?, last_push_error = NULL, updated_at = ? WHERE openid = ?')
      .run(now, now, openid)
  }

  recordPushFailure(openid: string, reason: string) {
    this.ensureSubscription(openid)
    this.db
      .prepare('UPDATE subscriptions SET last_push_error = ?, updated_at = ? WHERE openid = ?')
      .run(String(reason || '提醒发送失败'), new Date().toISOString(), openid)
  }

  recordPushLog(input: {
    openid: string
    account: string
    text: string
    announcedAt: string
    status: 'success' | 'failed'
    error?: string
    tmplId?: string
    source?: 'auto' | 'test'
  }) {
    this.db
      .prepare(
        `INSERT INTO push_logs
         (openid, account, text, announced_at, pushed_at, status, error, tmpl_id, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.openid,
        input.account,
        input.text,
        new Date(input.announcedAt).toISOString(),
        new Date().toISOString(),
        input.status,
        input.error || null,
        input.tmplId || null,
        input.source || 'auto',
      )
  }

  listPushLogs(page: number, size: number) {
    const p = Math.max(Number(page) || 1, 1)
    const s = Math.min(Math.max(Number(size) || 20, 1), 100)
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM push_logs').get() as { c: number }).c
    const list = this.db
      .prepare(
        `SELECT id, openid, account, text, announced_at AS announcedAt,
                pushed_at AS pushedAt, status, error, tmpl_id AS tmplId, source
         FROM push_logs ORDER BY pushed_at DESC, id DESC LIMIT ? OFFSET ?`,
      )
      .all(s, (p - 1) * s)
    return { list, total, page: p, size: s, hasMore: p * s < total }
  }

  /** 所有有剩余机会的订阅用户 */
  listPushTargets(): Array<{ openid: string; quota: number }> {
    return this.db
      .prepare('SELECT openid, quota FROM subscriptions WHERE quota > 0')
      .all() as Array<{ openid: string; quota: number }>
  }

  /** 网页版邮箱订阅：只返回已启用的地址给监控服务 */
  listEmailPushTargets(): Array<{ id: number; email: string }> {
    return this.db
      .prepare('SELECT id, email FROM email_subscriptions WHERE enabled = 1 ORDER BY id')
      .all() as Array<{ id: number; email: string }>
  }

  /** 新增或重新启用邮箱订阅 */
  upsertEmailSubscription(email: string) {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO email_subscriptions (email, enabled, created_at, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(email) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at, last_error = NULL`,
      )
      .run(email, now, now)
    return this.db
      .prepare('SELECT id, email, enabled, created_at AS createdAt, updated_at AS updatedAt, last_sent_at AS lastSentAt, last_error AS lastError FROM email_subscriptions WHERE email = ?')
      .get(email)
  }

  listEmailSubscriptions() {
    return this.db
      .prepare('SELECT id, email, enabled, created_at AS createdAt, updated_at AS updatedAt, last_sent_at AS lastSentAt, last_error AS lastError FROM email_subscriptions ORDER BY id DESC')
      .all()
  }

  getEmailSubscription(id: number) {
    return this.db
      .prepare('SELECT id, email, enabled, created_at AS createdAt, updated_at AS updatedAt, last_sent_at AS lastSentAt, last_error AS lastError FROM email_subscriptions WHERE id = ?')
      .get(id) as { id: number; email: string; enabled: number; createdAt: string; updatedAt: string; lastSentAt: string | null; lastError: string | null } | undefined
  }

  setEmailSubscriptionEnabled(id: number, enabled: boolean) {
    const result = this.db
      .prepare('UPDATE email_subscriptions SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, new Date().toISOString(), id)
    return result.changes > 0
  }

  removeEmailSubscription(id: number) {
    const result = this.db.prepare('DELETE FROM email_subscriptions WHERE id = ?').run(id)
    return result.changes > 0
  }

  recordEmailSuccess(id: number) {
    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE email_subscriptions SET last_sent_at = ?, last_error = NULL, updated_at = ? WHERE id = ?')
      .run(now, now, id)
  }

  recordEmailFailure(id: number, reason: string) {
    this.db
      .prepare('UPDATE email_subscriptions SET last_error = ?, updated_at = ? WHERE id = ?')
      .run(String(reason || '邮件发送失败'), new Date().toISOString(), id)
  }

  /** 全部订阅记录（后台管理用） */
  listSubscriptions(): Array<{
    openid: string
    quota: number
    tmplQuotas: Array<{ tmplId: string; quota: number }>
    createdAt: string
    updatedAt: string
  }> {
    const rows = this.db
      .prepare('SELECT openid, quota, created_at, updated_at FROM subscriptions ORDER BY id DESC')
      .all() as Array<Record<string, unknown>>
    return rows.map((r) => {
      const openid = String(r.openid)
      return {
        openid,
        quota: Number(r.quota),
        tmplQuotas: this.getSubscriptionTmplQuotas(openid),
        createdAt: String(r.created_at),
        updatedAt: String(r.updated_at),
      }
    })
  }

  /** 扣减一次机会：指定模板时同时扣该模板明细与总次数（明细不足则不扣）；
   *  不指定模板时仅扣总次数（兼容旧数据） */
  consumeSubscriptionQuota(openid: string, tmplId?: string): boolean {
    const now = new Date().toISOString()
    if (tmplId) {
      const res = this.db
        .prepare(
          'UPDATE subscription_tmpls SET quota = quota - 1, updated_at = ? WHERE openid = ? AND tmpl_id = ? AND quota > 0',
        )
        .run(now, openid, tmplId)
      if (res.changes > 0) {
        this.db
          .prepare('UPDATE subscriptions SET quota = quota - 1, updated_at = ? WHERE openid = ? AND quota > 0')
          .run(now, openid)
        return true
      }
      return false
    }
    const res = this.db
      .prepare('UPDATE subscriptions SET quota = quota - 1, updated_at = ? WHERE openid = ? AND quota > 0')
      .run(now, openid)
    return res.changes > 0
  }

  /* ========== 意见反馈（小程序提交，后台只读查看） ========== */

  addFeedback(content: string, contact = '', openid = '') {
    this.db
      .prepare('INSERT INTO feedback (content, contact, openid, created_at) VALUES (?, ?, ?, ?)')
      .run(content, contact, openid, new Date().toISOString())
  }

  listFeedback(): Array<{ id: number; content: string; contact: string; openid: string; createdAt: string }> {
    return (
      this.db
        .prepare('SELECT id, content, contact, openid, created_at FROM feedback ORDER BY id DESC')
        .all() as Array<Record<string, unknown>>
    ).map((r) => ({
      id: Number(r.id),
      content: String(r.content),
      contact: String(r.contact),
      openid: String(r.openid),
      createdAt: String(r.created_at),
    }))
  }

  /* ========== 后台管理：用户列表 / 推文列表 ========== */

  listUsers(): Array<{ id: number; openid: string; nickname: string; avatar: string; createdAt: string; updatedAt: string }> {
    return (
      this.db
        .prepare('SELECT id, openid, nickname, avatar, created_at, updated_at FROM users ORDER BY id DESC')
        .all() as Array<Record<string, unknown>>
    ).map((r) => ({
      id: Number(r.id),
      openid: String(r.openid),
      nickname: String(r.nickname),
      avatar: String(r.avatar),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    }))
  }

  /** 推文列表（后台管理用，倒序分页） */
  listPosts(page: number, size: number) {
    const p = Math.max(Number(page) || 1, 1)
    const s = Math.min(Math.max(Number(size) || 20, 1), 100)
    const total = (this.db.prepare('SELECT COUNT(*) AS c FROM posts').get() as { c: number }).c
    const list = this.db
      .prepare(
        `SELECT id, tweet_id AS tweetId, account, url, text, created_at AS createdAt, day,
                is_reset AS isReset, push_status AS pushStatus, pushed_at AS pushedAt
         FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(s, (p - 1) * s)
    return { list, total, page: p, size: s, hasMore: p * s < total }
  }

  /* ========== 用户（桃桃优选式登录） ========== */

  upsertUserByOpenid(openid: string, nickname = ''): { id: number; openid: string; nickname: string; avatar: string } {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO users (openid, nickname, avatar, status, created_at, updated_at)
         VALUES (?, ?, '', 'active', ?, ?)
         ON CONFLICT(openid) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(openid, nickname, now, now)
    const row = this.db.prepare('SELECT id, openid, nickname, avatar FROM users WHERE openid = ?').get(openid) as {
      id: number
      openid: string
      nickname: string
      avatar: string
    }
    return row
  }

  getUserById(id: string | number): { id: number; openid: string; nickname: string; avatar: string; status: string } | null {
    const row = this.db.prepare('SELECT id, openid, nickname, avatar, status FROM users WHERE id = ?').get(id) as
      | { id: number; openid: string; nickname: string; avatar: string; status: string }
      | undefined
    return row || null
  }

  updateUserProfile(id: string | number, input: { nickname?: string; avatar?: string }): void {
    const sets: string[] = []
    const params: Array<string | number> = []
    if (input.nickname !== undefined) {
      sets.push('nickname = ?')
      params.push(String(input.nickname))
    }
    if (input.avatar !== undefined) {
      sets.push('avatar = ?')
      params.push(String(input.avatar))
    }
    if (sets.length === 0) return
    sets.push('updated_at = ?')
    params.push(new Date().toISOString(), id)
    this.db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params)
  }

  /* ========== 被监控账号（后台管理） ========== */

  listAccounts(): Array<{ handle: string; displayName: string; keywords: string; enabled: boolean; createdAt: string }> {
    return (
      this.db
        .prepare('SELECT handle, display_name, keywords, enabled, created_at FROM accounts ORDER BY id')
        .all() as Array<Record<string, unknown>>
    ).map((r) => ({
      handle: String(r.handle),
      displayName: String(r.display_name),
      keywords: String(r.keywords),
      enabled: !!r.enabled,
      createdAt: String(r.created_at),
    }))
  }

  getEnabledAccounts(): Array<{ handle: string; displayName: string; keywords: string[] }> {
    return this.listAccounts()
      .filter((a) => a.enabled)
      .map((a) => ({
        handle: a.handle,
        displayName: a.displayName,
        keywords: a.keywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      }))
  }

  /** 默认账号：第一个启用的账号，否则回退 config.account */
  getDefaultAccount(): string {
    const accounts = this.getEnabledAccounts()
    return accounts.length > 0 ? accounts[0].handle : config.account
  }

  addAccount(input: { handle: string; displayName?: string; keywords?: string }): void {
    const handle = String(input.handle || '').trim().toLowerCase()
    if (!handle) throw new Error('账号 handle 不能为空')
    this.db
      .prepare('INSERT INTO accounts (handle, display_name, keywords, enabled, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(
        handle,
        String(input.displayName || handle),
        String(input.keywords || config.keywords.join(',')),
        new Date().toISOString(),
      )
  }

  updateAccount(handle: string, input: { displayName?: string; keywords?: string; enabled?: boolean }): boolean {
    const sets: string[] = []
    const params: Array<string | number> = []
    if (input.displayName !== undefined) {
      sets.push('display_name = ?')
      params.push(String(input.displayName))
    }
    if (input.keywords !== undefined) {
      sets.push('keywords = ?')
      params.push(String(input.keywords))
    }
    if (input.enabled !== undefined) {
      sets.push('enabled = ?')
      params.push(input.enabled ? 1 : 0)
    }
    if (sets.length === 0) return false
    params.push(String(handle))
    const res = this.db.prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE handle = ?`).run(...params)
    return res.changes > 0
  }

  removeAccount(handle: string): boolean {
    const res = this.db.prepare('DELETE FROM accounts WHERE handle = ?').run(String(handle))
    return res.changes > 0
  }
}
