import { Body, Controller, Post } from '@nestjs/common'
import { config } from '../config'
import { DatabaseService } from '../database/database.service'
import { WechatService } from '../wechat/wechat.service'
import { Get } from '@nestjs/common'

/**
 * 开发调试接口（生产环境 NODE_ENV=production 时自动禁用）
 */
@Controller('/api/dev')
export class DevController {
  constructor(
    private readonly wechat: WechatService,
    private readonly database: DatabaseService,
  ) {}

  /** 查看当前订阅用户（确认真实 openid 是否已入库） */
  @Get('/subscriptions')
  subscriptions() {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: '生产环境已禁用测试接口' }
    }
    return { list: this.database.listPushTargets() }
  }

  /** 发送一条测试订阅消息（body.openid 指定用户；body.all=true 发给所有已订阅用户），不扣机会 */
  @Post('/test-push')
  async testPush(@Body() body: { openid?: string; all?: boolean }) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, reason: '生产环境已禁用测试接口' }
    }
    const data = this.wechat.buildTemplateData({
      account: config.account,
      text: '这是一条测试推送：额度重置提醒链路已打通',
      announcedAt: new Date().toISOString(),
    })
    const targets = body.all
      ? this.database.listPushTargets().map((t) => t.openid)
      : body.openid
        ? [String(body.openid)]
        : []
    if (targets.length === 0) {
      return { ok: false, reason: '没有可发送的目标（先在小程序订阅，或指定 openid）' }
    }
    const results: Array<{ openid: string; sent: boolean }> = []
    for (const openid of targets) {
      const sent = await this.wechat.sendSubscribeMessage(openid, data)
      results.push({ openid, sent })
    }
    return { ok: results.every((r) => r.sent), results, data }
  }
}
