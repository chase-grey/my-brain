import type { Domain } from './domain/types'

const key = (domain: Domain) => `my-brain.lastSync.${domain}`

/** When this device last finished a sync of the space, or nothing when it never has. */
export function loadLastSync(domain: Domain): number | undefined {
  try {
    const at = Number(localStorage.getItem(key(domain)))
    return Number.isFinite(at) && at > 0 ? at : undefined
  } catch {
    return undefined
  }
}

export function saveLastSync(domain: Domain, at: number): void {
  try {
    localStorage.setItem(key(domain), String(at))
  } catch {
    // A device that cannot keep it still shows it until the app is closed.
  }
}

/** "synced 2:14 pm" for today, "synced nov 24, 2:14 pm" for any other day. */
export function syncedLabel(at: number, now = Date.now()): string {
  const when = new Date(at)
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  if (when.toDateString() === new Date(now).toDateString()) return `synced ${time}`
  return `synced ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }).toLowerCase()}, ${time}`
}
