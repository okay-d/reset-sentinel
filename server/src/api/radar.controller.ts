import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

/**
 * 参考「重置雷达」后端契约（升级版小程序预留）
 * 认证：POST /session 换取 Bearer token
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class RadarController {
  constructor(private readonly database: DatabaseService) {}

  @Get('/reset-history/:account/summary')
  resetHistorySummary(@Param('account') account: string) {
    return this.database.getResetHistorySummary(account)
  }

  @Get('/reset-history/:account/history')
  resetHistory(
    @Param('account') account: string,
    @Query('date') date?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.database.getResetHistory(account, date, before, parseInt(limit || '20', 10))
  }

  @Get('/account-activity/:account/summary')
  accountActivitySummary(@Param('account') account: string) {
    return this.database.getAccountActivitySummary(account)
  }

  @Get('/account-activity/:account/history')
  accountActivityHistory(
    @Param('account') account: string,
    @Query('before') before?: string,
    @Query('limitDays') limitDays?: string,
  ) {
    return this.database.getAccountActivityHistory(account, before, parseInt(limitDays || '1', 10))
  }
}
