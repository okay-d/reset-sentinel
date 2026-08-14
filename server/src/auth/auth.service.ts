import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { WechatService } from '../wechat/wechat.service'
import { DatabaseService } from '../database/database.service'

export interface SessionResult {
  token: string
  expiresAt: string
  profile: Record<string, unknown>
}

export interface PublicUser {
  id: number
  openid: string
  nickname: string
  avatar: string
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly wechat: WechatService,
    private readonly database: DatabaseService,
  ) {}

  /** wx code → openid；开发模式（未配置凭证或换取失败）回退 dev_ 前缀 */
  private async resolveOpenid(code: string): Promise<string> {
    if (!code) throw new UnauthorizedException('缺少登录 code')
    const openid = await this.wechat.code2Session(code)
    if (openid) return openid
    return `dev_${code.slice(0, 24)}`
  }

  private publicUser(u: { id: number; openid: string; nickname: string; avatar: string }): PublicUser {
    return { id: u.id, openid: u.openid, nickname: u.nickname, avatar: u.avatar }
  }

  /** 小程序登录（参考桃桃优选）：POST /auth/login {code} → {token, user} */
  async login(code: string) {
    const openid = await this.resolveOpenid(code)
    const nickname = openid.startsWith('dev_')
      ? `开发用户${openid.slice(4, 8)}`
      : `微信用户${openid.slice(-6)}`
    const user = this.database.upsertUserByOpenid(openid, nickname)
    const token = await this.jwt.signAsync({ sub: String(user.id), role: 'user' })
    return { token, user: this.publicUser(user) }
  }

  getUserById(id: string | number): PublicUser | null {
    const user = this.database.getUserById(id)
    return user ? this.publicUser(user) : null
  }

  /** 更新昵称（参考桃桃优选） */
  updateProfile(id: string | number, nickname?: string): PublicUser | null {
    if (nickname !== undefined) {
      const name = String(nickname || '').trim()
      if (!name) throw new UnauthorizedException('昵称不能为空')
      if (name.length > 30) throw new UnauthorizedException('昵称最长 30 个字符')
      this.database.updateUserProfile(id, { nickname: name })
    }
    const user = this.database.getUserById(id)
    return user ? this.publicUser(user) : null
  }

  /** 保存头像（落盘后调用，avatarUrl 为可访问 URL） */
  setAvatar(id: string | number, avatarUrl: string): PublicUser | null {
    this.database.updateUserProfile(id, { avatar: avatarUrl })
    const user = this.database.getUserById(id)
    return user ? this.publicUser(user) : null
  }

  /** wx.login code → 会话（参考「重置雷达」契约：POST /session → {token, expiresAt, profile}） */
  async createSession(code: string): Promise<SessionResult> {
    const openid = await this.resolveOpenid(code)
    const expiresMs = 7 * 24 * 3600 * 1000
    const token = await this.jwt.signAsync({ sub: openid })
    return {
      token,
      expiresAt: new Date(Date.now() + expiresMs).toISOString(),
      profile: {},
    }
  }
}
