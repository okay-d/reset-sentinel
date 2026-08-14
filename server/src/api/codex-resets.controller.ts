import { Body, Controller, Get, Post } from '@nestjs/common'
import { DatabaseService } from '../database/database.service'
import { CodexResetsGateway } from './codex-resets.gateway'

@Controller('/api/codex-resets')
export class CodexResetsController {
  constructor(
    private readonly database: DatabaseService,
    private readonly gateway: CodexResetsGateway,
  ) {}

  @Get()
  events() {
    return { events: this.database.getResetEvents() }
  }

  @Get('/requests')
  requests() {
    return {
      count: Number(this.database.getMeta('beg_count') || 0),
      cycleId: this.database.syncBegCycle(),
    }
  }

  @Post('/requests')
  addRequest(@Body() body: { requestId?: string }) {
    const cycleId = this.database.syncBegCycle()
    const count = Number(this.database.getMeta('beg_count') || 0) + 1
    this.database.setMeta('beg_count', count)
    this.gateway.broadcast({
      type: 'reset-request-count',
      count,
      cycle_id: cycleId,
      ...(body.requestId ? { request_id: String(body.requestId) } : {}),
    })
    return { count, cycleId }
  }
}
