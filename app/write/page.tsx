'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FileDropZone } from '@/components/FileDropZone'
import { ExpirationPicker } from '@/components/ExpirationPicker'
import { Loader } from '@/components/Loader'
import {
  generateFragmentKey,
  encryptContent,
  addPrefix,
} from '@/lib/client/crypto'
import { getExpirationDate, getExpirationOptions } from '@/lib/expiration'

type Mode = 'message' | 'file'
type ShareMode = 'burn' | 'persistent'
type State = 'writing' | 'encrypting' | 'finished'

export default function WritePage() {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [mode, setMode] = useState<Mode>('message')
  const [shareMode, setShareMode] = useState<ShareMode>('burn')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [expirationIdx, setExpirationIdx] = useState(0)
  const [state, setState] = useState<State>('writing')
  const [resultUrl, setResultUrl] = useState('')
  const [deleteToken, setDeleteToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setAuthed(true)
  }, [])

  // Reset expiration index when share mode changes
  useEffect(() => {
    setExpirationIdx(0)
  }, [shareMode])

  async function handleSave() {
    setError(null)
    setState('encrypting')

    try {
      const fragmentKey = await generateFragmentKey()

      let content: ArrayBuffer
      let contentType: string

      if (mode === 'file' && file) {
        const raw = await file.arrayBuffer()
        content = addPrefix(raw, file.name)
        contentType = file.type || 'application/octet-stream'
      } else {
        const encoded = new TextEncoder().encode(message)
        content = addPrefix(encoded.buffer, '')
        contentType = 'text/plain'
      }

      const ciphertext = await encryptContent(content, fragmentKey)

      const expiresAt = getExpirationDate(expirationIdx, shareMode)

      const res = await fetch('/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-paste-expiration': expiresAt.toISOString(),
          'x-paste-content-type': contentType,
          'x-paste-mode': shareMode,
        },
        body: ciphertext,
      })

      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (res.status === 413) {
        setError('文件过大。最大支持 4.5MB。')
        setState('writing')
        return
      }
      if (res.status === 503) {
        setError('服务器容量已满，请稍后再试。')
        setState('writing')
        return
      }
      if (!res.ok) {
        setError('上传失败，请重试。')
        setState('writing')
        return
      }

      const { hash, deleteToken: dToken } = await res.json()
      const url = `${window.location.origin}/read/${hash}#key=${fragmentKey}`
      setResultUrl(url)
      setDeleteToken(dToken)
      setState('finished')
    } catch (err) {
      setError(err instanceof Error ? err.message : '加密失败')
      setState('writing')
    }
  }

  async function handleDelete() {
    if (!resultUrl) return
    // Extract hash from URL
    const match = resultUrl.match(/\/read\/([^#]+)/)
    if (!match) return
    const hash = match[1]

    await fetch(`/api/data/${hash}`, {
      method: 'DELETE',
      headers: { 'x-delete-token': deleteToken },
    })

    setState('writing')
    setMessage('')
    setFile(null)
    setResultUrl('')
    setDeleteToken('')
  }

  function handleNewPaste() {
    setState('writing')
    setMessage('')
    setFile(null)
    setResultUrl('')
    setDeleteToken('')
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(resultUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (state === 'finished') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="mb-2 text-4xl">{shareMode === 'burn' ? '🔥' : '✅'}</div>
            <h1 className="text-lg font-semibold">加密链接已创建</h1>
            <p className="mt-1 text-sm text-brand-muted">
              {shareMode === 'burn'
                ? '分享此链接。对方查看后将自动销毁。'
                : '分享此链接。到期前可多次查看。'}
            </p>
            <p className="mt-1 text-xs text-brand-muted/70">
              数据加密存储在服务器，到期后自动删除。
            </p>
          </div>

          <div className="rounded-lg border border-white/10 bg-brand-surface p-4">
            <p className="break-all font-mono text-xs text-gray-300">{resultUrl}</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleCopyLink}
              className="flex-1 rounded-lg bg-brand-accent px-4 py-3 text-sm font-medium text-brand-dark hover:opacity-90"
            >
              {copied ? '✓ 已复制' : '复制链接'}
            </button>
            <button
              onClick={handleDelete}
              className="rounded-lg border border-brand-danger/30 px-4 py-3 text-sm font-medium text-brand-danger hover:bg-brand-danger/10"
            >
              删除
            </button>
            <button
              onClick={handleNewPaste}
              className="flex-1 rounded-lg border border-white/10 px-4 py-3 text-sm font-medium hover:bg-white/5"
            >
              新建
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🔒</span>
          <h1 className="text-lg font-semibold">加密分享</h1>
        </div>
        <button
          onClick={() => router.push('/')}
          className="text-xs text-brand-muted hover:text-gray-300"
        >
          首页
        </button>
      </div>

      {state === 'encrypting' && <Loader message="加密并上传中..." />}

      {state === 'writing' && (
        <div className="space-y-6">
          {/* Share mode toggle */}
          <div>
            <label className="mb-2 block text-xs font-medium text-brand-muted">
              分享模式
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setShareMode('burn')}
                className={`rounded-lg border-2 p-4 text-left transition ${
                  shareMode === 'burn'
                    ? 'border-brand-danger bg-brand-danger/10'
                    : 'border-white/10 bg-brand-surface hover:border-white/20'
                }`}
              >
                <div className="mb-1 text-2xl">🔥</div>
                <div className="text-sm font-medium">阅后即焚</div>
                <div className="mt-0.5 text-xs text-brand-muted">
                  查看一次后自动销毁
                </div>
              </button>
              <button
                onClick={() => setShareMode('persistent')}
                className={`rounded-lg border-2 p-4 text-left transition ${
                  shareMode === 'persistent'
                    ? 'border-brand-accent bg-brand-accent/10'
                    : 'border-white/10 bg-brand-surface hover:border-white/20'
                }`}
              >
                <div className="mb-1 text-2xl">📎</div>
                <div className="text-sm font-medium">可重复查看</div>
                <div className="mt-0.5 text-xs text-brand-muted">
                  到期前可多次查看
                </div>
              </button>
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('message')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                mode === 'message'
                  ? 'bg-brand-accent text-brand-dark'
                  : 'border border-white/10 bg-brand-surface text-brand-muted'
              }`}
            >
              消息
            </button>
            <button
              onClick={() => setMode('file')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                mode === 'file'
                  ? 'bg-brand-accent text-brand-dark'
                  : 'border border-white/10 bg-brand-surface text-brand-muted'
              }`}
            >
              文件
            </button>
          </div>

          {/* Content input */}
          {mode === 'message' ? (
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="输入你的秘密消息..."
              rows={6}
              className="w-full rounded-lg border border-white/10 bg-brand-surface px-4 py-3 text-sm focus:border-brand-accent focus:outline-none"
            />
          ) : (
            <FileDropZone onFile={setFile} selectedFile={file} />
          )}

          {/* Expiration */}
          <div>
            <label className="mb-2 block text-xs font-medium text-brand-muted">
              有效期
            </label>
            <ExpirationPicker
              selected={expirationIdx}
              onSelect={setExpirationIdx}
              options={getExpirationOptions(shareMode)}
            />
          </div>

          {error && <p className="text-sm text-brand-danger">{error}</p>}

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={mode === 'message' ? !message.trim() : !file}
            className={`w-full rounded-lg px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40 ${
              shareMode === 'burn' ? 'bg-brand-danger' : 'bg-brand-accent'
            }`}
          >
            {shareMode === 'burn' ? '加密并创建链接' : '加密并创建链接'}
          </button>
        </div>
      )}
    </main>
  )
}
