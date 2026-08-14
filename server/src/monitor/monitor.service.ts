import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { config } from '../config'
import { DatabaseService } from '../database/database.service'
import { FetcherService } from '../fetcher/fetcher.service'
import { WechatService } from '../wechat/wechat.service'
import { EmailService } from '../email/email.service'

@Injectable()
export class MonitorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('monitor')
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly fetcher: FetcherService,
    private readonly database: DatabaseService,
    private readonly wechat: WechatService,
    private readonly email: EmailService,
  ) {}

  /** 执行一次轮询：遍历所有启用的账号拉取 → 去重入库 → 标记命中 */
  async pollOnce(): Promise<{
    fetched: number
    newPosts: number
    newHits: number
    total: number
    accounts: number
    failedAccounts: string[]
  }> {
    const accounts = this.database.getEnabledAccounts()
    let newPosts = 0
    let newHits = 0
    let fetched = 0
    const failedAccounts: string[] = []

    for (const account of accounts) {
      try {
        const latestKnownId = this.database.getLatestTweetId(account.handle)
        const tweets = await this.fetcher.fetchRecentTweets(account.handle, account.keywords, latestKnownId)
        fetched += tweets.length
        const hits: Array<{ account: string; displayName: string; text: string; announcedAt: string }> = []
        for (const t of tweets) {
          const { created } = this.database.upsertPost({
            tweetId: t.tweetId,
            account: account.handle,
            url: `https://x.com/${account.handle}/status/${t.tweetId}`,
            text: t.text,
            createdAt: t.createdAt,
            isReset: !!t.isReset,
          })
          if (created) {
            newPosts++
            if (t.isReset) {
              newHits++
              hits.push({
                account: account.handle,
                displayName: account.displayName,
                text: t.text,
                announcedAt: t.createdAt,
              })
            }
          }
        }
        if (hits.length > 0) {
          await this.notifyReset(hits[0])
          await this.notifyEmailSubscribers(hits[0])
        }
      } catch (e) {
        failedAccounts.push(account.handle)
        this.logger.error(`账号 @${account.handle} 拉取失败：${(e as Error).message}`)
      }
    }

    this.database.setMeta('last_poll_at', new Date().toISOString())
    this.database.setMeta(
      'last_poll_result',
      JSON.stringify({ fetched, newPosts, newHits, accounts: accounts.length, failedAccounts }),
    )
    return { fetched, newPosts, newHits, total: this.database.countPosts(), accounts: accounts.length, failedAccounts }
  }

  /** 新重置命中 → 给网页版订阅邮箱发送提醒 */
  private async notifyEmailSubscribers(hit: { account: string; displayName: string; text: string; announcedAt: string }) {
    const targets = this.database.listEmailPushTargets()
    if (targets.length === 0) return
    for (const target of targets) {
      const result = await this.email.sendResetAlert(target.email, hit)
      if (result.sent) {
        this.database.recordEmailSuccess(target.id)
        this.logger.log(`已发送邮件提醒：${target.email}`)
      } else {
        this.database.recordEmailFailure(target.id, result.error || '邮件发送失败')
        this.logger.warn(`邮件提醒失败：${target.email}，${result.error || '未知错误'}`)
      }
    }
  }

  /** 新重置命中 → 给所有有剩余机会的订阅用户发提醒（推送失败不扣机会） */
  private async notifyReset(hit: { account: string; displayName: string; text: string; announcedAt: string }) {
    const targets = this.database.listPushTargets()
    if (targets.length === 0) {
      this.logger.log(`发现新重置动态，但暂无订阅用户（${hit.announcedAt}）`)
      return
    }
    for (const target of targets) {
      const r = await this.pushHitToUser(target.openid, hit, 'auto')
      if (r.sent) {
        this.logger.log(`已推送重置提醒：${target.openid}（模板 ${r.tmplId ? r.tmplId.slice(0, 8) + '…' : ''}）`)
      } else {
        this.logger.warn(`推送失败或无可发送模板：${target.openid}`)
      }
    }
  }

  /** 推送给单个用户：按该用户剩余模板依次尝试，成功扣 1 次（后台测试推送与自动推送共用，保证格式一致） */
  async pushHitToUser(
    openid: string,
    hit: { account: string; displayName: string; text: string; announcedAt: string },
    source: 'auto' | 'test' = 'auto',
  ): Promise<{ sent: boolean; tmplId?: string }> {
    // 优先使用该用户剩余次数最多的模板；明细为空（旧数据）时回退主模板
    const tmplQuotas = this.database.getSubscriptionTmplQuotas(openid)
    const candidates =
      tmplQuotas.length > 0
        ? tmplQuotas.filter((t) => t.quota > 0).map((t) => t.tmplId)
        : [config.wechat.subscribeTmplId].filter(Boolean)
    if (candidates.length === 0) {
      const error = '没有可用的订阅模板或提醒次数已用完'
      this.database.recordPushFailure(openid, error)
      this.database.recordPushLog({ ...hit, openid, status: 'failed', error, source })
      return { sent: false }
    }
    let lastError = ''
    for (const tmplId of candidates) {
      try {
        const ok = await this.wechat.sendSubscribeMessage(
          openid,
          this.wechat.buildTemplateDataFor(tmplId, hit),
          tmplId,
        )
        if (ok) {
          this.database.consumeSubscriptionQuota(openid, tmplId)
          this.database.recordPushSuccess(openid)
          this.database.recordPushLog({ ...hit, openid, status: 'success', tmplId, source })
          return { sent: true, tmplId }
        }
      } catch (e) {
        lastError = (e as Error).message
        this.database.recordPushFailure(openid, lastError)
      }
    }
    const error = lastError || '微信订阅消息发送失败，请检查订阅授权或模板配置'
    this.database.recordPushFailure(openid, error)
    this.database.recordPushLog({ ...hit, openid, status: 'failed', error, source })
    return { sent: false }
  }

  onApplicationBootstrap() {
    const run = () =>
      this.pollOnce()
        .then((r) => {
          this.logger.log(`拉取 ${r.fetched} 条，新增 ${r.newPosts} 条，命中 ${r.newHits} 条，库内共 ${r.total} 条`)
        })
        .catch((e) => {
          this.logger.error(`拉取失败：${(e as Error).message}`)
        })

    run()
    const baseMs = Math.max(config.pollIntervalMin, 1) * 60 * 1000
    const jitter = Math.min(Math.max(config.pollJitter || 0, 0), 1)
    const schedule = () => {
      const delta = (Math.random() * 2 - 1) * baseMs * jitter
      const delay = Math.max(baseMs + delta, 30000)
      this.timer = setTimeout(() => {
        run()
        schedule()
      }, delay)
    }
    schedule()
    const accountCount = this.database.getEnabledAccounts().length
    this.logger.log(
      `已启动，约每 ${config.pollIntervalMin} 分钟轮询 ${accountCount} 个账号（±${Math.round(jitter * 100)}% 随机抖动），模式 ${config.fetchMode}`,
    )
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer)
  }
}
