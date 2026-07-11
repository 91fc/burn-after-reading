'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (res.status === 401) {
        setError('密码错误')
        return
      }
      if (!res.ok) {
        setError('登录失败')
        return
      }

      router.push('/write')
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mb-2 text-4xl">🔒</div>
          <h1 className="text-xl font-semibold">阅后即焚</h1>
          <p className="mt-1 text-sm text-brand-muted">输入密码以创建加密内容</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
            autoFocus
            className="w-full rounded-lg border border-white/10 bg-brand-surface px-4 py-3 text-sm focus:border-brand-accent focus:outline-none focus:ring-1 focus:ring-brand-accent"
            disabled={loading}
          />

          {error && <p className="text-sm text-brand-danger">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded-lg bg-brand-accent px-4 py-3 text-sm font-medium text-brand-dark transition hover:opacity-90 disabled:opacity-40"
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <div className="text-center">
          <Link href="/write" className="text-xs text-brand-muted hover:text-gray-300">
            首页
          </Link>
        </div>
      </div>
    </main>
  )
}
