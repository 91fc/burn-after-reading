import { NextRequest, NextResponse } from 'next/server'
import { login } from '@/lib/auth'
import { ensureSchema } from '@/lib/db'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    // Ensure DB schema exists (idempotent, runs once per login session)
    await ensureSchema().catch(() => {})

    const body = await request.json()
    const password = body?.password

    if (typeof password !== 'string' || password.length === 0) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 })
    }

    const success = await login(password)
    if (!success) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
