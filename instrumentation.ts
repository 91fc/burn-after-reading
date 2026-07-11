/**
 * Next.js instrumentation hook — runs once on server startup.
 * Starts a periodic cleanup interval to sweep expired pastes from Blob storage.
 *
 * The interval is guarded by globalThis to prevent duplicates during hot reloads.
 * Note: On Vercel serverless this only runs within a warm instance's lifetime.
 * The authoritative sweep is the daily cron in vercel.json.
 */

export async function register() {
  // Only run on server
  if (typeof window !== 'undefined') return

  // Prevent duplicate intervals during dev hot reloads
  if (globalThis.__cleanupInterval) return

  const { sweepExpired } = await import('./lib/blob-store')

  // Sweep every 5 minutes (best-effort; cron is the authoritative sweep)
  globalThis.__cleanupInterval = setInterval(() => {
    sweepExpired()
      .then((deleted) => {
        if (deleted > 0) {
          console.log(`[cleanup] Swept ${deleted} expired pastes from Blob`)
        }
      })
      .catch((err) => {
        console.error('[cleanup] Sweep failed:', err)
      })
  }, 5 * 60 * 1000)
}

declare global {
  // eslint-disable-next-line no-var
  var __cleanupInterval: NodeJS.Timeout | undefined
}
