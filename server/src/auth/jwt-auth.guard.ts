import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { config } from '../config'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest()
    const header = req.headers?.['authorization'] as string | undefined
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) throw new UnauthorizedException('缺少认证令牌')
    try {
      req.user = await this.jwt.verifyAsync(token, { secret: config.jwtSecret })
      return true
    } catch {
      throw new UnauthorizedException('认证令牌无效或已过期')
    }
  }
}
