import { NextResponse } from 'next/server'
import { isAuthenticated } from '@/lib/auth'

export const runtime = 'nodejs'

export async function GET() {
  const authed = await isAuthenticated()
  return NextResponse.json({ authed })
}
