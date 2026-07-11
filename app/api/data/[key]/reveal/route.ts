import { NextRequest, NextResponse } from 'next/server'
import { getBlob, deleteBlob } from '@/lib/blob'
import { claimPaste, abortClaim } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/data/[key]/reveal
 *
 * Atomic burn-after-read:
 * 1. claimPaste — atomically burns (sets viewed_at) and returns storage_key,
 *    or returns the reason (burned/expired/not_found)
 * 2. Fetch blob (retry 3x)
 * 3. On success: return encrypted content (paste is already burned)
 * 4. On failure: abortClaim restores the paste (viewed_at = NULL), return 503
 *
 * Uses POST (not GET) to prevent browser prefetch/crawler burns.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params

  const claim = await claimPaste(key)

  if (!claim.ok) {
    const status = claim.reason === 'not_found' ? 404 : 410
    return NextResponse.json(
      { error: 'gone', reason: claim.reason },
      { status },
    )
  }

  const { storageKey, contentType } = claim

  // Fetch the blob with retries
  let blobData: ArrayBuffer
  try {
    blobData = await getBlob(storageKey)
  } catch (err) {
    // RESTORE the paste — the burn was premature
    await abortClaim(key)
    console.error('Blob fetch failed, paste restored:', err)
    return NextResponse.json(
      { error: 'Content temporarily unavailable. Try again.' },
      { status: 503 },
    )
  }

  // Content is now permanently burned (viewed_at is set).
  // Schedule async blob deletion (don't block the response).
  // The cron job will sweep them if this fails.
  deleteBlob(storageKey).catch(() => {})

  // Return the encrypted blob
  return new NextResponse(blobData, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': blobData.byteLength.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
