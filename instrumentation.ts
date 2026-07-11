/**
 * Next.js instrumentation hook — runs once on server startup.
 * Starts a periodic cleanup interval to sweep expired pastes from memory.
 *
 * The interval is guarded by globalThis to prevent duplicates during hot reloads.
 */

export async function register() {
  // Only run on server
  if (typeof window !== 'undefined') return

  // Prevent duplicate intervals during dev hot reloads
  if (globalThis.__cleanupInterval) return

  const { sweepExpired } = await import('./lib/memory-store')

  // Sweep every 5 minutes
  globalThis.__cleanupInterval = setInterval(() => {
    const deleted = sweepExpired()
    if (deleted > 0) {
      console.log(`[cleanup] Swept ${deleted} expired pastes from memory`)
    }
  }, 5 * 60 * 1000)
}

declare global {
  // eslint-disable-next-line no-var
  var __cleanupInterval: NodeJS.Timeout | undefined
}
