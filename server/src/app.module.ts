import { Module } from '@nestjs/common'
import { DatabaseModule } from './database/database.module'
import { KeywordsModule } from './keywords/keywords.module'
import { FetcherModule } from './fetcher/fetcher.module'
import { MonitorModule } from './monitor/monitor.module'
import { WechatModule } from './wechat/wechat.module'
import { AuthModule } from './auth/auth.module'
import { ApiModule } from './api/api.module'
import { EmailModule } from './email/email.module'

@Module({
  imports: [
    DatabaseModule,
    KeywordsModule,
    FetcherModule,
    MonitorModule,
    WechatModule,
    AuthModule,
    ApiModule,
    EmailModule,
  ],
})
export class AppModule {}
