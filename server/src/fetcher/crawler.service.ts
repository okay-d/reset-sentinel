import { Injectable } from '@nestjs/common'
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import { promisify } from 'node:util'
import { config } from '../config'

const execFileAsync = promisify(execFile)

export interface RawTweet {
  tweetId: string
  text: string
  createdAt: string
  isReset?: boolean
}

/** 雪花 ID 字符串比较（19 位数字，超出 Number 精度） */
function idGreater(a: string, b: string): boolean {
  if (a.length !== b.length) return a.length > b.length
  return a > b
}

function normalizeCookies(list: any[]): Array<Record<string, any>> {
  const sameSiteMap: Record<string, string> = {
    no_restriction: 'None',
    lax: 'Lax',
    strict: 'Strict',
    none: 'None',
  }
  const out: Array<Record<string, any>> = []
  for (const c of list) {
    if (!c || !c.name || !c.value || !c.domain) continue
    const item: Record<string, any> = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
    }
    if (c.expires != null) item.expires = c.expires
    else if (c.expirationDate != null) item.expires = c.expirationDate
    if (c.httpOnly != null) item.httpOnly = !!c.httpOnly
    if (c.secure != null) item.secure = !!c.secure
    const ss = c.sameSite ? sameSiteMap[String(c.sameSite).toLowerCase()] : undefined
    if (ss) item.sameSite = ss
    out.push(item)
  }
  return out
}

@Injectable()
export class CrawlerService {
  private username = config.account

  private async toggleClash(action: 'on' | 'off'): Promise<void> {
    if (!config.clashctlCommand.trim()) return
    try {
      const result = await execFileAsync(config.clashctlShell, ['-ic', `${config.clashctlCommand} ${action}`], {
        timeout: 30_000,
        maxBuffer: 1024 * 1024,
      })
      const output = `${result.stdout || ''}${result.stderr || ''}`.trim().replace(/\s+/g, ' ')
      if (output) console.log(`[crawler] clashctl ${action}: ${output}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`clashctl ${action} 执行失败：${message}`)
    }
  }

  private loadCookiesFile(): Array<Record<string, any>> | null {
    if (!fs.existsSync(config.cookiesFile)) return null
    const raw = JSON.parse(fs.readFileSync(config.cookiesFile, 'utf8'))
    if (!Array.isArray(raw) || raw.length === 0) return null
    return normalizeCookies(raw)
  }

  private async launchBrowser(headless: boolean) {
    const { chromium } = await import('playwright')
    const args = ['--disable-blink-features=AutomationControlled']
    const channels = config.crawlerChannel ? [config.crawlerChannel] : ['chrome', 'msedge']
    let lastError: unknown = null
    for (const channel of channels) {
      try {
        return await chromium.launch({ channel, headless, args })
      } catch (e) {
        lastError = e
      }
    }
    try {
      return await chromium.launch({ headless, args })
    } catch (e) {
      throw new Error(
        `无法启动 Playwright Chromium（本机 Chrome/Edge 与内置 Chromium 均不可用）：${(e as Error).message}。` +
          `请先执行 npx playwright install chromium${lastError ? `（Channel 错误：${(lastError as Error).message}）` : ''}`,
      )
    }
  }

  private async scrapeTweets(page: any, latestKnownId?: string | null): Promise<RawTweet[]> {
    try {
      await page.goto(`https://x.com/${this.username}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
    } catch {
      const title = await page.title().catch(() => '')
      throw new Error(`官方 x.com 页面请求失败（页面标题：${title}）。请检查网络或代理配置`)
    }

    // X 的时间线是异步挂载的，data-testid 可能变化；用推文稳定存在的 time + status 链接判断。
    let timelineLoaded = false
    for (let attempt = 0; attempt < 2 && !timelineLoaded; attempt++) {
      try {
        await page.waitForSelector('article:has(time)', { timeout: 30000 })
        timelineLoaded = true
      } catch {
        if (attempt === 0) {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined)
        }
      }
    }
    if (!timelineLoaded) {
      const title = await page.title().catch(() => '')
      const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 180)
      const loginRequired = /登录|注册|Log in|Sign up/i.test(body)
      throw new Error(
        loginRequired
          ? `官方 x.com 要求重新登录（页面标题：${title}），请重新导出 Cookie`
          : `官方 x.com 时间线加载失败（页面标题：${title}，页面内容：${body || '空白'}）`,
      )
    }
    await page.waitForTimeout(1500)

    const seen = new Set<string>()
    const all: Array<{ id: string; text: string; createdAt: string }> = []
    const collect = async () => {
      const items = await page.$$eval('article:has(time)', (articles: Element[]) =>
        articles
          .map((el) => {
            const timeEl = el.querySelector('time')
            const linkEl = timeEl && timeEl.closest('a[href*="/status/"]')
            const textEl = el.querySelector('[data-testid="tweetText"]')
            const id = linkEl ? (linkEl.getAttribute('href')?.match(/\/status\/(\d+)/) || [])[1] : ''
            return {
              id,
              text: textEl ? textEl.textContent || '' : el.textContent || '',
              createdAt: timeEl ? timeEl.getAttribute('datetime') || '' : '',
            }
          })
          .filter((t) => t.id && t.text),
      )
      for (const t of items) {
        if (!seen.has(t.id)) {
          seen.add(t.id)
          all.push(t)
        }
      }
    }

    await collect()
    // 增量优化：首屏最新推文已入库 → 没有新动态，跳过滚动加载历史
    const newest = all[0]
    const hasNew = !latestKnownId || !newest || idGreater(newest.id, String(latestKnownId))
    if (hasNew) {
      for (let i = 0; i < config.crawlerScrolls; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(1200)
        await collect()
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1500)
    await collect()

    if (all.length === 0) throw new Error('页面已加载但未解析到推文')
    return all.map((t) => ({
      tweetId: t.id,
      text: t.text,
      createdAt: new Date(t.createdAt).toISOString(),
    }))
  }

  async fetch(account = config.account, latestKnownId?: string | null): Promise<RawTweet[]> {
    this.username = account
    const cookies = this.loadCookiesFile()
    if (!cookies) {
      throw new Error(
        `未找到 Cookie 文件 ${config.cookiesFile}。请先提供 X 登录 Cookie`,
      )
    }
    await this.toggleClash('on')
    try {
      const browser = await this.launchBrowser(true)
      try {
        const context = await browser.newContext({
          proxy: config.httpProxy ? { server: config.httpProxy } : undefined,
          viewport: { width: 1280, height: 900 },
          locale: 'en-US',
        })
        await context.addCookies(cookies as never[])
        const page = await context.newPage()
        return await this.scrapeTweets(page, latestKnownId)
      } finally {
        await browser.close()
      }
    } finally {
      try {
        await this.toggleClash('off')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[crawler] ${message}`)
      }
    }
  }
}
