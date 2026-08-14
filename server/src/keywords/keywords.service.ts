import { Injectable } from '@nestjs/common'
import { config } from '../config'

@Injectable()
export class KeywordsService {
  isReset(text: string, keywords?: string[]): boolean {
    const t = String(text || '').toLowerCase()
    const list = keywords && keywords.length > 0 ? keywords : config.keywords
    return list.some((k) => t.includes(k.toLowerCase()))
  }
}
