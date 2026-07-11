/**
 * In-memory storage — Map-based, no database, no filesystem.
 * Data is ephemeral: lost on process restart. This is accepted by design.
 *
 * Uses globalThis to survive hot reloads in dev.
 */

// --- Types ---

export type PasteMode = 'burn' | 'persistent'

interface ViewRecord {
  ip: string
  timestamp: Date
}

export interface PasteRecord {
  hash: string
  encryptedContent: Uint8Array
  contentType: string
  sizeBytes: number
  mode: PasteMode
  expiresAt: Date
  createdAt: Date
  views: ViewRecord[]
  deleteToken: string
}

interface SessionRecord {
  token: string
  username: string
  expiresAt: Date
}

// --- Guards ---

export const MAX_STORE_SIZE_BYTES = 256 * 1024 * 1024 // 256MB
export const MAX_PASTES = 1000
export const MAX_VIEWS_PER_PASTE = 100
export const MAX_PASTE_SIZE = 4.5 * 1024 * 1024 // 4.5MB

// --- Global store (survives hot reloads) ---

declare global {
  // eslint-disable-next-line no-var
  var __pasteStore: Map<string, PasteRecord> | undefined
  // eslint-disable-next-line no-var
  var __sessionStore: Map<string, SessionRecord> | undefined
}

function getPasteStore(): Map<string, PasteRecord> {
  if (!globalThis.__pasteStore) {
    globalThis.__pasteStore = new Map()
  }
  return globalThis.__pasteStore
}

function getSessionStore(): Map<string, SessionRecord> {
  if (!globalThis.__sessionStore) {
    globalThis.__sessionStore = new Map()
  }
  return globalThis.__sessionStore
}

// --- Paste operations ---

export interface CreatePasteInput {
  hash: string
  encryptedContent: Uint8Array
  contentType: string
  sizeBytes: number
  mode: PasteMode
  expiresAt: Date
}

export interface CreatePasteResult {
  hash: string
  deleteToken: string
}

/**
 * Create a paste. Returns deleteToken for creator deletion.
 * Returns null if the store is full (memory bounds exceeded).
 */
export function createPaste(input: CreatePasteInput): CreatePasteResult | null {
  const store = getPasteStore()

  // Sweep expired first to free space
  sweepExpired()

  // Check paste count
  if (store.size >= MAX_PASTES) {
    return null
  }

  // Check total memory
  const totalBytes = getTotalMemoryUsage()
  if (totalBytes + input.sizeBytes > MAX_STORE_SIZE_BYTES) {
    return null
  }

  const deleteToken = generateToken()

  store.set(input.hash, {
    hash: input.hash,
    encryptedContent: input.encryptedContent,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    mode: input.mode,
    expiresAt: input.expiresAt,
    createdAt: new Date(),
    views: [],
    deleteToken,
  })

  return { hash: input.hash, deleteToken }
}

export interface PasteMetadata {
  hash: string
  contentType: string
  sizeBytes: number
  mode: PasteMode
  expiresAt: Date
  createdAt: Date
  viewCount: number
}

export function getPasteMetadata(hash: string): PasteMetadata | null {
  const store = getPasteStore()
  const paste = store.get(hash)
  if (!paste) return null

  // Inline expiration check
  if (paste.expiresAt < new Date()) {
    store.delete(hash)
    return null
  }

  return {
    hash: paste.hash,
    contentType: paste.contentType,
    sizeBytes: paste.sizeBytes,
    mode: paste.mode,
    expiresAt: paste.expiresAt,
    createdAt: paste.createdAt,
    viewCount: paste.views.length,
  }
}

export type RevealResult =
  | { ok: true; content: Uint8Array; contentType: string; mode: PasteMode }
  | { ok: false; reason: 'burned' | 'expired' | 'not_found' }

/**
 * Reveal a paste. For burn mode, atomically removes the paste.
 * For persistent mode, records the view and returns content.
 *
 * IMPORTANT: This function is synchronous. No awaits between check and mutation.
 * In Node.js single-threaded event loop, this is effectively atomic.
 */
