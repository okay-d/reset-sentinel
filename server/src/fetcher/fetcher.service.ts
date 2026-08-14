import { Injectable } from '@nestjs/common'
import { config } from '../config'
import { KeywordsService } from '../keywords/keywords.service'
import { CrawlerService } from './crawler.service'

export interface RawTweet {
  tweetId: string
  text: string
  createdAt: string
  isReset?: boolean
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

@Injectable()
export class FetcherService {
  private username = config.account
  constructor(
    private readonly keywords: KeywordsService,
    private readonly crawler: CrawlerService,
  ) {}

  /** 模拟数据源（离线开发用） */
  private fetchMock(): RawTweet[] {
    const tweets: RawTweet[] = []
    const rand = mulberry32(20260801)
    const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1))
    const textPool = [
      'Codex quota has reset for the week. Rate limits refreshed 🎉',
      'Quick update: our rate limit system just reset — new limits are live now.',
      'Reminder: Codex usage limits refresh every week. Check your quota in the dashboard.',
      'Shipping a small fix to the Codex CLI today.',
      'Great thread on agentic coding patterns 👍',
      'Weekend deep dive: how we think about agent evaluation.',
      'Thanks for all the feedback on the new dashboard!',
      'Working on something cool for the next release 🚀',
      'Hot take: the best UI is the one you do not need.',
      'Coffee first, then code. ☕',
      'The reset schedule stays the same this week — every Monday UTC.',
      'Join us for the community office hours this Friday!',
      'Building in public, sharing the roadmap tomorrow.',
    ]
    const today = new Date()
    let id = 1
    const base = 1905000000000000000n
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const dow = d.getDay()
      let count = rand() < 0.92 ? randInt(1, 8) : 0
      if (rand() < 0.08) count = randInt(10, 18)
      if (dow === 0 || dow === 6) count = Math.floor(count / 2)
      for (let k = 0; k < count; k++) {
        d.setMinutes(randInt(0, 23) * 60 + randInt(0, 59))
        tweets.push({
          tweetId: String(base + BigInt(id)),
          text: textPool[randInt(0, textPool.length - 1)],
          createdAt: new Date(d).toISOString(),
        })
        id++
      }
    }
    tweets.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    return tweets
  }

  /** 拉取最近推文：生产环境只通过 Cookie 访问官方 x.com，mock 仅用于离线开发 */
  async fetchRecentTweets(
    account = config.account,
    keywords?: string[],
    latestKnownId?: string | null,
  ): Promise<RawTweet[]> {
    this.username = account
    const mode = config.fetchMode

    if (mode === 'mock') {
      return this.fetchMock().map((t) => ({
        ...t,
        url: `https://x.com/${account}/status/${t.tweetId}`,
        isReset: this.keywords.isReset(t.text, keywords),
      }))
    }

    if (!config.useCrawler) {
      throw new Error('官方 X 爬虫已禁用，请设置 USE_CRAWLER=true')
    }

    const tweets = await this.crawler.fetch(account, latestKnownId)
    return tweets.slice(0, config.maxFetch).map((t) => ({
      ...t,
      url: `https://x.com/${account}/status/${t.tweetId}`,
      isReset: this.keywords.isReset(t.text, keywords),
    }))
  }
}
