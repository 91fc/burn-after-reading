import { NextRequest, NextResponse } from 'next/server'
import { sweepExpired } from '@/lib/blob-store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/cleanup
 * Protected by CRON_SECRET. Sweeps expired pastes from Blob storage.
 * Inline expiration checks on read paths also clean up lazily.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const expected = `Bearer ${cronSecret}`
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const deleted = await sweepExpired()

  return NextResponse.json({
    ok: true,
    deleted,
  })
}
