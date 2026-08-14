import { Injectable, Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'
import { config } from '../config'
import { DatabaseService } from '../database/database.service'

export interface EmailResetHit {
  account: string
  displayName: string
  text: string
  announcedAt: string
}

interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name)
  private transporter: nodemailer.Transporter | null = null
  private smtpConfig: SmtpConfig

  constructor(private readonly database: DatabaseService) {
    this.smtpConfig = this.readConfig()
    this.rebuildTransporter()
  }

  isConfigured() {
    return Boolean(this.transporter && this.smtpConfig.host && this.smtpConfig.from && this.smtpConfig.pass)
  }

  getPublicConfig() {
    return {
      host: this.smtpConfig.host,
      port: this.smtpConfig.port,
      secure: this.smtpConfig.secure,
      user: this.smtpConfig.user,
      from: this.smtpConfig.from,
      configured: this.isConfigured(),
      hasPassword: Boolean(this.smtpConfig.pass),
    }
  }

  /** 仅供已通过后台鉴权的“显示授权码”按钮使用 */
  getPassword() {
    return this.smtpConfig.pass
  }

  saveConfig(input: Partial<SmtpConfig>) {
    const next: SmtpConfig = {
      host: String(input.host ?? this.smtpConfig.host).trim(),
      port: Number(input.port || this.smtpConfig.port || 465),
      secure: input.secure !== undefined ? Boolean(input.secure) : this.smtpConfig.secure,
      user: String(input.user ?? this.smtpConfig.user).trim(),
      pass: input.pass ? String(input.pass) : this.smtpConfig.pass,
      from: String(input.from ?? this.smtpConfig.from).trim(),
    }
    if (!next.host || !next.from || !next.pass) {
      throw new Error('SMTP 地址、发件人和密码不能为空')
    }
    this.database.setMeta('smtp_config', JSON.stringify(next))
    this.smtpConfig = next
    this.rebuildTransporter()
    return this.getPublicConfig()
  }

  async sendResetAlert(to: string, hit: EmailResetHit): Promise<{ sent: boolean; error?: string }> {
    if (!this.transporter) {
      return { sent: false, error: 'SMTP 尚未配置' }
    }
    const when = new Date(hit.announcedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    const subject = `重置哨兵：检测到新的重置动态`
    const text = [
      '重置哨兵检测到一条新的相关动态。',
      '',
      `账号：${hit.displayName || hit.account}`,
      `时间：${when}`,
      `内容：${hit.text}`,
      '',
      '这是网页版监控的邮件提醒。',
    ].join('\n')
    const html = `
      <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#14213d;max-width:640px">
        <h2 style="color:#4e6ef2">重置哨兵</h2>
        <p>检测到一条新的相关动态。</p>
        <p><b>账号：</b>${escapeHtml(hit.displayName || hit.account)}<br>
        <b>时间：</b>${escapeHtml(when)}</p>
        <blockquote style="margin:16px 0;padding:14px 18px;border-left:4px solid #4e6ef2;background:#f2f5ff">${escapeHtml(hit.text)}</blockquote>
        <p style="color:#68758f;font-size:13px">这是网页版监控的邮件提醒。</p>
      </div>`
    try {
      await this.transporter.sendMail({ from: this.smtpConfig.from, to, subject, text, html })
      return { sent: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : '邮件发送失败'
      this.logger.warn(`邮件发送失败：${to}，${message}`)
      return { sent: false, error: message }
    }
  }

  private readConfig(): SmtpConfig {
    const fallback: SmtpConfig = {
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      user: config.smtp.user,
      pass: config.smtp.pass,
      from: config.smtp.from,
    }
    const saved = this.database.getMeta('smtp_config')
    if (!saved) return fallback
    try {
      return { ...fallback, ...(JSON.parse(saved) as Partial<SmtpConfig>) }
    } catch {
      this.logger.warn('后台 SMTP 配置读取失败，已回退到环境变量配置')
      return fallback
    }
  }

  private rebuildTransporter() {
    this.transporter = this.smtpConfig.host && this.smtpConfig.from && this.smtpConfig.pass
      ? nodemailer.createTransport({
          host: this.smtpConfig.host,
          port: this.smtpConfig.port,
          secure: this.smtpConfig.secure,
          ...(this.smtpConfig.user && this.smtpConfig.pass
            ? { auth: { user: this.smtpConfig.user, pass: this.smtpConfig.pass } }
            : {}),
        })
      : null
  }
}

function escapeHtml(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}
