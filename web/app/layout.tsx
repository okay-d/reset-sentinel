import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '重置哨兵｜动态监控',
  description: '自动记录公开动态中的重置与发言信息，并提供邮件提醒。',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
