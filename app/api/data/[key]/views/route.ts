import { NextRequest, NextResponse } from 'next/server'
import { getViews } from '@/lib/blob-store'

export const runtime = 'nodejs'

/**
 * GET /api/data/[key]/views — public view log (IP + timestamp).
 * Anyone with the paste hash can see who viewed it.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params
  const views = await getViews(key)

  if (views === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({ views })
}
