'use client'

export function Loader({ message }: { message?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-8">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-brand-accent border-t-transparent" />
      <span className="text-sm text-brand-muted">{message ?? 'Loading...'}</span>
    </div>
  )
}
