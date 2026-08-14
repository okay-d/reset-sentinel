import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { config } from '../config'
import { DatabaseService } from '../database/database.service'
import { MonitorService } from '../monitor/monitor.service'
import { WechatService } from '../wechat/wechat.service'

@Controller()
export class SentinelController {
  constructor(
    private readonly database: DatabaseService,
    private readonly monitor: MonitorService,
    private readonly wechat: WechatService,
  ) {}

  @Get('/api/calendar')
  calendar(@Query('type') type: string, @Query('days') days: string) {
    const t = type === 'speech' ? ('speech' as const) : ('reset' as const)
    return { days: this.database.getCalendar(t, parseInt(days || '365', 10)) }
  }

  @Get('/api/hits')
  hits(
    @Query('page') page: string,
    @Query('size') size: string,
    @Query('date') date?: string,
  ) {
    return this.database.getHits(parseInt(page || '1', 10), parseInt(size || '20', 10), date)
  }

  @Get('/api/posts')
  posts(@Query('date') date?: string) {
    return this.database.getPostsByDate(String(date || ''))
  }

  @Get('/api/subscribe/status')
  subscribeStatus(@Query('openid') openid?: string) {
    const id = String(openid || 'mock-openid-001')
    return this.database.getSubscriptionStatus(id)
  }

  @Post('/api/subscribe')
  subscribe(@Body() body: { openid?: string; tmplIds?: string[] }) {
    const id = String(body.openid || 'mock-openid-001')
    // 前端上报本次实际授权的模板列表；未上报时兼容旧客户端按主模板 +1
    const tmplIds = Array.isArray(body.tmplIds) && body.tmplIds.length > 0
      ? body.tmplIds.filter((t) => config.wechat.subscribeTmplIds.includes(t))
      : config.wechat.subscribeTmplIds.slice(0, 1)
    if (tmplIds.length === 0) {
      return { quota: this.database.getSubscriptionQuota(id), tmplQuotas: this.database.getSubscriptionTmplQuotas(id) }
    }
    this.database.addSubscriptionQuota(id, tmplIds, 1)
    const quota = this.database.getSubscriptionQuota(id)
    return { quota, tmplQuotas: this.database.getSubscriptionTmplQuotas(id) }
  }

  @Post('/api/subscribe/test')
  async testSubscribe(@Body() body: { openid?: string }) {
    const id = String(body.openid || 'mock-openid-001')
    const status = this.database.getSubscriptionStatus(id)
    if (!status.subscribed || status.quota <= 0) {
      return { ok: false, tested: Boolean(status.testPushAt), reason: '请先开启提醒并保留至少 1 次提醒机会' }
    }
    if (status.testPushAt) {
      return { ok: false, tested: true, reason: '每位用户只能测试一次提醒' }
    }
    const hit = this.database.getLatestResetHit()
    if (!hit) {
      return { ok: false, tested: false, reason: '暂无可测试的重置提醒' }
    }
    const result = await this.monitor.pushHitToUser(id, hit, 'test')
    if (!result.sent) {
      return { ok: false, tested: false, reason: '测试提醒发送失败，请检查订阅授权' }
    }
    this.database.markTestPushUsed(id)
    return {
      ok: true,
      tested: true,
      quota: this.database.getSubscriptionQuota(id),
      testPushAt: this.database.getSubscriptionStatus(id).testPushAt,
    }
  }

  @Post('/api/feedback')
  feedback(@Body() body: { content?: string; contact?: string; openid?: string }) {
    const content = String(body.content || '').trim()
    if (!content) return { ok: false, reason: '反馈内容不能为空' }
    if (content.length > 500) return { ok: false, reason: '反馈内容不能超过 500 字' }
    this.database.addFeedback(content, String(body.contact || ''), String(body.openid || ''))
    return { ok: true }
  }

  /** 网页版邮箱提醒：无需登录，提交地址即可重新启用订阅 */
  @Post('/api/email-subscriptions')
  emailSubscription(@Body() body: { email?: string }) {
    const email = String(body.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, reason: '请输入有效的邮箱地址' }
    }
    this.database.upsertEmailSubscription(email)
    return { ok: true, message: '邮箱提醒已开启' }
  }

  @Post('/api/login')
  async login(@Body() body: { code?: string }) {
    // 旧契约兼容：配置了微信凭证时用 code 换真实 openid，否则返回 mock
    const openid = (await this.wechat.code2Session(String(body.code || ''))) || 'mock-openid-001'
    return { openid }
  }

  @Get('/api/health')
  health() {
    let lastPollResult: unknown = null
    try {
      lastPollResult = JSON.parse(this.database.getMeta('last_poll_result') || 'null')
    } catch {
      lastPollResult = null
    }
    return {
      ok: true,
      account: config.account,
      mode: config.fetchMode,
      keywords: config.keywords,
      pollIntervalMin: config.pollIntervalMin,
      wechat: {
        configured: Boolean(config.wechat.appid && config.wechat.appsecret),
        subscribeTmplConfigured: Boolean(config.wechat.subscribeTmplId),
      },
      posts: this.database.countPosts(),
      lastPollAt: this.database.getMeta('last_poll_at'),
      lastPollResult,
      monitorStatus: lastPollResult && typeof lastPollResult === 'object'
        ? ((lastPollResult as { failedAccounts?: string[] }).failedAccounts?.length || 0) > 0 ? 'degraded' : 'healthy'
        : 'unknown',
    }
  }
}
