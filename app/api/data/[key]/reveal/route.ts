import { NextRequest, NextResponse } from 'next/server'
import { revealPaste } from '@/lib/memory-store'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * POST /api/data/[key]/reveal
 *
 * Dual-mode reveal:
 * - Burn mode: atomically removes the paste, returns encrypted content
 * - Persistent mode: records the view (IP + timestamp), returns content without removing
 *
 * Uses POST (not GET) to prevent browser prefetch/crawler burns.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params

  // Extract viewer IP
  const ip = getClientIP(request)

  const result = revealPaste(key, ip)

  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : 410
    return NextResponse.json(
      { error: 'gone', reason: result.reason },
      { status },
    )
  }

  const { content, contentType, mode } = result

  // Return the encrypted blob
  return new NextResponse(content, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': content.byteLength.toString(),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Paste-Mode': mode,
    },
  })
}

/**
 * Extract client IP from request, handling x-forwarded-for chains.
 * Takes the leftmost IP (closest to the client) when behind a trusted proxy.
 */
function getClientIP(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    // Leftmost IP in the chain is the original client
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp.trim()

  return 'unknown'
}
