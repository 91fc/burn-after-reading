import { sql } from '@vercel/postgres'
import {
  isLocalMode,
  localCreateSession,
  localGetSession,
  localDeleteSession,
  localInsertPaste,
  localGetPasteMetadata,
  localCommitBurn,
  localDeletePaste,
  localGetExpiredPastes,
  localUnburn,
} from './local-store'

export interface PasteMetadata {
  hash: string
  storageKey: string
  contentType: string
  sizeBytes: number
  hasPassword: boolean
  expiresAt: Date
  createdAt: Date
  viewedAt: Date | null
}

/**
 * Schema initialization. Run this once on first deploy.
 * Uses IF NOT EXISTS so it's safe to call multiple times.
 * In local mode, the JSON file is created on first write — no-op here.
 */
export async function ensureSchema(): Promise<void> {
  if (isLocalMode()) return
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS pastes (
      hash TEXT PRIMARY KEY,
      storage_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      has_password BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      viewed_at TIMESTAMPTZ
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS idx_pastes_expires ON pastes(expires_at)`
  await sql`CREATE INDEX IF NOT EXISTS idx_pastes_viewed ON pastes(viewed_at)`
}

// --- Session operations ---

export async function createSession(token: string, username: string, expiresAt: Date): Promise<void> {
  if (isLocalMode()) {
    localCreateSession(token, username, expiresAt)
    return
  }
  await sql`
    INSERT INTO sessions (token, username, expires_at)
    VALUES (${token}, ${username}, ${expiresAt.toISOString()})
  `
}

export async function getSession(token: string): Promise<{ username: string; expiresAt: Date } | null> {
  if (isLocalMode()) {
    return localGetSession(token)
  }
  const result = await sql`
    SELECT username, expires_at FROM sessions
    WHERE token = ${token} AND expires_at > NOW()
  `
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return { username: row.username as string, expiresAt: new Date(row.expires_at as string) }
}

export async function deleteSession(token: string): Promise<void> {
  if (isLocalMode()) {
    localDeleteSession(token)
    return
  }
  await sql`DELETE FROM sessions WHERE token = ${token}`
}

// --- Paste operations ---

export async function insertPaste(paste: {
  hash: string
  storageKey: string
  contentType: string
  sizeBytes: number
  hasPassword: boolean
  expiresAt: Date
}): Promise<void> {
  if (isLocalMode()) {
    localInsertPaste(paste)
    return
  }
  await sql`
    INSERT INTO pastes (hash, storage_key, content_type, size_bytes, has_password, expires_at)
    VALUES (${paste.hash}, ${paste.storageKey}, ${paste.contentType}, ${paste.sizeBytes}, ${paste.hasPassword}, ${paste.expiresAt.toISOString()})
  `
}

export async function getPasteMetadata(hash: string): Promise<PasteMetadata | null> {
  if (isLocalMode()) {
    return localGetPasteMetadata(hash)
  }
  const result = await sql`
    SELECT hash, storage_key, content_type, size_bytes, has_password, expires_at, created_at, viewed_at
    FROM pastes WHERE hash = ${hash}
  `
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  return {
    hash: row.hash as string,
    storageKey: row.storage_key as string,
    contentType: row.content_type as string,
    sizeBytes: row.size_bytes as number,
    hasPassword: row.has_password as boolean,
    expiresAt: new Date(row.expires_at as string),
    createdAt: new Date(row.created_at as string),
    viewedAt: row.viewed_at ? new Date(row.viewed_at as string) : null,
  }
}

/**
 * Atomic burn-after-read claim using UPDATE...RETURNING.
 * Burns immediately (sets viewed_at). If the caller's Blob fetch fails,
 * call abortClaim(hash) to restore the paste (set viewed_at back to NULL).
 *
 * This is truly atomic: the burn and the claim are one operation.
 * Concurrent requests get either the content (one winner) or 410 (the rest).
 *
 * Returns the storage_key if the claim succeeded, or an object describing
 * why it failed (burned/expired/not_found).
 */
export async function claimPaste(
  hash: string,
): Promise<
  | { ok: true; storageKey: string; contentType: string }
  | { ok: false; reason: 'burned' | 'expired' | 'not_found' }
> {
  if (isLocalMode()) {
    const meta = localGetPasteMetadata(hash)
    if (!meta) return { ok: false, reason: 'not_found' }
    if (meta.viewedAt) return { ok: false, reason: 'burned' }
    if (meta.expiresAt < new Date()) return { ok: false, reason: 'expired' }
    localCommitBurn(hash)
    return { ok: true, storageKey: meta.storageKey, contentType: meta.contentType }
  }

  const result = await sql`
    UPDATE pastes
    SET viewed_at = NOW()
    WHERE hash = ${hash}
      AND viewed_at IS NULL
      AND expires_at > NOW()
    RETURNING storage_key, content_type
  `

  if (result.rows.length === 0) {
    const existing = await sql`
      SELECT viewed_at, expires_at FROM pastes WHERE hash = ${hash}
    `
    if (existing.rows.length === 0) return { ok: false, reason: 'not_found' }
    const row = existing.rows[0]
    if (row.viewed_at) return { ok: false, reason: 'burned' }
    return { ok: false, reason: 'expired' }
  }

  return {
    ok: true,
    storageKey: result.rows[0].storage_key as string,
    contentType: result.rows[0].content_type as string,
  }
}

/**
 * Commit the burn: set viewed_at to NOW().
 */
export async function commitBurn(hash: string): Promise<void> {
  if (isLocalMode()) {
    localCommitBurn(hash)
    return
  }
  await sql`
    UPDATE pastes SET viewed_at = NOW() WHERE hash = ${hash} AND viewed_at IS NULL
  `
}

/**
 * Roll back a claim (release the row lock without burning).
 * In local mode, restores viewed_at to null.
 */
export async function abortClaim(hash: string): Promise<void> {
  if (isLocalMode()) {
    localUnburn(hash)
    return
  }
  // In @vercel/postgres, each sql call is its own connection from the pool.
  // FOR UPDATE locks are held for the duration of that single call's implicit
  // transaction. So the lock from claimPaste() already released.
}

export async function deletePaste(hash: string): Promise<{ storageKey: string } | null> {
  if (isLocalMode()) {
    return localDeletePaste(hash)
  }
  const result = await sql`
    DELETE FROM pastes WHERE hash = ${hash}
    RETURNING storage_key
  `
  if (result.rows.length === 0) return null
  return { storageKey: result.rows[0].storage_key as string }
}

/**
 * Get all expired pastes (for cron cleanup).
 */
export async function getExpiredPastes(): Promise<{ hash: string; storageKey: string }[]> {
  if (isLocalMode()) {
    return localGetExpiredPastes()
  }
  const result = await sql`
    DELETE FROM pastes
    WHERE expires_at < NOW() OR viewed_at IS NOT NULL
    RETURNING hash, storage_key
  `
  return result.rows.map((row) => ({
    hash: row.hash as string,
    storageKey: row.storage_key as string,
  }))
}
