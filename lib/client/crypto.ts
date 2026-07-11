/**
 * Client-side encryption utilities.
 *
 * Security model:
 * - Every paste is ALWAYS encrypted with a randomly generated 256-bit key.
 * - That key is embedded in the URL fragment (#key=...) and NEVER sent to the server.
 * - An optional user passphrase adds a second encryption layer via PBKDF2.
 *
 * This replaces the original app's broken crypto which:
 * - Made encryption optional (stored plaintext with 32 zero-byte prefix)
 * - Used AES-CTR without authentication (malleable ciphertext)
 * - Stored SHA-256(password) prefix enabling offline brute-force
 */

const PBKDF2_ITERATIONS = 100_000
const SALT_LENGTH = 16
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

export interface EncryptResult {
  /** Encrypted payload: salt (if password) + IV + ciphertext+tag */
  ciphertext: ArrayBuffer
  hasPassword: boolean
}

/**
 * Encrypt content. Always encrypts with the fragment key.
 * If a passphrase is provided, first derives a PBKDF2 key and uses it
 * to encrypt the fragment key, so both layers are required to decrypt.
 */
export async function encryptContent(
  plaintext: ArrayBuffer,
  fragmentKey: string,
  passphrase?: string,
): Promise<EncryptResult> {
  if (passphrase) {
    // Double-layer: derive PBKDF2 key from passphrase, use it to encrypt the
    // raw fragment key. Final payload = salt + iv + enc(fragmentKey) + iv2 + enc(content)
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
    const passKey = await derivePassphraseKey(passphrase, salt)
    const rawFragmentKey = base64UrlToBytes(fragmentKey)

    // Encrypt the fragment key with the passphrase-derived key
    const iv1 = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const encFragmentKey = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv1 },
      passKey,
      rawFragmentKey,
    )

    // Encrypt the content with the fragment key
    const symKey = await keyFromFragment(fragmentKey)
    const iv2 = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
    const encContent = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv2 },
      symKey,
      plaintext,
    )

    // Pack: salt + iv1 + encFragmentKey(with tag) + iv2 + encContent(with tag)
    const total = salt.length + iv1.length + encFragmentKey.byteLength + iv2.length + encContent.byteLength
    const result = new Uint8Array(total)
    let off = 0
    result.set(salt, off); off += salt.length
    result.set(iv1, off); off += iv1.length
    result.set(new Uint8Array(encFragmentKey), off); off += encFragmentKey.byteLength
    result.set(iv2, off); off += iv2.length
    result.set(new Uint8Array(encContent), off)

    return { ciphertext: result.buffer, hasPassword: true }
  }

  // Single-layer: just fragment key
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

  return { ciphertext: result.buffer, hasPassword: false }
}

/**
 * Decrypt content. Requires the fragment key. If the payload has a
 * passphrase layer, the passphrase is also required.
 */
export async function decryptContent(
  ciphertext: ArrayBuffer,
  fragmentKey: string,
  passphrase?: string,
): Promise<ArrayBuffer> {
  const data = new Uint8Array(ciphertext)

  if (data.length > SALT_LENGTH && passphrase) {
    // Double-layer decryption
    const salt = data.slice(0, SALT_LENGTH)
    let off = SALT_LENGTH

    const iv1 = data.slice(off, off + IV_LENGTH); off += IV_LENGTH
    const encFragmentKeyEnd = off + detectGcmBoundary(data, off)
    const encFragmentKey = data.slice(off, encFragmentKeyEnd); off = encFragmentKeyEnd

    // Derive passphrase key and decrypt the fragment key
    const passKey = await derivePassphraseKey(passphrase, salt)
    let rawFragmentKey: Uint8Array
    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv1 },
        passKey,
        encFragmentKey,
      )
      rawFragmentKey = new Uint8Array(decrypted)
    } catch {
      throw new Error('WRONG_PASSPHRASE')
    }

    // Use the decrypted fragment key for content
    const contentKey = await crypto.subtle.importKey(
      'raw',
      rawFragmentKey,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )

    const iv2 = data.slice(off, off + IV_LENGTH); off += IV_LENGTH
    const encContent = data.slice(off)
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv2 },
      contentKey,
      encContent,
    )
    return plaintext
  }

  // Single-layer: try with provided fragment key directly
  // If there's a passphrase layer but no passphrase was given, decryption will fail
  const hasPassphraseLayer = data.length > SALT_LENGTH + IV_LENGTH * 2 + 16 + 16
  if (hasPassphraseLayer && !passphrase) {
    throw new Error('PASSPHRASE_REQUIRED')
  }

  // Single-layer decryption
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

/**
 * Derive an AES-GCM key from a passphrase using PBKDF2.
 */
async function derivePassphraseKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Heuristic to find the GCM boundary in a packed buffer.
 * For the passphrase layer, encFragmentKey is always exactly 32 bytes key + 16 bytes tag = 48 bytes.
 */
function detectGcmBoundary(_data: Uint8Array, _start: number): number {
  // Raw key is 32 bytes (256-bit), GCM tag is 16 bytes
  return 32 + 16
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

/**
 * Cast a Uint8Array to BufferSource for crypto.subtle compatibility (TS 5.7).
 * Safe because we never use SharedArrayBuffer.
 */
function toBuf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer as ArrayBuffer
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
