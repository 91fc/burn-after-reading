import { NextRequest, NextResponse } from 'next/server'
import { getPasteMetadata, deletePaste } from '@/lib/db'
import { deleteBlob } from '@/lib/blob'

export const runtime = 'nodejs'

/**
 * GET /api/data/[key] — metadata only (does NOT burn).
 * Returns contentType, sizeBytes, hasPassword, expiresAt.
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

  // Check if expired (lazy deletion trigger)
  if (paste.expiresAt < new Date()) {
    return NextResponse.json(
      { error: 'gone', reason: 'expired', expiresAt: paste.expiresAt.toISOString() },
      { status: 410 },
    )
  }

  // Check if already revealed
  if (paste.viewedAt) {
    return NextResponse.json(
      { error: 'gone', reason: 'burned' },
      { status: 410 },
    )
  }

  return NextResponse.json({
    contentType: paste.contentType,
    sizeBytes: paste.sizeBytes,
    hasPassword: paste.hasPassword,
    expiresAt: paste.expiresAt.toISOString(),
  })
}

/**
 * DELETE /api/data/[key] — permanently remove a paste.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  const result = await deletePaste(key)
  if (!result) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  await deleteBlob(result.storageKey)
  return NextResponse.json({ ok: true })
}
