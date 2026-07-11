import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { insertPaste } from '@/lib/db'
import { storeBlob, blobExists } from '@/lib/blob'
import { sha256Hash } from '@/lib/client/crypto'

const MAX_BODY_BYTES = 4.5 * 1024 * 1024 // 4.5MB Vercel serverless limit

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  // --- Auth check ---
  const authed = await isAuthenticated()
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''
  const expirationHeader = request.headers.get('x-paste-expiration')
  const expiresAt = expirationHeader
    ? new Date(expirationHeader)
    : new Date(Date.now() + 10 * 60 * 1000) // default 10 min

  // Clamp expiration to at least 10 minutes from now
  const minExpiry = new Date(Date.now() + 10 * 60 * 1000)
  if (expiresAt < minExpiry) {
    expiresAt.setTime(minExpiry.getTime())
  }

  // --- Two modes: small binary upload or large-file JSON registration ---

  if (contentType.includes('application/json')) {
    // Large-file mode: content already uploaded to Blob via /api/upload-url
    let body: { blobKey?: string; contentType?: string; sizeBytes?: number; hasPassword?: boolean }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (!body.blobKey || !body.contentType || body.sizeBytes == null) {
      return NextResponse.json(
        { error: 'Missing blobKey, contentType, or sizeBytes' },
        { status: 400 },
      )
    }

    // Verify the blob exists
    const exists = await blobExists(body.blobKey)
    if (!exists) {
      return NextResponse.json({ error: 'Blob not found' }, { status: 400 })
    }

    // We don't have the ciphertext to hash, so use the blobKey + timestamp for uniqueness
    const hash = await sha256Hash(
      new TextEncoder().encode(body.blobKey + Date.now() + Math.random()),
    )

    await insertPaste({
      hash,
      storageKey: body.blobKey,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      hasPassword: body.hasPassword ?? false,
      expiresAt,
    })

    return NextResponse.json({ hash })
  }

  // --- Small-file mode: binary body ---
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_BODY_BYTES || contentLength === 0) {
    return NextResponse.json(
      { error: contentLength === 0 ? 'Empty body' : 'Body too large, use upload-url endpoint' },
      { status: contentLength === 0 ? 400 : 413 },
    )
  }

  const hasPassword = request.headers.get('x-paste-password') === 'true'
  const pasteContentType = request.headers.get('x-paste-content-type') ?? 'application/octet-stream'
  const rawBody = await request.arrayBuffer()

  const hash = await sha256Hash(rawBody)

  // --- Dual-write: Blob FIRST, then DB (compensating delete on failure) ---
  let storageKey: string
  try {
    storageKey = await storeBlob(hash, rawBody)
  } catch {
    return NextResponse.json({ error: 'Failed to store content' }, { status: 500 })
  }

  try {
    await insertPaste({
      hash,
      storageKey,
      contentType: pasteContentType,
      sizeBytes: rawBody.byteLength,
      hasPassword,
      expiresAt,
    })
  } catch (err) {
    // Compensating delete: remove the orphaned blob
    const { deleteBlob } = await import('@/lib/blob')
    await deleteBlob(storageKey)
    console.error('DB insert failed, blob cleaned up:', err)
    return NextResponse.json({ error: 'Failed to register paste' }, { status: 500 })
  }

  return NextResponse.json({ hash })
}
