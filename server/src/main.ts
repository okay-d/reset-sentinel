import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from '@nestjs/common'
import { join } from 'node:path'
import { AppModule } from './app.module'
import { config } from './config'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule)
  app.enableCors()
  // 头像等上传文件的静态访问
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' })
  await app.listen(config.port)
  Logger.log(`重置哨兵后端（NestJS）已启动：http://127.0.0.1:${config.port}`, 'bootstrap')
}

bootstrap()
