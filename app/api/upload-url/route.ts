import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'
import { bytesToBase64Url } from '@/lib/client/crypto'

export const runtime = 'nodejs'

/**
 * POST /api/upload-url
 * Returns a unique blob key for direct client-side upload of large files.
 * Client uses @vercel/blob client upload with the key, then registers via POST /api/data.
 */
export async function POST(_request: NextRequest) {
  const authed = await isAuthenticated()
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Generate a unique blob key
  const randomBytes = new Uint8Array(16)
  crypto.getRandomValues(randomBytes)
  const blobKey = `pastes/pending-${bytesToBase64Url(randomBytes)}`

  return NextResponse.json({ blobKey })
}
