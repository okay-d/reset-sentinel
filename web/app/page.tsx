'use client'

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react'

type CalendarType = 'reset' | 'speech'
type CalendarDay = { date: string; count: number }
type Health = {
  ok: boolean
  account: string
  keywords: string[]
  pollIntervalMin: number
  posts: number
  lastPollAt: string | null
  monitorStatus: 'healthy' | 'degraded' | 'unknown'
}
type Hit = { id: number; url: string; text: string; createdAt: string }
type Post = { id: number; url: string; text: string; createdAt: string }

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`请求失败：${response.status}`)
  return response.json() as Promise<T>
}

function formatTime(value: string | null | undefined) {
  if (!value) return '暂无记录'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

function shortDate(value: string) {
  return value.slice(5).replace('-', '/')
}

function Calendar({
  title,
  type,
  days,
  selectedDate,
  onSelect,
}: {
  title: string
  type: CalendarType
  days: CalendarDay[]
  selectedDate: string | null
  onSelect: (date: string, type: CalendarType) => void
}) {
  const total = days.reduce((sum, item) => sum + item.count, 0)
  const max = Math.max(...days.map((item) => item.count), 1)
  return (
    <section className="panel p-5 sm:p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2 className="mt-2 text-xl font-bold text-ink">{title}</h2>
        </div>
        <span className="chip bg-brand/10 text-brand">近 {days.length} 天 · {total} 条</span>
      </div>
      <div className="mt-5 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(13, minmax(0, 1fr))' }}>
        {days.map((day) => {
          const active = day.count > 0
          const intensity = active ? Math.max(.3, day.count / max) : 0
          return (
            <button
              key={day.date}
              type="button"
              title={`${day.date} · ${day.count} 条`}
              onClick={() => onSelect(day.date, type)}
              className={`aspect-square rounded-md border text-[10px] transition hover:-translate-y-0.5 hover:shadow-sm ${selectedDate === day.date ? 'ring-2 ring-brand ring-offset-2' : ''} ${active ? 'border-brand/30 text-white' : 'border-slate-100 bg-slate-50 text-slate-300'}`}
              style={active ? { backgroundColor: `rgba(78, 110, 242, ${intensity})` } : undefined}
            >
              {day.count || ''}
            </button>
          )
        })}
      </div>
      <div className="mt-4 flex justify-between text-xs text-muted">
        <span>{days[0] ? shortDate(days[0].date) : '—'}</span>
        <span>点击日期查看当天内容</span>
        <span>{days.at(-1) ? shortDate(days.at(-1)!.date) : '—'}</span>
      </div>
    </section>
  )
}

export default function HomePage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [resetDays, setResetDays] = useState<CalendarDay[]>([])
  const [speechDays, setSpeechDays] = useState<CalendarDay[]>([])
  const [hits, setHits] = useState<Hit[]>([])
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedPosts, setSelectedPosts] = useState<Post[]>([])
  const [email, setEmail] = useState('')
  const [emailMessage, setEmailMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextHealth, reset, speech, hitResult] = await Promise.all([
        getJson<Health>('/api/health'),
        getJson<{ days: CalendarDay[] }>('/api/calendar?type=reset&days=91'),
        getJson<{ days: CalendarDay[] }>('/api/calendar?type=speech&days=91'),
        getJson<{ list: Hit[] }>('/api/hits?page=1&size=8'),
      ])
      setHealth(nextHealth)
      setResetDays(reset.days)
      setSpeechDays(speech.days)
      setHits(hitResult.list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function openDate(date: string, type: CalendarType) {
    setSelectedDate(date)
    try {
      const result = type === 'reset'
        ? await getJson<{ list: Post[] }>(`/api/hits?date=${date}`)
        : await getJson<{ list: Post[] }>(`/api/posts?date=${date}`)
      setSelectedPosts(result.list)
    } catch {
      setSelectedPosts([])
    }
  }

  async function subscribe(event: FormEvent) {
    event.preventDefault()
    setEmailMessage('')
    try {
      const response = await fetch(`${API}/api/email-subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const result = await response.json() as { ok: boolean; message?: string; reason?: string }
      if (!result.ok) throw new Error(result.reason || '订阅失败')
      setEmailMessage(result.message || '邮箱提醒已开启')
      setEmail('')
    } catch (e) {
      setEmailMessage(e instanceof Error ? e.message : '订阅失败，请稍后重试')
    }
  }

  const statusText = health?.monitorStatus === 'healthy' ? '监控正常' : health?.monitorStatus === 'degraded' ? '监控有延迟' : '等待状态'
  const latest = hits[0]
  const selectedTitle = selectedDate ? `${selectedDate} 的记录` : '点击日历查看某一天'
  const recentCount = useMemo(() => resetDays.reduce((sum, day) => sum + day.count, 0), [resetDays])

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col justify-between gap-5 border-b border-ink/10 pb-7 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-brand text-xl text-white shadow-lg shadow-brand/25">↻</span>
              <div>
                <p className="eyebrow">Reset Sentinel</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-4xl">重置哨兵</h1>
              </div>
            </div>
            <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">不用反复刷新动态。程序定时检查公开内容，把重置和发言记录整理成日历，并在有新命中时发送邮件提醒。</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`chip ${health?.monitorStatus === 'healthy' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}><span className="h-2 w-2 rounded-full bg-current" />{statusText}</span>
            <button type="button" onClick={() => void load()} className="rounded-full border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink transition hover:border-brand hover:text-brand">刷新</button>
          </div>
        </header>

        {error && <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}。请确认后端地址：{API}</div>}

        <section className="mt-7 grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
          <div className="panel relative overflow-hidden bg-gradient-to-br from-brand-deep to-brand p-6 text-white sm:p-8">
            <div className="relative z-10 max-w-2xl">
              <p className="text-sm font-semibold text-mint">{health?.account ? `监控账号 @${health.account}` : '监控账号加载中'}</p>
              <h2 className="mt-5 text-3xl font-black leading-tight sm:text-5xl">把“刷一下看看”<br /><span className="text-mint">交给程序。</span></h2>
              <p className="mt-5 max-w-xl text-sm leading-7 text-white/75 sm:text-base">后端定时获取公开动态，使用关键词识别相关内容；网页端只展示已经整理好的结果。</p>
              <div className="mt-7 flex flex-wrap gap-2 text-xs text-white/80">
                <span className="rounded-full bg-white/10 px-3 py-2">关键词：{health?.keywords?.join(' / ') || 'reset / 重置'}</span>
                <span className="rounded-full bg-white/10 px-3 py-2">约每 {health?.pollIntervalMin || '—'} 分钟检查</span>
              </div>
            </div>
            <div className="pointer-events-none absolute -right-10 -top-12 h-64 w-64 rounded-full border-[24px] border-white/10" />
            <div className="pointer-events-none absolute -bottom-20 right-12 h-72 w-72 rounded-full border border-mint/30" />
          </div>
          <div className="panel p-6 sm:p-8">
            <p className="eyebrow">Mail alert</p>
            <h2 className="mt-3 text-2xl font-black">只想收到提醒？</h2>
            <p className="mt-3 text-sm leading-6 text-muted">输入邮箱即可订阅，不需要注册或登录。发现新的相关动态后，后端会发送邮件。</p>
            <form onSubmit={subscribe} className="mt-6 space-y-3">
              <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="your@email.com" className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 outline-none transition placeholder:text-slate-400 focus:border-brand focus:bg-white focus:ring-4 focus:ring-brand/10" />
              <button type="submit" className="w-full rounded-2xl bg-sun px-4 py-3 font-bold text-[#5d4600] transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sun/25">开启邮箱提醒</button>
            </form>
            {emailMessage && <p className="mt-3 text-sm font-semibold text-brand">{emailMessage}</p>}
            <p className="mt-5 text-xs leading-5 text-muted">邮箱只用于发送监控提醒，不要求登录。</p>
          </div>
        </section>

        <section className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            ['最近 91 天重置', loading ? '—' : recentCount],
            ['已记录动态', loading ? '—' : health?.posts ?? '—'],
            ['最近检查', health?.lastPollAt ? formatTime(health.lastPollAt) : '—'],
            ['当前状态', statusText],
          ].map(([label, value]) => <div key={label} className="panel min-h-28 p-5"><p className="text-xs text-muted">{label}</p><p className="mt-3 break-words text-xl font-black text-ink sm:text-2xl">{value}</p></div>)}
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-2">
          <Calendar title="重置记录" type="reset" days={resetDays} selectedDate={selectedDate} onSelect={openDate} />
          <Calendar title="发言记录" type="speech" days={speechDays} selectedDate={selectedDate} onSelect={openDate} />
        </section>

        <section className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <div className="panel p-5 sm:p-6">
            <div className="flex items-end justify-between gap-3"><div><p className="eyebrow">Latest hits</p><h2 className="mt-2 text-xl font-bold">最近的重置动态</h2></div><span className="chip bg-sun/30 text-[#8a6500]">实时记录</span></div>
            <div className="mt-5 divide-y divide-slate-100">
              {hits.length === 0 && <p className="py-10 text-center text-sm text-muted">暂时还没有命中记录</p>}
              {hits.map((hit) => <article key={hit.id} className="py-4 first:pt-0"><div className="flex items-center justify-between gap-3 text-xs text-muted"><span>{formatTime(hit.createdAt)}</span><a className="font-semibold text-brand hover:underline" href={hit.url} target="_blank" rel="noreferrer">查看原文 ↗</a></div><p className="mt-2 text-sm leading-6 text-ink">{hit.text}</p></article>)}
            </div>
          </div>
          <div className="panel p-5 sm:p-6">
            <p className="eyebrow">Selected day</p>
            <h2 className="mt-2 text-xl font-bold">{selectedTitle}</h2>
            <div className="mt-5 space-y-3">
              {!selectedDate && <p className="rounded-2xl bg-slate-50 p-5 text-sm leading-6 text-muted">日历上的数字代表当天记录数量。点击一个日期，这里会显示当天的内容。</p>}
              {selectedDate && selectedPosts.length === 0 && <p className="rounded-2xl bg-slate-50 p-5 text-sm text-muted">当天没有可展示的记录。</p>}
              {selectedPosts.map((post) => <article key={post.id} className="rounded-2xl bg-slate-50 p-4"><p className="text-xs text-muted">{formatTime(post.createdAt)}</p><p className="mt-2 text-sm leading-6">{post.text}</p><a className="mt-2 inline-block text-xs font-bold text-brand hover:underline" href={post.url} target="_blank" rel="noreferrer">打开原文 ↗</a></article>)}
            </div>
          </div>
        </section>

        <footer className="flex flex-col justify-between gap-2 py-8 text-xs text-muted sm:flex-row"><span>重置哨兵 · 一个为了解决重复刷新的小工具</span><span>公开内容监控 · 邮箱提醒无需登录</span></footer>
      </div>
    </main>
  )
}
