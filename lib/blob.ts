import { put, del, head } from '@vercel/blob'
import {
  isLocalMode,
  localStoreBlob,
  localGetBlob,
  localDeleteBlob,
  localBlobExists,
} from './local-store'

/**
 * Store encrypted content in Vercel Blob (or local filesystem in local mode).
 * Returns the storage key (pathname) for later retrieval.
 */
export async function storeBlob(
  hash: string,
  data: ArrayBuffer,
): Promise<string> {
  if (isLocalMode()) {
    return localStoreBlob(hash, data)
  }
  const storageKey = `pastes/${hash}`
  await put(storageKey, data, {
    access: 'public', // content is encrypted — public access is safe without the fragment key
    addRandomSuffix: false,
    contentType: 'application/octet-stream',
  })
  return storageKey
}

/**
 * Retrieve encrypted content from Vercel Blob (or local filesystem).
 * Retries up to 3 times on failure.
 */
export async function getBlob(storageKey: string): Promise<ArrayBuffer> {
  if (isLocalMode()) {
    return localGetBlob(storageKey)
  }

  const MAX_RETRIES = 3
  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const blobInfo = await head(storageKey)
      if (!blobInfo) throw new Error('BLOB_NOT_FOUND')

      const response = await fetch(blobInfo.url)
      if (!response.ok) throw new Error(`BLOB_FETCH_${response.status}`)

      return await response.arrayBuffer()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)))
      }
    }
  }

  throw lastError ?? new Error('BLOB_FETCH_FAILED')
}

/**
 * Delete content from Vercel Blob (or local filesystem).
 */
export async function deleteBlob(storageKey: string): Promise<void> {
  if (isLocalMode()) {
    localDeleteBlob(storageKey)
    return
  }
  try {
    await del(storageKey)
  } catch {
    // Best-effort delete; cron will sweep orphans
  }
}

/**
 * Check if a blob exists at the given key.
 */
export async function blobExists(storageKey: string): Promise<boolean> {
  if (isLocalMode()) {
    return localBlobExists(storageKey)
  }
  try {
    const info = await head(storageKey)
    return info !== null
  } catch {
    return false
  }
}
