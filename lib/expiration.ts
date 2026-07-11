export const BURN_EXPIRATION_OPTIONS = [
  { label: '10 分钟', count: 10, unit: 'minutes' as const },
  { label: '1 小时', count: 1, unit: 'hours' as const },
  { label: '1 天', count: 1, unit: 'days' as const },
  { label: '3 天', count: 3, unit: 'days' as const },
]

export const PERSISTENT_EXPIRATION_OPTIONS = [
  { label: '1 小时', count: 1, unit: 'hours' as const },
  { label: '1 天', count: 1, unit: 'days' as const },
  { label: '3 天', count: 3, unit: 'days' as const },
  { label: '1 周', count: 1, unit: 'weeks' as const },
  { label: '1 个月', count: 30, unit: 'days' as const },
]

export function getExpirationOptions(mode: 'burn' | 'persistent') {
  return mode === 'burn' ? BURN_EXPIRATION_OPTIONS : PERSISTENT_EXPIRATION_OPTIONS
}

export function getExpirationDate(optionIndex: number, mode: 'burn' | 'persistent'): Date {
  const options = getExpirationOptions(mode)
  const option = options[optionIndex] ?? options[0]
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