export function revealPaste(hash: string, ip: string): RevealResult {
  const store = getPasteStore()
  const paste = store.get(hash)

  if (!paste) return { ok: false, reason: 'not_found' }

  // Inline expiration check
  if (paste.expiresAt < new Date()) {
    store.delete(hash)
    return { ok: false, reason: 'expired' }
  }

  if (paste.mode === 'burn') {
    // Burn mode: remove from store immediately (atomic), then return content.
    // The content is already in memory, no async fetch that could fail.
    store.delete(hash)

    // We still record the view for the admin log (but the paste is gone).
    // For burn mode, the view log is lost with the paste. That's fine —
    // burn mode doesn't need persistent tracking.
    return {
      ok: true,
      content: paste.encryptedContent,
      contentType: paste.contentType,
      mode: 'burn',
    }
  }

  // Persistent mode: record view, return content without removing
  recordView(paste, ip)

  // Return a copy to prevent ArrayBuffer detachment issues
  return {
    ok: true,
    content: paste.encryptedContent.slice(),
    contentType: paste.contentType,
    mode: 'persistent',
  }
}

/**
 * Delete a paste. Requires the correct deleteToken.
 */
export function deletePaste(
  hash: string,
  options: { deleteToken?: string },
): { ok: boolean } {
  const store = getPasteStore()
  const paste = store.get(hash)

  if (!paste) return { ok: false }

  if (options.deleteToken !== paste.deleteToken) {
    return { ok: false }
  }

  store.delete(hash)
  return { ok: true }
}

/**
 * Get view log for admin. Returns all views (IP + timestamp).
 */
export function getViews(hash: string): ViewRecord[] | null {
  const store = getPasteStore()
  const paste = store.get(hash)
  if (!paste) return null

  // Inline expiration check
  if (paste.expiresAt < new Date()) {
    store.delete(hash)
    return null
  }

  return [...paste.views]
}

/**
 * Get expired paste hashes (for cron cleanup).
 */
export function getExpiredPastes(): string[] {
  const store = getPasteStore()
  const now = new Date()
  const expired: string[] = []

  for (const [hash, paste] of store) {
    if (paste.expiresAt < now) {
      expired.push(hash)
    }
  }

  return expired
}

/**
 * Sweep all expired pastes. Called inline on every create to prevent unbounded growth.
 * Also callable from cron/instrumentation.
 */
export function sweepExpired(): number {
  const store = getPasteStore()
  const now = new Date()
  let count = 0

  for (const [hash, paste] of store) {
    if (paste.expiresAt < now) {
      store.delete(hash)
      count++
    }
  }

  return count
}

/**
 * Get total memory usage of the paste store (approximate).
 */
export function getTotalMemoryUsage(): number {
  const store = getPasteStore()
  let total = 0
  for (const paste of store.values()) {
    total += paste.sizeBytes
  }
  return total
}

// --- Internal helpers ---

function recordView(paste: PasteRecord, ip: string): void {
  paste.views.push({ ip, timestamp: new Date() })

  // Cap views array
  if (paste.views.length > MAX_VIEWS_PER_PASTE) {
    paste.views = paste.views.slice(-MAX_VIEWS_PER_PASTE)
  }
}

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// --- Session operations (replaces db.ts session functions) ---

export function createSession(token: string, username: string, expiresAt: Date): void {
  const store = getSessionStore()
  store.set(token, { token, username, expiresAt })
}

export function getSession(
  token: string,
): { username: string; expiresAt: Date } | null {
  const store = getSessionStore()
  const session = store.get(token)
  if (!session) return null
  if (session.expiresAt < new Date()) {
    store.delete(token)
    return null
  }
  return { username: session.username, expiresAt: session.expiresAt }
}

export function deleteSession(token: string): void {
  const store = getSessionStore()
  store.delete(token)
}
