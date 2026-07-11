'use client'

import { useState, useEffect } from 'react'
import { use } from 'react'
import { Loader } from '@/components/Loader'
import {
  getFragmentKeyFromUrl,
  stripKeyFromUrl,
  decryptContent,
  extractPrefix,
} from '@/lib/client/crypto'

type ReadState =
  | 'loading'
  | 'landing' // metadata fetched, waiting for user to click Reveal
  | 'revealing' // fetching content + decrypting
  | 'content' // decrypted content displayed
  | 'burned' // already viewed
  | 'expired'
  | 'invalid' // not found
  | 'missing-key' // no fragment key in URL
  | 'passphrase-required' // paste has password, user needs to enter it
  | 'decrypt-failed' // wrong key or corrupted

interface PasteMeta {
  contentType: string
  sizeBytes: number
  hasPassword: boolean
  expiresAt: string
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
  const [passphrase, setPassphrase] = useState('')
  const [content, setContent] = useState<{
    text?: string
    blobUrl?: string
    filename?: string
    contentType: string
    isImage: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  // Step 2: Reveal (fetch + decrypt + burn)
  async function handleReveal() {
    if (!fragmentKey) {
      setState('missing-key')
      return
    }

    setState('revealing')
    setError(null)

    try {
      const res = await fetch(`/api/data/${id}/reveal`, {
        method: 'POST',
      })

      if (res.status === 410) {
        const body = await res.json()
        setState(body.reason === 'expired' ? 'expired' : 'burned')
        return
      }
      if (res.status === 503) {
        setError('Content temporarily unavailable. Try again.')
        setState('landing')
        return
      }
      if (!res.ok) {
        setState('decrypt-failed')
        return
      }

      const ciphertext = await res.arrayBuffer()

      // Try decrypt with fragment key only first
      let plaintext: ArrayBuffer
      try {
        plaintext = await decryptContent(ciphertext, fragmentKey)
      } catch (err) {
        if (err instanceof Error && err.message === 'PASSPHRASE_REQUIRED') {
          // This paste needs a passphrase — but we should have known from metadata
          setState('passphrase-required')
          return
        }
        throw err
      }

      displayContent(plaintext, meta?.contentType ?? 'application/octet-stream')
    } catch (err) {
      if (err instanceof Error && err.message === 'WRONG_PASSPHRASE') {
        setError('Wrong passphrase. Try again.')
        setState('passphrase-required')
      } else {
        setState('decrypt-failed')
      }
    }
  }

  // Reveal with passphrase
  async function handleRevealWithPassphrase() {
    if (!fragmentKey || !passphrase) return

    setState('revealing')
    setError(null)

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
      const plaintext = await decryptContent(ciphertext, fragmentKey, passphrase)
      displayContent(plaintext, meta?.contentType ?? 'application/octet-stream')
    } catch (err) {
      if (err instanceof Error && err.message === 'WRONG_PASSPHRASE') {
        setError('Wrong passphrase. Try again.')
        setState('passphrase-required')
      } else {
        setState('decrypt-failed')
      }
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
        <Loader message="Checking link..." />
      </main>
    )
  }

  if (state === 'missing-key') {
    return (
      <CenteredCard icon="🔑" title="Missing decryption key">
        <p className="text-sm text-brand-muted">
          This link is missing the decryption key. Make sure you copied the full link
          including the part after the #.
        </p>
      </CenteredCard>
    )
  }

  if (state === 'invalid') {
    return (
      <CenteredCard icon="❓" title="Invalid link">
        <p className="text-sm text-brand-muted">This link is not valid.</p>
      </CenteredCard>
    )
  }

  if (state === 'burned') {
    return (
      <CenteredCard icon="🔥" title="Already destroyed">
        <p className="text-sm text-brand-muted">
          This message was already read and has been permanently destroyed.
        </p>
      </CenteredCard>
    )
  }

  if (state === 'expired') {
    return (
      <CenteredCard icon="⏰" title="Expired">
        <p className="text-sm text-brand-muted">
          This message has expired and is no longer available.
        </p>
      </CenteredCard>
    )
  }

