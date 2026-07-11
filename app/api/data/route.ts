import { NextRequest, NextResponse } from 'next/server'
import { createPaste, MAX_PASTE_SIZE } from '@/lib/memory-store'
import { sha256Hash } from '@/lib/client/crypto'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  const expirationHeader = request.headers.get('x-paste-expiration')
  const mode = (request.headers.get('x-paste-mode') as 'burn' | 'persistent') || 'burn'

  const expiresAt = expirationHeader
    ? new Date(expirationHeader)
    : new Date(Date.now() + 10 * 60 * 1000)

  // Clamp expiration to at least 10 minutes from now
  const minExpiry = new Date(Date.now() + 10 * 60 * 1000)
  if (expiresAt < minExpiry) {
    expiresAt.setTime(minExpiry.getTime())
  }

  // --- Only binary body mode (large-file Blob upload removed) ---
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10)
  if (contentLength > MAX_PASTE_SIZE || contentLength === 0) {
    return NextResponse.json(
      { error: contentLength === 0 ? 'Empty body' : 'Body too large (max 4.5MB)' },
      { status: contentLength === 0 ? 400 : 413 },
    )
  }

  const pasteContentType = request.headers.get('x-paste-content-type') ?? 'application/octet-stream'
  const rawBody = new Uint8Array(await request.arrayBuffer())

  const hash = await sha256Hash(rawBody)

  const result = createPaste({
    hash,
    encryptedContent: rawBody,
    contentType: pasteContentType,
    sizeBytes: rawBody.byteLength,
    mode,
    expiresAt,
  })

  if (!result) {
    return NextResponse.json(
      { error: '服务器容量已满，请稍后再试' },
      { status: 503 },
    )
  }

  return NextResponse.json(result)
}
