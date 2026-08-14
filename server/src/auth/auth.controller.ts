import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { config } from '../config'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './jwt-auth.guard'

const AVATAR_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** 小程序登录（参考桃桃优选）：code → {token, user} */
  @Post('/auth/login')
  login(@Body() body: { code?: string }) {
    return this.auth.login(String(body.code || ''))
  }

  /** 当前登录用户 */
  @UseGuards(JwtAuthGuard)
  @Get('/auth/user')
  user(@Req() req: { user: { sub: string } }) {
    const user = this.auth.getUserById(req.user.sub)
    if (!user) throw new Error('用户不存在')
    return user
  }

  /** 更新昵称 */
  @UseGuards(JwtAuthGuard)
  @Post('/auth/update-profile')
  updateProfile(@Req() req: { user: { sub: string } }, @Body() body: { nickname?: string }) {
    const user = this.auth.updateProfile(req.user.sub, body.nickname)
    if (!user) throw new BadRequestException('用户不存在')
    return user
  }

  /** 上传头像（multipart/form-data，字段名 avatar） */
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileInterceptor('avatar', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  @Post('/auth/upload-avatar')
  uploadAvatar(
    @Req() req: { user: { sub: string }; get: (k: string) => string | undefined },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('请选择头像图片')
    }
    const ext = AVATAR_EXT[file.mimetype]
    if (!ext) throw new BadRequestException('仅支持 JPG/PNG/WebP/GIF 图片')
    const dir = join(process.cwd(), 'uploads', 'avatars')
    mkdirSync(dir, { recursive: true })
    const filename = `${req.user.sub}_${Date.now()}${ext}`
    writeFileSync(join(dir, filename), file.buffer)

    const host = req.get('host') || `localhost:${config.port}`
    const avatarUrl = `http://${host}/uploads/avatars/${filename}`
    const user = this.auth.setAvatar(req.user.sub, avatarUrl)
    if (!user) throw new BadRequestException('用户不存在')
    return { avatar: avatarUrl, user }
  }

  /** 参考「重置雷达」会话契约 */
  @Post('/session')
  session(@Body() body: { code?: string }) {
    return this.auth.createSession(String(body.code || ''))
  }
}
