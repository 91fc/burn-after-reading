/**
 * Vercel Blob storage — persistent across serverless invocations.
 *
 * Each paste is stored as two blobs:
 *   paste/{hash}/content  — raw encrypted bytes
 *   paste/{hash}/meta     — JSON metadata (contentType, mode, views, etc.)
 *
 * Sessions are stored as:
 *   session/{token}       — JSON session record
 *
 * No native TTL on Blob, so sweepExpired() reads meta blobs to find expired ones.
 * Called inline on reads + via cron + via instrumentation interval.
 */

import { put, head, get, del, list } from '@vercel/blob'

// --- Types ---

export type PasteMode = 'burn' | 'persistent'

interface ViewRecord {
  ip: string
  timestamp: string // ISO string for JSON round-trip
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

export type RevealResult =
  | { ok: true; content: Uint8Array; contentType: string; mode: PasteMode }
  | { ok: false; reason: 'burned' | 'expired' | 'not_found' }

interface StoredMeta {
  hash: string
  contentType: string
  sizeBytes: number
  mode: PasteMode
  expiresAt: string // ISO
  createdAt: string // ISO
  deleteToken: string
  views: ViewRecord[]
}

interface StoredSession {
  token: string
  username: string
  expiresAt: string // ISO
}

// --- Guards ---

export const MAX_PASTE_SIZE = 4.5 * 1024 * 1024 // 4.5MB
export const MAX_VIEWS_PER_PASTE = 100

// --- Path helpers ---

function contentPath(hash: string): string {
  return `paste/${hash}/content`
}

function metaPath(hash: string): string {
  return `paste/${hash}/meta`
}

function sessionPath(token: string): string {
  return `session/${token}`
}

// --- Generic helpers ---

function generateToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * head() throws BlobNotFoundError if the blob doesn't exist.
 * Wrap it to return null instead.
 */
async function tryHead(pathname: string) {
  try {
    return await head(pathname)
  } catch {
    return null
  }
}

/**
 * Fetch the body of a private blob as text, given its pathname.
 * get() requires the full blob URL (not pathname), so we head() first.
 * Returns null if the blob doesn't exist.
 */
async function fetchBlobText(pathname: string): Promise<string | null> {
  const info = await tryHead(pathname)
  if (!info) return null
  const result = await get(info.url, { access: 'private' })
  if (!result || result.statusCode !== 200 || !result.stream) return null
  const buf = await new Response(result.stream).arrayBuffer()
  return new TextDecoder().decode(buf)
}

/**
 * Fetch the body of a private blob as ArrayBuffer, given its pathname.
 * Returns null if the blob doesn't exist.
 */
async function fetchBlobBytes(pathname: string): Promise<ArrayBuffer | null> {
  const info = await tryHead(pathname)
  if (!info) return null
  const result = await get(info.url, { access: 'private' })
  if (!result || result.statusCode !== 200 || !result.stream) return null
  return new Response(result.stream).arrayBuffer()
}

/**
 * Delete content + meta blobs for a hash. Best-effort, never throws.
 */
async function deletePasteBlobs(hash: string): Promise<void> {
  try {
    await del([contentPath(hash), metaPath(hash)])
  } catch {
    // Already deleted or never existed — fine
  }
}

/**
 * Fetch + parse the meta blob for a hash. Returns null if missing or unparseable.
 */
async function fetchMeta(hash: string): Promise<StoredMeta | null> {
  const text = await fetchBlobText(metaPath(hash))
  if (text === null) return null
  try {
    return JSON.parse(text) as StoredMeta
  } catch {
    return null
  }
}

/**
 * Upload the meta blob.
 */
async function putMeta(meta: StoredMeta): Promise<void> {
  await put(metaPath(meta.hash), JSON.stringify(meta), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

// --- Paste operations ---

export async function createPaste(
  input: CreatePasteInput,
): Promise<CreatePasteResult | null> {
  const deleteToken = generateToken()

  const meta: StoredMeta = {
    hash: input.hash,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
    mode: input.mode,
    expiresAt: input.expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
    deleteToken,
    views: [],
  }

  // Upload content first, then meta. If content upload fails, nothing to clean up.
  await put(contentPath(input.hash), input.encryptedContent, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/octet-stream',
  })

  await putMeta(meta)

  return { hash: input.hash, deleteToken }
}

export async function getPasteMetadata(
  hash: string,
): Promise<PasteMetadata | null> {
  const meta = await fetchMeta(hash)
  if (!meta) return null

  const expiresAt = new Date(meta.expiresAt)
  if (expiresAt < new Date()) {
    await deletePasteBlobs(hash)
    return null
  }

  return {
    hash: meta.hash,
    contentType: meta.contentType,
    sizeBytes: meta.sizeBytes,
    mode: meta.mode,
    expiresAt,
    createdAt: new Date(meta.createdAt),
    viewCount: meta.views.length,
  }
}

export async function revealPaste(
  hash: string,
  ip: string,
): Promise<RevealResult> {
  const meta = await fetchMeta(hash)
  if (!meta) return { ok: false, reason: 'not_found' }

  const expiresAt = new Date(meta.expiresAt)
  if (expiresAt < new Date()) {
    await deletePasteBlobs(hash)
    return { ok: false, reason: 'expired' }
  }

  const contentBuf = await fetchBlobBytes(contentPath(hash))
  if (!contentBuf) return { ok: false, reason: 'not_found' }

  if (meta.mode === 'burn') {
    // Burn mode: delete blobs first (minimize race window), then return content.
    await deletePasteBlobs(hash)
    return {
      ok: true,
      content: new Uint8Array(contentBuf),
      contentType: meta.contentType,
      mode: 'burn',
    }
  }

  // Persistent mode: record view, re-upload meta, return content.
  meta.views.push({ ip, timestamp: new Date().toISOString() })
  if (meta.views.length > MAX_VIEWS_PER_PASTE) {
    meta.views = meta.views.slice(-MAX_VIEWS_PER_PASTE)
  }
  await putMeta(meta)

  return {
    ok: true,
    content: new Uint8Array(contentBuf),
    contentType: meta.contentType,
    mode: 'persistent',
  }
}

export async function deletePaste(
  hash: string,
  options: { deleteToken?: string },
): Promise<{ ok: boolean }> {
  const meta = await fetchMeta(hash)
  if (!meta) return { ok: false }

  // Token is optional: anyone with the hash (i.e. the link) can delete.
  // If a token IS provided, it must match.
  if (options.deleteToken !== undefined && options.deleteToken !== meta.deleteToken) {
    return { ok: false }
  }

  await deletePasteBlobs(hash)
  return { ok: true }
}

export async function getViews(
  hash: string,
): Promise<ViewRecord[] | null> {
  const meta = await fetchMeta(hash)
  if (!meta) return null

  const expiresAt = new Date(meta.expiresAt)
  if (expiresAt < new Date()) {
    await deletePasteBlobs(hash)
    return null
  }

  return [...meta.views]
}

// --- Sweep expired pastes ---

export async function sweepExpired(): Promise<number> {
  let deleted = 0
  let cursor: string | undefined
  const now = new Date()

  do {
    const result = await list({
      prefix: 'paste/',
      cursor,
      limit: 1000,
    })

    // Only look at /meta blobs — they contain expiration info
    const metaBlobs = result.blobs.filter((b) =>
      b.pathname.endsWith('/meta'),
    )

    for (const blob of metaBlobs) {
      try {
        // Private blobs: use get() with the blob URL, not fetch(downloadUrl)
        const result = await get(blob.url, { access: 'private' })
        if (!result || result.statusCode !== 200 || !result.stream) continue
        const buf = await new Response(result.stream).arrayBuffer()
        const meta = JSON.parse(new TextDecoder().decode(buf)) as StoredMeta
        const expiresAt = new Date(meta.expiresAt)
        if (expiresAt < now) {
          await deletePasteBlobs(meta.hash)
          deleted++
        }
      } catch {
        // Skip unparseable meta — don't let one bad blob break sweep
      }
    }

    cursor = result.cursor
  } while (cursor)

  return deleted
}

// --- Session operations ---

export async function createSession(
  token: string,
  username: string,
  expiresAt: Date,
): Promise<void> {
  const session: StoredSession = {
    token,
    username,
    expiresAt: expiresAt.toISOString(),
  }
  await put(sessionPath(token), JSON.stringify(session), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  })
}

export async function getSession(
  token: string,
): Promise<{ username: string; expiresAt: Date } | null> {
  const text = await fetchBlobText(sessionPath(token))
  if (text === null) return null
  try {
    const session = JSON.parse(text) as StoredSession
    const expiresAt = new Date(session.expiresAt)
    if (expiresAt < new Date()) {
      try {
        await del(sessionPath(token))
      } catch {
        // ignore
      }
      return null
    }
    return { username: session.username, expiresAt }
  } catch {
    return null
  }
}

export async function deleteSession(token: string): Promise<void> {
  try {
    await del(sessionPath(token))
  } catch {
    // ignore
  }
}
