import { NextRequest, NextResponse } from 'next/server'
import { getExpiredPastes } from '@/lib/db'
import { deleteBlob } from '@/lib/blob'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * GET /api/cron/cleanup
 * Protected by CRON_SECRET. Runs every 5 minutes via vercel.json cron config.
 * Deletes expired and already-viewed pastes + their blobs.
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

  // Delete expired + viewed pastes from DB and return their storage keys
  const expired = await getExpiredPastes()

  // Delete each blob (best-effort, parallel)
  const deletions = expired.map((p) => deleteBlob(p.storageKey).catch(() => null))
  await Promise.allSettled(deletions)

  return NextResponse.json({
    ok: true,
    deleted: expired.length,
  })
}
