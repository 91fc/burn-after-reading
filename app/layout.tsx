import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Burn After Reading',
  description: 'Share encrypted messages and files that self-destruct after viewing.',
  icons: { icon: '/icon.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-brand-dark text-gray-100 antialiased">
        {children}
      </body>
    </html>
  )
}
