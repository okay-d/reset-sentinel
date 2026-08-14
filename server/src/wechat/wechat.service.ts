import { Injectable, Logger } from '@nestjs/common'
import { config } from '../config'

@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name)
  private accessToken: { token: string; expiresAt: number } | null = null

  private get enabled(): boolean {
    return Boolean(config.wechat.appid && config.wechat.appsecret)
  }

  /** wx.login code → openid；未配置凭证或换取失败返回 null */
  async code2Session(code: string): Promise<string | null> {
    if (!this.enabled || !code) return null
    const url =
      `https://api.weixin.qq.com/sns/jscode2session?appid=${config.wechat.appid}` +
      `&secret=${config.wechat.appsecret}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const body = (await res.json()) as { openid?: string; errcode?: number; errmsg?: string }
    if (!body.openid) {
      this.logger.warn(`code2Session 失败：${body.errcode} ${body.errmsg}`)
      return null
    }
    this.logger.log(`code2Session 成功，openid=${body.openid.slice(0, 8)}…`)
    return body.openid
  }

  /** 小程序全局 access_token（缓存，7200 秒有效） */
  async getAccessToken(): Promise<string | null> {
    if (!this.enabled) return null
    if (this.accessToken && this.accessToken.expiresAt > Date.now()) return this.accessToken.token
    const url =
      `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential` +
      `&appid=${config.wechat.appid}&secret=${config.wechat.appsecret}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const body = (await res.json()) as { access_token?: string; expires_in?: number; errmsg?: string }
    if (!body.access_token) {
      this.logger.warn(`access_token 获取失败：${body.errmsg}`)
      return null
    }
    this.accessToken = {
      token: body.access_token,
      expiresAt: Date.now() + Math.max(60, (body.expires_in || 7200) - 300) * 1000,
    }
    return body.access_token
  }

  /** 发送订阅消息；tmplId 不传时使用主模板；未配置模板/凭证时仅记录（不中断） */
  async sendSubscribeMessage(
    openid: string,
    data: Record<string, unknown>,
    tmplId?: string,
  ): Promise<boolean> {
    const id = tmplId || config.wechat.subscribeTmplId
    if (!id || !this.enabled || !openid) {
      this.logger.log(`订阅消息未推送（模板或凭证未配置）：openid=${openid}`)
      return false
    }
    const token = await this.getAccessToken()
    if (!token) return false
    const res = await fetch(
      `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${token}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          touser: openid,
          template_id: id,
          data,
        }),
      },
    )
    const body = (await res.json()) as { errcode?: number; errmsg?: string }
    if (body.errcode !== 0) {
      this.logger.warn(`订阅消息发送失败：${body.errcode} ${body.errmsg}`)
      return false
    }
    return true
  }

  /** 构造订阅消息模板数据；按模板 ID 自动适配字段结构 */
  buildTemplateDataFor(
    tmplId: string | undefined,
    hit: { account: string; displayName?: string; text: string; announcedAt: string },
  ): Record<string, { value: string }> {
    const d = new Date(hit.announcedAt)
    const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
    const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
    // 账号名称按模板限制控制在 1~5 个字符，保留配置中的 tibo 展示名。
    const templateAccountName = (s: string) => {
      const v = String(config.accountNames[s] || s).replace(/\s+/g, '').slice(0, 5)
      return v || '账号'
    }
    // 「留言通知」模板（编号 1559）：name1 留言人 / thing2 留言内容 / time3 留言时间 / thing18 媒体账号名称
    if (tmplId && tmplId === config.wechat.subscribeCommentTmplId) {
      return {
        name1: { value: templateAccountName(hit.account) },
        thing2: { value: truncate(hit.text.replace(/\s+/g, ' '), 20) },
        time3: { value: time },
        thing18: { value: truncate(config.accountNames[hit.account] || hit.account, 20) },
      }
    }
    // 「账号更新提醒」模板（编号 2580）：phrase1 账号名称 / thing3 更新内容 / time5 更新时间 / phrase2 备注
    return {
      phrase1: { value: templateAccountName(hit.account) },
      thing3: { value: truncate(hit.text.replace(/\s+/g, ' '), 20) },
      time5: { value: time },
      phrase2: { value: '重置提醒' },
    }
  }

  /** 构造订阅消息模板数据（使用主模板，兼容旧调用） */
  buildTemplateData(hit: { account: string; displayName?: string; text: string; announcedAt: string }): Record<string, { value: string }> {
    return this.buildTemplateDataFor(config.wechat.subscribeTmplId, hit)
  }
}
