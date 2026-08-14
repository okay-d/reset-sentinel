import { Module } from '@nestjs/common'
import { MonitorService } from './monitor.service'
import { FetcherModule } from '../fetcher/fetcher.module'
import { EmailModule } from '../email/email.module'

@Module({
  imports: [FetcherModule, EmailModule],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
