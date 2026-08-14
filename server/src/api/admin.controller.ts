import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common'
import { config } from '../config'
import { DatabaseService } from '../database/database.service'
import { MonitorService } from '../monitor/monitor.service'
import { AdminGuard } from './admin.guard'
import { EmailService } from '../email/email.service'

/**
 * 后台管理接口（本地管理页面使用，请求头 x-admin-token）
 */
@Controller('/api/admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly database: DatabaseService,
    private readonly monitor: MonitorService,
    private readonly email: EmailService,
  ) {}

  @Get('/status')
  status() {
    let lastPollResult: unknown = null
    try {
      lastPollResult = JSON.parse(this.database.getMeta('last_poll_result') || 'null')
    } catch {
      lastPollResult = null
    }
    return {
      ok: true,
      mode: config.fetchMode,
      pollIntervalMin: config.pollIntervalMin,
      posts: this.database.countPosts(),
      lastPollAt: this.database.getMeta('last_poll_at'),
      lastPollResult,
      monitorStatus: lastPollResult && typeof lastPollResult === 'object'
        ? ((lastPollResult as { failedAccounts?: string[] }).failedAccounts?.length || 0) > 0 ? 'degraded' : 'healthy'
        : 'unknown',
      wechat: {
        configured: Boolean(config.wechat.appid && config.wechat.appsecret),
        subscribeTmplConfigured: Boolean(config.wechat.subscribeTmplId),
        accountNames: config.accountNames,
      },
    }
  }

  @Get('/accounts')
  accounts() {
    return { list: this.database.listAccounts() }
  }

  @Post('/accounts')
  addAccount(@Body() body: { handle: string; displayName?: string; keywords?: string }) {
    this.database.addAccount({
      handle: body.handle,
      displayName: body.displayName,
      keywords: body.keywords,
    })
    return { ok: true, list: this.database.listAccounts() }
  }

  @Put('/accounts/:handle')
  updateAccount(
    @Param('handle') handle: string,
    @Body() body: { displayName?: string; keywords?: string; enabled?: boolean },
  ) {
    const ok = this.database.updateAccount(handle, body)
    if (!ok) return { ok: false, reason: '账号不存在或未做修改' }
    return { ok: true, list: this.database.listAccounts() }
  }

  @Delete('/accounts/:handle')
  removeAccount(@Param('handle') handle: string) {
    const ok = this.database.removeAccount(handle)
    if (!ok) return { ok: false, reason: '账号不存在' }
    return { ok: true, list: this.database.listAccounts() }
  }

  @Get('/subscriptions')
  subscriptions() {
    const rows = this.database.listSubscriptions()
    return { list: rows }
  }

  @Get('/email-subscriptions')
  emailSubscriptions() {
    return { list: this.database.listEmailSubscriptions(), smtpConfigured: this.email.isConfigured() }
  }

  @Get('/email-config')
  emailConfig() {
    return this.email.getPublicConfig()
  }

  @Get('/email-config/secret')
  emailConfigSecret() {
    return { pass: this.email.getPassword() }
  }

  @Put('/email-config')
  updateEmailConfig(@Body() body: { host?: string; port?: number; secure?: boolean; user?: string; pass?: string; from?: string }) {
    try {
      return { ok: true, config: this.email.saveConfig(body) }
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'SMTP 配置保存失败' }
    }
  }

  @Post('/email-config/test')
  async testEmailConfig(@Body() body: { email?: string }) {
    const email = String(body.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, reason: '请输入有效的测试收件邮箱' }
    }
    const hit = this.database.getLatestResetHit() || {
      account: config.account,
      displayName: config.accountNames[config.account] || config.account,
      text: '这是一封测试邮件：SMTP 邮箱配置已经生效。',
      announcedAt: new Date().toISOString(),
    }
    const result = await this.email.sendResetAlert(email, hit)
    return { ok: result.sent, reason: result.error }
  }

  @Put('/email-subscriptions/:id')
  updateEmailSubscription(@Param('id') id: string, @Body() body: { enabled?: boolean }) {
    const ok = this.database.setEmailSubscriptionEnabled(Number(id), Boolean(body.enabled))
    return ok ? { ok: true } : { ok: false, reason: '邮箱订阅不存在' }
  }

  @Delete('/email-subscriptions/:id')
  deleteEmailSubscription(@Param('id') id: string) {
    const ok = this.database.removeEmailSubscription(Number(id))
    return ok ? { ok: true } : { ok: false, reason: '邮箱订阅不存在' }
  }

  @Post('/email-subscriptions/:id/test')
  async testEmailSubscription(@Param('id') id: string) {
    const target = this.database.getEmailSubscription(Number(id))
    if (!target) return { ok: false, reason: '邮箱订阅不存在' }
    const hit = this.database.getLatestResetHit()
    if (!hit) return { ok: false, reason: '暂无可测试的重置动态' }
    const result = await this.email.sendResetAlert(target.email, hit)
    if (result.sent) this.database.recordEmailSuccess(target.id)
    else this.database.recordEmailFailure(target.id, result.error || '邮件发送失败')
    return { ok: result.sent, reason: result.error }
  }

  /** 意见反馈（后台只读查看） */
  @Get('/feedback')
  feedback() {
    return { list: this.database.listFeedback() }
  }

  /** 已登录用户列表（后台管理用） */
  @Get('/users')
  users() {
    return { list: this.database.listUsers() }
  }

  /** 推文列表（后台管理用，倒序分页） */
  @Get('/posts')
  posts(@Query('page') page: string) {
    return this.database.listPosts(parseInt(page || '1', 10), 20)
  }

  /** 推送记录（后台管理用，倒序分页） */
  @Get('/push-logs')
  pushLogs(@Query('page') page: string) {
    return this.database.listPushLogs(parseInt(page || '1', 10), 20)
  }

  /** 测试推送：默认取最后一次重置命中推文，按用户剩余模板推送，格式与自动推送完全一致（成功会真实扣 1 次机会） */
  @Post('/test-push')
  async testPush(@Body() body: { openid?: string; all?: boolean; text?: string }) {
    const latest = this.database.getLatestResetHit()
    const hit = latest
      ? { ...latest, text: body.text ? String(body.text).trim() || latest.text : latest.text }
      : {
          account: config.account,
          displayName: config.accountNames[config.account] || config.account,
          text: String(body.text || '这是一条测试推送：额度重置提醒链路已打通'),
          announcedAt: new Date().toISOString(),
        }
    const targets = body.all
      ? this.database.listPushTargets().map((t) => t.openid)
      : body.openid
        ? [String(body.openid)]
        : []
    if (targets.length === 0) {
      return { ok: false, reason: '没有可发送的目标（先让用户订阅，或指定 openid）' }
    }
    const results: Array<{ openid: string; sent: boolean }> = []
    for (const openid of targets) {
      const r = await this.monitor.pushHitToUser(openid, hit, 'test')
      results.push({ openid, sent: r.sent })
    }
    return { ok: results.every((r) => r.sent), results, hit }
  }
}
