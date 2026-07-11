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
import { getExpirationDate } from '@/lib/expiration'

type Mode = 'message' | 'file'
type State = 'writing' | 'encrypting' | 'finished'

export default function WritePage() {
  const router = useRouter()
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [mode, setMode] = useState<Mode>('message')
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [expirationIdx, setExpirationIdx] = useState(0)
  const [state, setState] = useState<State>('writing')
  const [resultUrl, setResultUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth-check')
      .then((res) => res.json())
      .then((data) => {
        if (!data.authed) {
          router.push('/login')
        } else {
          setAuthed(true)
        }
      })
      .catch(() => setAuthed(true))
  }, [router])

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

      const { ciphertext, hasPassword } = await encryptContent(
        content,
        fragmentKey,
        passphrase || undefined,
      )

      const expiresAt = getExpirationDate(expirationIdx)

      const res = await fetch('/api/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-paste-expiration': expiresAt.toISOString(),
          'x-paste-content-type': contentType,
          'x-paste-password': hasPassword ? 'true' : 'false',
        },
        body: ciphertext,
      })

      if (res.status === 401) {
        router.push('/login')
        return
      }
      if (res.status === 413) {
        setError('File too large. Use the direct upload flow for files over 4.5MB.')
        setState('writing')
        return
      }
      if (!res.ok) {
        setError('Failed to upload. Please try again.')
        setState('writing')
        return
      }

      const { hash } = await res.json()
      const url = `${window.location.origin}/read/${hash}#key=${fragmentKey}`
      setResultUrl(url)
      setState('finished')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Encryption failed')
      setState('writing')
    }
  }

  function handleNewPaste() {
    setState('writing')
    setMessage('')
    setFile(null)
    setPassphrase('')
    setResultUrl('')
  }

  async function handleCopyLink() {
    await navigator.clipboard.writeText(resultUrl)
  }

  if (state === 'finished') {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center">
            <div className="mb-2 text-4xl">✅</div>
            <h1 className="text-lg font-semibold">Secret link created</h1>
            <p className="mt-1 text-sm text-brand-muted">
              Share this link. It self-destructs after one view.
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
              Copy Link
            </button>
            <button
              onClick={handleNewPaste}
              className="flex-1 rounded-lg border border-white/10 px-4 py-3 text-sm font-medium hover:bg-white/5"
            >
              New
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
          <h1 className="text-lg font-semibold">Burn After Reading</h1>
        </div>
        <button
          onClick={async () => {
            await fetch('/api/logout', { method: 'POST' })
            router.push('/login')
          }}
          className="text-xs text-brand-muted hover:text-gray-300"
        >
          Sign Out
        </button>
      </div>

      {state === 'encrypting' && <Loader message="Encrypting and uploading..." />}

      {state === 'writing' && (
        <div className="space-y-6">
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
              Message
            </button>
            <button
              onClick={() => setMode('file')}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition ${
                mode === 'file'
                  ? 'bg-brand-accent text-brand-dark'
                  : 'border border-white/10 bg-brand-surface text-brand-muted'
              }`}
            >
              File
            </button>
          </div>

          {/* Content input */}
          {mode === 'message' ? (
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your secret message..."
              rows={6}
              className="w-full rounded-lg border border-white/10 bg-brand-surface px-4 py-3 text-sm focus:border-brand-accent focus:outline-none"
            />
          ) : (
            <FileDropZone onFile={setFile} selectedFile={file} />
          )}

          {/* Optional passphrase */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-brand-muted">
              Extra passphrase (optional)
            </label>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Leave empty for link-only encryption"
              className="w-full rounded-lg border border-white/10 bg-brand-surface px-4 py-3 text-sm focus:border-brand-accent focus:outline-none"
            />
          </div>

          {/* Expiration */}
          <div>
            <label className="mb-2 block text-xs font-medium text-brand-muted">
              Expires in
            </label>
            <ExpirationPicker selected={expirationIdx} onSelect={setExpirationIdx} />
          </div>

          {error && <p className="text-sm text-brand-danger">{error}</p>}

          {/* Save button */}
          <button
            onClick={handleSave}
            disabled={mode === 'message' ? !message.trim() : !file}
            className="w-full rounded-lg bg-brand-accent px-4 py-3 text-sm font-medium text-brand-dark transition hover:opacity-90 disabled:opacity-40"
          >
            Encrypt &amp; Create Link
          </button>
        </div>
      )}
    </main>
  )
}
