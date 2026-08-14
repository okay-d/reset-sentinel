import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { WebSocketServer } from 'ws'
import { config } from '../config'

@Injectable()
export class CodexResetsGateway implements OnModuleInit {
  private readonly logger = new Logger(CodexResetsGateway.name)
  private wss: WebSocketServer | null = null

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  onModuleInit() {
    const httpServer = this.adapterHost.httpAdapter.getHttpServer()
    this.wss = new WebSocketServer({ server: httpServer, path: config.wsPath })
    this.wss.on('connection', (socket) => {
      socket.on('error', () => {
        /* 单连接错误不影响服务 */
      })
    })
    this.logger.log(`求重置实时推送已就绪：ws://<host>${config.wsPath}`)
  }

  /** 向所有在线小程序广播求重置计数变化 */
  broadcast(message: Record<string, unknown>) {
    if (!this.wss) return
    const data = JSON.stringify(message)
    for (const client of this.wss.clients) {
      if (client.readyState === 1) client.send(data)
    }
  }
}