  if (state === 'decrypt-failed') {
    return (
      <CenteredCard icon="🔓" title="Couldn't decrypt">
        <p className="text-sm text-brand-muted">
          The link may be incomplete or the message was corrupted.
        </p>
      </CenteredCard>
    )
  }

  if (state === 'revealing') {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader message="Revealing & decrypting..." />
      </main>
    )
  }

  // Landing: show metadata, wait for user to click Reveal
  if (state === 'landing' && meta) {
    const typeLabel = meta.contentType.startsWith('text/')
      ? 'Text message'
      : meta.contentType.startsWith('image/')
        ? 'Image'
        : 'File'
    const sizeLabel =
      meta.sizeBytes < 1024
        ? `${meta.sizeBytes} B`
        : meta.sizeBytes < 1024 * 1024
          ? `${(meta.sizeBytes / 1024).toFixed(1)} KB`
          : `${(meta.sizeBytes / (1024 * 1024)).toFixed(1)} MB`

    return (
      <CenteredCard icon="✉️" title="You have a secret message">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-brand-muted">Type</span>
            <span>{typeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted">Size</span>
            <span>{sizeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-brand-muted">Expires</span>
            <span>{new Date(meta.expiresAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-brand-danger/20 bg-brand-danger/5 p-3">
          <p className="text-xs text-brand-danger">
            ⚠️ This message will be permanently destroyed once revealed.
          </p>
        </div>

        {meta.hasPassword ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-brand-muted">
              This message requires a passphrase to reveal.
            </p>
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter passphrase"
              className="w-full rounded-lg border border-white/10 bg-brand-surface px-4 py-3 text-sm focus:border-brand-accent focus:outline-none"
            />
            {error && <p className="text-sm text-brand-danger">{error}</p>}
            <button
              onClick={handleRevealWithPassphrase}
              disabled={!passphrase}
              className="w-full rounded-lg bg-brand-danger px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
            >
              Reveal &amp; Destroy
            </button>
          </div>
        ) : (
          <button
            onClick={handleReveal}
            className="mt-6 w-full rounded-lg bg-brand-danger px-4 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            Reveal Message
          </button>
        )}
      </CenteredCard>
    )
  }

  // passphrase-required (shouldn't normally hit since landing handles it, but safety net)
  if (state === 'passphrase-required') {
    return (
      <CenteredCard icon="🔒" title="Passphrase required">
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Enter passphrase"
          className="w-full rounded-lg border border-white/10 bg-brand-surface px-4 py-3 text-sm focus:border-brand-accent focus:outline-none"
        />
        {error && <p className="mt-2 text-sm text-brand-danger">{error}</p>}
        <button
          onClick={handleRevealWithPassphrase}
          disabled={!passphrase}
          className="mt-4 w-full rounded-lg bg-brand-danger px-4 py-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          Reveal &amp; Destroy
        </button>
      </CenteredCard>
    )
  }

  // Content displayed
  if (state === 'content' && content) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center gap-2 text-sm text-brand-muted">
          <span>🔥</span>
          <span>This message has been permanently destroyed from the server.</span>
        </div>

        <div className="rounded-lg border border-white/10 bg-brand-surface p-6">
          {content.isImage && content.blobUrl ? (
            <img
              src={content.blobUrl}
              alt="Shared content"
              className="mx-auto max-h-[60vh] rounded"
            />
          ) : content.text !== undefined ? (
            <pre className="whitespace-pre-wrap break-words font-sans text-sm">
              {content.text}
            </pre>
          ) : content.blobUrl ? (
            <div className="text-center">
              <p className="mb-3 text-sm">{content.filename ?? 'Download file'}</p>
              <a
                href={content.blobUrl}
                download={content.filename}
                className="inline-block rounded-lg bg-brand-accent px-6 py-3 text-sm font-medium text-brand-dark hover:opacity-90"
              >
                Download
              </a>
            </div>
          ) : null}
        </div>
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
      </div>
    </main>
  )
}
