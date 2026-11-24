// The body slice reads workout-tracker instead of asking for a 28-day target.
// Both apps are served from the same site, so the tracker leaves a summary in the storage they share
// (its src/lib/brainShare.ts) and this reads it. The tracker judges every week and every goal; nothing is re-scored here.

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
