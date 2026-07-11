'use client'

interface ExpirationOption {
  label: string
  count: number
  unit: 'minutes' | 'hours' | 'days' | 'weeks'
}

export function ExpirationPicker({
  selected,
  onSelect,
  options,
}: {
  selected: number
  onSelect: (index: number) => void
  options: ExpirationOption[]
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt, i) => (
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
