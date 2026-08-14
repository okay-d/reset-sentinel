import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { config } from '../config'

/** 后台管理鉴权：请求头 x-admin-token 与配置一致 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest()
    const token = req.headers?.['x-admin-token'] as string | undefined
    if (!token || token !== config.adminToken) {
      throw new UnauthorizedException('管理口令错误')
    }
    return true
  }
}
