export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

export function hours(minutes: number): string {
  const value = Math.round(minutes / 6) / 10
  return `${value}h`
}

export function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function shortDate(date: string): string {
  const value = new Date(`${date}T12:00:00`)
  return value.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase()
}

export function weekday(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase()
}

export function newId(prefix = 'id'): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
