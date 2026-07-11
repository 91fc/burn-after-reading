import { NextRequest, NextResponse } from 'next/server'
import { getPasteMetadata, deletePaste } from '@/lib/blob-store'

export const runtime = 'nodejs'

/**
 * GET /api/data/[key] — metadata only.
 * Returns contentType, sizeBytes, mode, expiresAt, viewCount.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  const paste = await getPasteMetadata(key)

  if (!paste) {
    return NextResponse.json(
      { error: 'not_found', reason: 'invalid' },
      { status: 404 },
    )
  }

  // Check if expired
  if (paste.expiresAt < new Date()) {
    return NextResponse.json(
      { error: 'gone', reason: 'expired', expiresAt: paste.expiresAt.toISOString() },
      { status: 410 },
    )
  }

  return NextResponse.json({
    contentType: paste.contentType,
    sizeBytes: paste.sizeBytes,
    mode: paste.mode,
    expiresAt: paste.expiresAt.toISOString(),
    viewCount: paste.viewCount,
  })
}

/**
 * DELETE /api/data/[key] — permanently remove a paste.
 * Requires the correct deleteToken (passed via x-delete-token header).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  const deleteToken = request.headers.get('x-delete-token') ?? undefined

  const result = await deletePaste(key, { deleteToken })
  if (!result.ok) {
    return NextResponse.json({ error: 'not_found_or_unauthorized' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
