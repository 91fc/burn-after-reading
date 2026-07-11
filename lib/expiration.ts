export const EXPIRATION_OPTIONS = [
  { label: '10 minutes', count: 10, unit: 'minutes' as const },
  { label: '6 hours', count: 6, unit: 'hours' as const },
  { label: '1 day', count: 1, unit: 'days' as const },
  { label: '3 days', count: 3, unit: 'days' as const },
  { label: '1 week', count: 1, unit: 'weeks' as const },
]

export function getExpirationDate(optionIndex: number): Date {
  const option = EXPIRATION_OPTIONS[optionIndex] ?? EXPIRATION_OPTIONS[0]
  const now = new Date()
  const date = new Date(now)
  switch (option.unit) {
    case 'minutes':
      date.setMinutes(now.getMinutes() + option.count)
      break
    case 'hours':
      date.setHours(now.getHours() + option.count)
      break
    case 'days':
      date.setDate(now.getDate() + option.count)
      break
    case 'weeks':
      date.setDate(now.getDate() + option.count * 7)
      break
  }
  return date
}
