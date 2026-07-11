'use client'

import { EXPIRATION_OPTIONS } from '@/lib/expiration'

export function ExpirationPicker({
  selected,
  onSelect,
}: {
  selected: number
  onSelect: (index: number) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {EXPIRATION_OPTIONS.map((opt, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onSelect(i)}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
            selected === i
              ? 'bg-brand-accent text-brand-dark'
              : 'border border-white/10 bg-brand-surface text-brand-muted hover:text-gray-200'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
