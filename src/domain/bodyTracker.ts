// The body slice reads workout-tracker instead of asking for a 28-day target.
// The tracker posts a summary to its backend (its src/lib/brainShare.ts) and this reads it with the account's key, on any device.
// On a device that also runs the tracker the same summary sits in the storage the two apps share, and the key is picked up there.
// The tracker judges every week and every goal; nothing is re-scored here.

/** The tracker's hosted backend, the address its own app ships with. */
export const TRACKER_URL = 'https://script.google.com/macros/s/AKfycbxKDeDE9cRmW8eA5TjShq9dmRvJoVxVE4nsx0l43WLpyXBv_TvheDsYLpBCVuZHLL89xA/exec'

/** The key workout-tracker writes. */
export const TRACKER_SHARE_KEY = 'wt.share.body'

export type TrackerWeek = { week: string; result: 'hit' | 'froze' | 'missed'; inProgress?: boolean }

export type TrackerSummary = {
  v: 1
  asOf: string
  streak: number
  freezes: number
  weeksTracked: number
  weeks: TrackerWeek[]
  goals: { open: number; onPace: number; met: number }
}

export type BodyReading = {
  /** 0 to 1: how the slice fills. */
  fill: number
  weeksHit: number
  weeksJudged: number
  /** Left out when the tracker has not been opened since a week ended, so the run is not known to stand. */
  streak?: number
  goalsOpen: number
  goalsOnPace: number
  goalsMet: number
  weeksTracked: number
}

const WINDOW = 4
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

export function parseTrackerSummary(raw: string | null | undefined): TrackerSummary | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw) as Partial<TrackerSummary> | null
    if (!value || value.v !== 1 || !isDay(value.asOf) || !isCount(value.streak) || !isCount(value.freezes) || !Array.isArray(value.weeks) || !value.weeks.length) return undefined
    const weeks = value.weeks.filter((item): item is TrackerWeek => !!item && isDay(item.week) && ['hit', 'froze', 'missed'].includes(item.result))
    if (weeks.length !== value.weeks.length) return undefined
    const goals = value.goals
    if (!goals || !isCount(goals.open) || !isCount(goals.onPace) || !isCount(goals.met)) return undefined
    return {
      v: 1, asOf: value.asOf, streak: value.streak, freezes: value.freezes,
      weeksTracked: isCount(value.weeksTracked) ? value.weeksTracked : weeks.length,
      weeks: weeks.map((item) => ({ week: item.week, result: item.result, ...(item.inProgress ? { inProgress: true } : {}) })),
      goals: { open: goals.open, onPace: goals.onPace, met: goals.met },
    }
  } catch {
    return undefined
  }
}

export function readTrackerSummary(): TrackerSummary | undefined {
  try {
    return parseTrackerSummary(localStorage.getItem(TRACKER_SHARE_KEY))
  } catch {
    return undefined
  }
}

const TRACKER_OFF_KEY = 'my-brain.tracker.off'

/** Disconnecting has to stick on a device that is signed in to the tracker, where the key would otherwise be picked straight back up. */
export function setTrackerOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(TRACKER_OFF_KEY, '1')
    else localStorage.removeItem(TRACKER_OFF_KEY)
  } catch {
    // Without storage there is no key to pick up either.
  }
}

/** The tracker's account key on a device that is signed in to the tracker, so nobody types it twice. */
export function readTrackerToken(): string {
  try {
    if (localStorage.getItem(TRACKER_OFF_KEY)) return ''
    const token = (JSON.parse(localStorage.getItem('wt.settings') ?? '{}') as { accountToken?: unknown } | null)?.accountToken
    return typeof token === 'string' ? token.trim() : ''
  } catch {
    return ''
  }
}

/** The later of two summaries; the account's on a tie, since every device can reach it. */
export function newerSummary(local: TrackerSummary | undefined, remote: TrackerSummary | undefined): TrackerSummary | undefined {
  if (!local || !remote) return remote ?? local
  return local.asOf > remote.asOf ? local : remote
}

function trackerUrl(route: string, token?: string): string {
  const url = new URL(TRACKER_URL)
  url.searchParams.set('route', route)
  if (token) url.searchParams.set('user', token)
  return url.toString()
}

/** The account's summary, or nothing when none is posted yet or the backend cannot be reached. */
export async function fetchTrackerSummary(token: string): Promise<TrackerSummary | undefined> {
  try {
    const response = await fetch(trackerUrl('share', token), { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) return undefined
    return parseTrackerSummary(JSON.stringify(await response.json()))
  } catch {
    return undefined
  }
}

/** Signs in the way the tracker does and returns the account key. Throws with words a person can read. */
export async function signInToTracker(email: string, password: string): Promise<string> {
  let payload: { token?: unknown; error?: unknown } | null
  try {
    // text/plain keeps this a simple request; the backend cannot answer a preflight.
    const response = await fetch(trackerUrl('login'), { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(30_000) })
    payload = response.ok ? await response.json() as { token?: unknown; error?: unknown } | null : null
  } catch {
    payload = null
  }
  if (!payload) throw new Error('could not reach workout tracker')
  if (typeof payload.token === 'string' && payload.token.trim()) return payload.token.trim()
  throw new Error(typeof payload.error === 'string' ? payload.error.toLowerCase() : 'that email and password did not work')
}

const dayMs = 86_400_000
const ms = (day: string) => new Date(`${day}T00:00:00Z`).getTime()
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)

/**
 * The last four weeks as the tracker judged them, and the committed goals beside them.
 *
 * A week that ended with no word from the tracker counts as missed: logging is the only thing that opens it,
 * so a week it never reported is one that was not finished. A hit week is 1, a week saved by freezes a half.
 * With committed goals open, the weeks are half the fill and the share of goals on pace the other half.
 */
export function bodyReading(summary: TrackerSummary, today: string): BodyReading {
  const weeks = [...summary.weeks].sort((a, b) => a.week.localeCompare(b.week))
  const first = weeks[0].week
  const last = weeks[weeks.length - 1].week
  // The tracker's weeks all start on the same weekday, so the current one is a whole number of weeks after any of them.
  const current = ms(last) + Math.floor((ms(today) - ms(last)) / (7 * dayMs)) * 7 * dayMs
  const reported = new Map(weeks.map((item) => [item.week, item.result]))
  const newest = reported.has(iso(current)) ? current : current - 7 * dayMs
  let score = 0
  let weeksHit = 0
  let weeksJudged = 0
  let unreported = 0
  for (let index = 0; index < WINDOW; index += 1) {
    const week = iso(newest - index * 7 * dayMs)
    if (week < first) break
    weeksJudged += 1
    const result = reported.get(week)
    if (!result) unreported += 1
    if (result === 'hit') { score += 1; weeksHit += 1 }
    else if (result === 'froze') score += 0.5
  }
  const weekShare = weeksJudged ? score / weeksJudged : 0
  const { open, onPace, met } = summary.goals
  const fill = open > 0 ? (weekShare + Math.min(1, onPace / open)) / 2 : weekShare
  return {
    fill,
    weeksHit,
    weeksJudged,
    ...(unreported === 0 && ms(today) >= ms(summary.asOf) ? { streak: summary.streak } : {}),
    goalsOpen: open,
    goalsOnPace: Math.min(onPace, open),
    goalsMet: met,
    weeksTracked: summary.weeksTracked,
  }
}
