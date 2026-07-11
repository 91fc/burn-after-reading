'use client'

import { useState, useEffect } from 'react'
import { use } from 'react'
import Link from 'next/link'
import { Loader } from '@/components/Loader'
import {
  getFragmentKeyFromUrl,
  stripKeyFromUrl,
  decryptContent,
  extractPrefix,
} from '@/lib/client/crypto'

type ShareMode = 'burn' | 'persistent'

type ReadState =
  | 'loading'
  | 'landing'
  | 'revealing'
  | 'content'
  | 'burned'
  | 'expired'
  | 'invalid'
  | 'missing-key'
  | 'decrypt-failed'
  | 'deleted'

interface PasteMeta {
  contentType: string
  sizeBytes: number
  mode: ShareMode
  expiresAt: string
  viewCount: number
}

export default function ReadPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [state, setState] = useState<ReadState>('loading')
  const [meta, setMeta] = useState<PasteMeta | null>(null)
  const [fragmentKey, setFragmentKey] = useState<string | null>(null)
  const [content, setContent] = useState<{
    text?: string
    blobUrl?: string
    filename?: string
    contentType: string
    isImage: boolean
  } | null>(null)
  const [showViews, setShowViews] = useState(false)
  const [viewLog, setViewLog] = useState<{ ip: string; timestamp: string }[]>([])

  // Step 1: Check for fragment key + fetch metadata
  useEffect(() => {
    const key = getFragmentKeyFromUrl()
    if (!key) {
      setState('missing-key')
      return
    }
    setFragmentKey(key)
    stripKeyFromUrl()

    fetch(`/api/data/${id}`)
      .then(async (res) => {
        if (res.status === 404) {
          setState('invalid')
          return
        }
        if (res.status === 410) {
          const body = await res.json()
          setState(body.reason === 'expired' ? 'expired' : 'burned')
          return
        }
        if (!res.ok) {
          setState('invalid')
          return
        }
        const data: PasteMeta = await res.json()
        setMeta(data)
        setState('landing')
      })
      .catch(() => setState('invalid'))
  }, [id])

  // Step 2: Reveal (fetch + decrypt)
  async function handleReveal() {
    if (!fragmentKey) {
      setState('missing-key')
      return
    }

    setState('revealing')

    try {
      const res = await fetch(`/api/data/${id}/reveal`, {
        method: 'POST',
      })

      if (res.status === 410) {
        const body = await res.json()
        setState(body.reason === 'expired' ? 'expired' : 'burned')
        return
      }
      if (!res.ok) {
        setState('decrypt-failed')
        return
      }

      const ciphertext = await res.arrayBuffer()
      const plaintext = await decryptContent(ciphertext, fragmentKey)
      displayContent(plaintext, meta?.contentType ?? 'application/octet-stream')
    } catch {
      setState('decrypt-failed')
    }
  }

  // Step 3: Delete (persistent mode only — burn auto-deletes on reveal)
  async function handleDelete() {
    if (!confirm('确定要删除这条消息吗？删除后无法恢复。')) return

    try {
      await fetch(`/api/data/${id}`, { method: 'DELETE' })
      setState('deleted')
    } catch {
      // Network error — stay on current state
    }
  }

  async function handleShowViews() {
    if (showViews) {
      setShowViews(false)
      return
    }
    setShowViews(true)
    setViewLog([])
    const res = await fetch(`/api/data/${id}/views`)
    if (res.ok) {
      const data = await res.json()
      setViewLog(data.views)
    }
  }

  function displayContent(plaintext: ArrayBuffer, contentType: string) {
    const { filename, content } = extractPrefix(plaintext)
    const isImage = contentType.startsWith('image/')

    if (contentType.startsWith('text/')) {
      const text = new TextDecoder().decode(content)
      setContent({ text, contentType, isImage: false })
    } else {
      const blob = new Blob([content], { type: contentType })
      const blobUrl = URL.createObjectURL(blob)
      setContent({ blobUrl, filename, contentType, isImage })
    }
    setState('content')
  }

  // --- Render states ---

  if (state === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader message="正在检查链接..." />
      </main>
    )
  }

  if (state === 'missing-key') {
    return (
      <CenteredCard icon="🔑" title="缺少解密密钥">
        <p className="text-sm text-brand-muted">
          此链接缺少解密密钥。请确保你复制了完整的链接，包括 # 后面的部分。
        </p>
      </CenteredCard>
    )
  }

  if (state === 'invalid') {
    return (
      <CenteredCard icon="❓" title="链接无效">
        <p className="text-sm text-brand-muted">
          此链接可能已过期或已被删除。
        </p>
      </CenteredCard>
    )
  }

  if (state === 'burned') {
    return (
      <CenteredCard icon="🔥" title="已销毁">
        <p className="text-sm text-brand-muted">
          此消息已被查看并永久销毁。
        </p>
      </CenteredCard>
    )
  }

  if (state === 'expired') {
    return (
      <CenteredCard icon="⏰" title="已过期">
        <p className="text-sm text-brand-muted">
          此消息已过期，无法再访问。
        </p>
      </CenteredCard>
    )
  }

  if (state === 'deleted') {
    return (
      <CenteredCard icon="🗑️" title="已删除">
        <p className="text-sm text-brand-muted">
          消息已从服务器删除。
        </p>
      </CenteredCard>
    )
  }

  if (state === 'decrypt-failed') {
    return (
      <CenteredCard icon="🔓" title="无法解密">
        <p className="text-sm text-brand-muted">
          链接可能不完整，或消息已损坏。
        </p>
      </CenteredCard>
    )
  }

  if (state === 'revealing') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader message="正在解密..." />
      </main>
    )
  }

  // Landing: show metadata, wait for user to click Reveal
  if (state === 'landing' && meta) {
    const isBurn = meta.mode === 'burn'
    const typeLabel = meta.contentType.startsWith('text/')
      ? '文本消息'
      : meta.contentType.startsWith('image/')
        ? '图片'
        : '文件'
    const sizeLabel =
      meta.sizeBytes < 1024
        ? `${meta.sizeBytes} B`
        : meta.sizeBytes < 1024 * 1024
          ? `${(meta.sizeBytes / 1024).toFixed(1)} KB`
          : `${(meta.sizeBytes / (1024 * 1024)).toFixed(1)} MB`

    return (
      <CenteredCard icon={isBurn ? '✉️' : '📎'} title={isBurn ? '你有一份加密消息' : '你有一条加密消息'}>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-brand-muted">类型</span>
            <span>{typeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted">大小</span>
            <span>{sizeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted">过期时间</span>
            <span>{new Date(meta.expiresAt).toLocaleString()}</span>
          </div>
          {!isBurn && (
            <div className="flex justify-between">
              <span className="text-brand-muted">已查看</span>
              <span>{meta.viewCount} 次</span>
            </div>
          )}
        </div>

        {!isBurn && (
          <div className="mt-3">
            <button
              onClick={handleShowViews}
              className="text-xs text-brand-muted underline hover:text-gray-300"
            >
              {showViews ? '收起访问记录' : '查看访问记录'}
            </button>
            {showViews && (
              <div className="mt-2 space-y-1 rounded border border-white/10 p-2">
                {viewLog.length === 0 ? (
                  <p className="text-xs text-brand-muted">暂无查看记录</p>
                ) : (
                  viewLog.map((v, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className="font-mono text-gray-300">{v.ip}</span>
                      <span className="text-brand-muted">
                        {new Date(v.timestamp).toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {isBurn ? (
          <div className="mt-6 rounded-lg border border-brand-danger/20 bg-brand-danger/5 p-3">
            <p className="text-xs text-brand-danger">
              ⚠️ 此消息一旦查看将永久销毁。
            </p>
          </div>
        ) : null}

        <button
          onClick={handleReveal}
          className={`mt-6 w-full rounded-lg px-4 py-3 text-sm font-medium text-white hover:opacity-90 ${
            isBurn ? 'bg-brand-danger' : 'bg-brand-accent'
          }`}
        >
          {isBurn ? '查看并销毁' : '查看消息'}
        </button>

        {!isBurn && (
          <button
            onClick={handleDelete}
            className="mt-2 w-full rounded-lg border border-brand-danger/30 px-4 py-2 text-xs font-medium text-brand-danger hover:bg-brand-danger/10"
          >
            删除消息
          </button>
        )}
      </CenteredCard>
    )
  }

  // Content displayed
  if (state === 'content' && content) {
    const isBurn = meta?.mode === 'burn'

    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-brand-muted">
            <span>{isBurn ? '🔥' : '📎'}</span>
            <span>
              {isBurn
                ? '此消息已从服务器永久销毁。'
                : `此消息将在 ${new Date(meta?.expiresAt ?? '').toLocaleString()} 后自动删除。`}
            </span>
          </div>
          <Link
            href="/write"
            className="text-xs text-brand-muted hover:text-gray-300"
          >
            首页
          </Link>
        </div>

        <div className="rounded-lg border border-white/10 bg-brand-surface p-6">
          {content.isImage && content.blobUrl ? (
            <img
              src={content.blobUrl}
              alt="分享的内容"
              className="mx-auto max-h-[60vh] rounded"
            />
          ) : content.text !== undefined ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">
              {content.text}
            </pre>
          ) : content.blobUrl ? (
            <div className="text-center">
              <p className="mb-3 text-sm">{content.filename ?? '下载文件'}</p>
              <a
                href={content.blobUrl}
                download={content.filename}
                className="inline-block rounded-lg bg-brand-accent px-6 py-3 text-sm font-medium text-brand-dark hover:opacity-90"
              >
                下载
              </a>
            </div>
          ) : null}
        </div>

        {!isBurn && (
          <button
            onClick={handleDelete}
            className="mt-4 w-full rounded-lg border border-brand-danger/30 px-4 py-2 text-xs font-medium text-brand-danger hover:bg-brand-danger/10"
          >
            删除消息
          </button>
        )}
      </main>
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <Loader />
    </main>
  )
}

function CenteredCard({
  icon,
  title,
  children,
}: {
  icon: string
  title: string
  children: React.ReactNode
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <div className="mb-2 text-4xl">{icon}</div>
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        <div className="rounded-lg border border-white/10 bg-brand-surface p-6">{children}</div>
        <div className="text-center">
          <Link href="/write" className="text-xs text-brand-muted hover:text-gray-300">
            首页
          </Link>
        </div>
      </div>
    </main>
  )
}
