import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '阅后即焚',
  description: '分享加密消息和文件，查看后自动销毁。',
  icons: { icon: '/icon.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="min-h-screen bg-brand-dark text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}
