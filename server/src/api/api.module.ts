import { Module } from '@nestjs/common'
import { SentinelController } from './sentinel.controller'
import { CodexResetsController } from './codex-resets.controller'
import { CodexResetsGateway } from './codex-resets.gateway'
import { RadarController } from './radar.controller'
import { DevController } from './dev.controller'
import { AdminController } from './admin.controller'
import { AdminGuard } from './admin.guard'
import { AuthModule } from '../auth/auth.module'
import { MonitorModule } from '../monitor/monitor.module'
import { EmailModule } from '../email/email.module'

@Module({
  imports: [AuthModule, MonitorModule, EmailModule],
  controllers: [SentinelController, CodexResetsController, RadarController, DevController, AdminController],
  providers: [CodexResetsGateway, AdminGuard],
  exports: [CodexResetsGateway],
})
export class ApiModule {}
