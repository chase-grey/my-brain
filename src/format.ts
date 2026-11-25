export function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

/**
 * A length of time as typed: "45", "45m", "2h", "1.5h", "1h 30m", "1:30", "2 hours". A bare number is minutes.
 * Nothing when the words are not a length, or it comes to no time at all.
 */
export function parseDuration(text: string): number | undefined {
  const words = text.trim().toLowerCase()
  if (!words) return undefined
  let minutes: number
  const clock = /^(\d+):(\d{1,2})$/.exec(words)
  const parts = /^(?:(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?)?$/.exec(words)
  if (clock) minutes = Number(clock[1]) * 60 + Number(clock[2])
  else if (parts && (parts[1] !== undefined || parts[2] !== undefined)) minutes = Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0)
  else return undefined
  minutes = Math.round(minutes)
  return minutes > 0 ? minutes : undefined
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
