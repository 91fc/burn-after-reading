/**
 * Local development storage — filesystem + JSON-based.
 * Used automatically when POSTGRES_URL is not set.
 * No external dependencies required.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

const DATA_DIR = join(process.cwd(), '.local-data')
const BLOB_DIR = join(DATA_DIR, 'blobs')
const DB_FILE = join(DATA_DIR, 'db.json')

interface LocalDB {
  sessions: Array<{ token: string; username: string; expires_at: string }>
  pastes: Array<{
    hash: string
    storage_key: string
    content_type: string
    size_bytes: number
    has_password: boolean
    expires_at: string
    created_at: string
    viewed_at: string | null
  }>
}

function loadDB(): LocalDB {
  if (!existsSync(DB_FILE)) {
    return { sessions: [], pastes: [] }
  }
  try {
    return JSON.parse(readFileSync(DB_FILE, 'utf-8'))
  } catch {
    return { sessions: [], pastes: [] }
  }
}

function saveDB(db: LocalDB): void {
  mkdirSync(DATA_DIR, { recursive: true })
  mkdirSync(BLOB_DIR, { recursive: true })
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
}

// --- Session operations ---

export function localCreateSession(token: string, username: string, expiresAt: Date): void {
  const db = loadDB()
  db.sessions.push({ token, username, expires_at: expiresAt.toISOString() })
  saveDB(db)
}

export function localGetSession(token: string): { username: string; expiresAt: Date } | null {
  const db = loadDB()
  const session = db.sessions.find(
    (s) => s.token === token && new Date(s.expires_at) > new Date(),
  )
  if (!session) return null
  return { username: session.username, expiresAt: new Date(session.expires_at) }
}

export function localDeleteSession(token: string): void {
  const db = loadDB()
  db.sessions = db.sessions.filter((s) => s.token !== token)
  saveDB(db)
}

// --- Paste operations ---

export function localInsertPaste(paste: {
  hash: string
  storageKey: string
  contentType: string
  sizeBytes: number
  hasPassword: boolean
  expiresAt: Date
}): void {
  const db = loadDB()
  db.pastes.push({
    hash: paste.hash,
    storage_key: paste.storageKey,
    content_type: paste.contentType,
    size_bytes: paste.sizeBytes,
    has_password: paste.hasPassword,
    expires_at: paste.expiresAt.toISOString(),
    created_at: new Date().toISOString(),
    viewed_at: null,
  })
  saveDB(db)
}

export function localGetPasteMetadata(hash: string) {
  const db = loadDB()
  const paste = db.pastes.find((p) => p.hash === hash)
  if (!paste) return null
  return {
    hash: paste.hash,
    storageKey: paste.storage_key,
    contentType: paste.content_type,
    sizeBytes: paste.size_bytes,
    hasPassword: paste.has_password,
    expiresAt: new Date(paste.expires_at),
    createdAt: new Date(paste.created_at),
    viewedAt: paste.viewed_at ? new Date(paste.viewed_at) : null,
  }
}

/**
 * Atomic claim for local mode. Since file operations are synchronous
 * in Node.js single-threaded event loop, this is effectively atomic.
 */
export function localClaimPaste(
  hash: string,
): { ok: true; storageKey: string } | { ok: false; reason: 'burned' | 'expired' | 'not_found' } {
  const db = loadDB()
  const paste = db.pastes.find((p) => p.hash === hash)
  if (!paste) return { ok: false, reason: 'not_found' }
  if (paste.viewed_at) return { ok: false, reason: 'burned' }
  if (new Date(paste.expires_at) < new Date()) return { ok: false, reason: 'expired' }
  return { ok: true, storageKey: paste.storage_key }
}

export function localCommitBurn(hash: string): void {
  const db = loadDB()
  const paste = db.pastes.find((p) => p.hash === hash)
  if (paste && !paste.viewed_at) {
    paste.viewed_at = new Date().toISOString()
    saveDB(db)
  }
}

export function localUnburn(hash: string): void {
  const db = loadDB()
  const paste = db.pastes.find((p) => p.hash === hash)
  if (paste) {
    paste.viewed_at = null
    saveDB(db)
  }
}

export function localDeletePaste(hash: string): { storageKey: string } | null {
  const db = loadDB()
  const idx = db.pastes.findIndex((p) => p.hash === hash)
  if (idx === -1) return null
  const storageKey = db.pastes[idx].storage_key
  db.pastes.splice(idx, 1)
  saveDB(db)
  return { storageKey }
}

export function localGetExpiredPastes(): { hash: string; storageKey: string }[] {
  const db = loadDB()
  const now = new Date()
  const expired = db.pastes.filter(
    (p) => new Date(p.expires_at) < now || p.viewed_at !== null,
  )
  const result = expired.map((p) => ({ hash: p.hash, storageKey: p.storage_key }))
  db.pastes = db.pastes.filter(
    (p) => new Date(p.expires_at) >= now && p.viewed_at === null,
  )
  saveDB(db)
  return result
}

// --- Blob operations ---

export function localStoreBlob(hash: string, data: ArrayBuffer): string {
  mkdirSync(BLOB_DIR, { recursive: true })
  const storageKey = `pastes/${hash}`
  const filePath = join(BLOB_DIR, hash)
  writeFileSync(filePath, Buffer.from(data))
  return storageKey
}

export async function localGetBlob(storageKey: string): Promise<ArrayBuffer> {
  const hash = storageKey.replace('pastes/', '').replace('pending-', '')
  const filePath = join(BLOB_DIR, hash)
  if (!existsSync(filePath)) throw new Error('BLOB_NOT_FOUND')
  const buffer = readFileSync(filePath)
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
}

export function localDeleteBlob(storageKey: string): void {
  const hash = storageKey.replace('pastes/', '').replace('pending-', '')
  const filePath = join(BLOB_DIR, hash)
  try {
    if (existsSync(filePath)) {
      const { unlinkSync } = require('fs')
      unlinkSync(filePath)
    }
  } catch {
    // best-effort
  }
}

export function localBlobExists(storageKey: string): boolean {
  const hash = storageKey.replace('pastes/', '').replace('pending-', '')
  const filePath = join(BLOB_DIR, hash)
  return existsSync(filePath)
}

// --- Check ---

export function isLocalMode(): boolean {
  return !process.env.POSTGRES_URL
}
