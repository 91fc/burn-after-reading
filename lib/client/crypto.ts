/**
 * Client-side encryption utilities.
 *
 * Security model:
 * - Every paste is encrypted with a randomly generated 256-bit key.
 * - That key is embedded in the URL fragment (#key=...) and NEVER sent to the server.
 * - No passphrase layer (removed by design decision — user accepted URL-leak risk).
 */

const IV_LENGTH = 12 // AES-GCM standard
const KEY_LENGTH = 256

/**
 * Generate a random symmetric key and return its base64url representation
 * for embedding in a URL fragment.
 */
export async function generateFragmentKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: KEY_LENGTH },
    true,
    ['encrypt', 'decrypt'],
  )
  const raw = await crypto.subtle.exportKey('raw', key)
  return bytesToBase64Url(new Uint8Array(raw))
}

/**
 * Reconstruct an AES-GCM CryptoKey from a base64url fragment key.
 */
export async function keyFromFragment(fragmentKey: string): Promise<CryptoKey> {
  const raw = base64UrlToBytes(fragmentKey)
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ])
}

/**
 * Encrypt content with the fragment key (single-layer AES-GCM).
 */
export async function encryptContent(
  plaintext: ArrayBuffer,
  fragmentKey: string,
): Promise<ArrayBuffer> {
  const symKey = await keyFromFragment(fragmentKey)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    symKey,
    plaintext,
  )

  // Pack: iv + ciphertext+tag
  const result = new Uint8Array(IV_LENGTH + encrypted.byteLength)
  result.set(iv, 0)
  result.set(new Uint8Array(encrypted), IV_LENGTH)

  return result.buffer
}

/**
 * Decrypt content with the fragment key (single-layer AES-GCM).
 */
export async function decryptContent(
  ciphertext: ArrayBuffer,
  fragmentKey: string,
): Promise<ArrayBuffer> {
  const data = new Uint8Array(ciphertext)

  const iv = data.slice(0, IV_LENGTH)
  const encContent = data.slice(IV_LENGTH)
  const symKey = await keyFromFragment(fragmentKey)
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      symKey,
      encContent,
    )
    return plaintext
  } catch {
    throw new Error('DECRYPT_FAILED')
  }
}

// --- Base64URL helpers ---

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)
  const binary = atob(padded)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

// --- Server-side SHA-256 for hashing content (used in API routes) ---

export async function sha256Hash(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = data instanceof Uint8Array ? data : new Uint8Array(data)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return bytesToBase64Url(new Uint8Array(hash))
}

// --- File content helpers ---

/**
 * Add a filename prefix to content so the recipient knows the original filename.
 * Format: 2-byte filename length + filename bytes + content bytes.
 */
export function addPrefix(content: ArrayBuffer, filename: string): ArrayBuffer {
  const enc = new TextEncoder()
  const nameBytes = enc.encode(filename)
  if (nameBytes.length > 65535) throw new Error('FILENAME_TOO_LONG')
  const result = new Uint8Array(2 + nameBytes.length + content.byteLength)
  result[0] = nameBytes.length & 0xff
  result[1] = (nameBytes.length >> 8) & 0xff
  result.set(nameBytes, 2)
  result.set(new Uint8Array(content), 2 + nameBytes.length)
  return result.buffer
}

export function extractPrefix(buffer: ArrayBuffer): { filename: string; content: ArrayBuffer } {
  const data = new Uint8Array(buffer)
  if (data.length < 2) return { filename: '', content: buffer }
  const nameLen = data[0] | (data[1] << 8)
  if (2 + nameLen > data.length) return { filename: '', content: buffer }
  const nameBytes = data.slice(2, 2 + nameLen)
  const content = data.slice(2 + nameLen)
  return {
    filename: new TextDecoder().decode(nameBytes),
    content: content.buffer,
  }
}

/**
 * Extract the fragment key from the current URL hash.
 * Returns null if no key is present.
 */
export function getFragmentKeyFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash) return null
  const match = hash.match(/[#&]key=([^&]+)/)
  if (!match) return null
  return decodeURIComponent(match[1])
}

/**
 * Strip the key from the URL fragment to prevent it from lingering in history.
 * Call this AFTER extracting the key.
 */
export function stripKeyFromUrl(): void {
  if (typeof window === 'undefined') return
  const cleaned = window.location.pathname + window.location.search
  window.history.replaceState(null, '', cleaned)
}
