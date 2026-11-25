// The rest slice reads the phone: sleep from Health Connect and screen time from Android's usage record, against
// goals the person sets. The phone only keeps about a week of daily screen time, so each reading is folded into
// the days already kept here.

/** `bedMin` is when the night's sleep began, in minutes after noon the evening before: 11:30pm is 690, 12:30am is 750. */
export type RestDay = { day: string; sleepMin?: number; screenMin?: number; bedMin?: number }

/** Sleep to get each night, the most screen time to spend each day, and the time to be asleep by (minutes after noon). */
export type RestGoals = { sleepMin?: number; screenMaxMin?: number; bedByMin?: number }

export type RestMeasure = { met: number; judged: number; averageMin: number; goalMin: number }

export type RestReading = {
  /** 0 to 1: how the slice fills. */
  fill: number
  sleep?: RestMeasure
  screen?: RestMeasure
  /** Nights asleep by the bedtime set; `averageMin` and `goalMin` are minutes after noon. */
  bed?: RestMeasure
  daysTracked: number
}

export const REST_WINDOW = 28
/** Days kept on the device; a year of reviews needs no more. */
export const REST_KEEP = 400

const dayMs = 86_400_000
const ms = (day: string) => new Date(`${day}T00:00:00Z`).getTime()
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)
const isMinutes = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Folds a reading from the phone into the days kept. The phone's number wins for a day it reports; old days fall off the end. */
export function mergeRestDays(kept: RestDay[], read: RestDay[], today: string): RestDay[] {
  const days = new Map(kept.map((item) => [item.day, item]))
  for (const item of read) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.day) || item.day > today) continue
    const next: RestDay = { ...days.get(item.day), day: item.day }
    if (isMinutes(item.sleepMin)) next.sleepMin = Math.round(item.sleepMin)
    if (isMinutes(item.screenMin)) next.screenMin = Math.round(item.screenMin)
    if (isMinutes(item.bedMin) && item.bedMin < 1440) next.bedMin = Math.round(item.bedMin)
    if (next.sleepMin !== undefined || next.screenMin !== undefined) days.set(item.day, next)
  }
  const oldest = iso(ms(today) - REST_KEEP * dayMs)
  return [...days.values()].filter((item) => item.day > oldest).sort((a, b) => a.day.localeCompare(b.day))
}

function measure(days: RestDay[], key: 'sleepMin' | 'screenMin' | 'bedMin', goalMin: number, meets: (value: number) => boolean): RestMeasure | undefined {
  const values = days.map((item) => item[key]).filter(isMinutes)
  if (!values.length) return undefined
  return { met: values.filter(meets).length, judged: values.length, averageMin: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), goalMin }
}

/**
 * The last 28 days against the goals: the share of nights with enough sleep, the share of days under the
 * screen time limit and the share of nights asleep by the bedtime, each weighing the same. Today's screen time is still running, so it is left out.
 * A day the phone has nothing for is left out rather than held against the person.
 * Nothing when no goal has numbers behind it, so rest works like any other area.
 */
export function restReading(days: RestDay[], goals: RestGoals, today: string): RestReading | undefined {
  const from = iso(ms(today) - REST_WINDOW * dayMs)
  const window = days.filter((item) => item.day > from && item.day <= today)
  const sleep = goals.sleepMin ? measure(window, 'sleepMin', goals.sleepMin, (value) => value >= goals.sleepMin!) : undefined
  const screen = goals.screenMaxMin ? measure(window.filter((item) => item.day < today), 'screenMin', goals.screenMaxMin, (value) => value <= goals.screenMaxMin!) : undefined
  const bed = goals.bedByMin !== undefined ? measure(window, 'bedMin', goals.bedByMin, (value) => value <= goals.bedByMin!) : undefined
  const parts = [sleep, screen, bed].filter((item): item is RestMeasure => !!item)
  if (!parts.length) return undefined
  return {
    fill: parts.reduce((sum, item) => sum + item.met / item.judged, 0) / parts.length,
    ...(sleep ? { sleep } : {}),
    ...(screen ? { screen } : {}),
    ...(bed ? { bed } : {}),
    daysTracked: days.length,
  }
}

/** Minutes after noon as a clock time: 690 is "11:30pm". */
export function bedClock(minutes: number): string {
  const total = (Math.round(minutes) + 720) % 1440
  const hour = Math.floor(total / 60)
  const minute = total % 60
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''}${hour < 12 ? 'am' : 'pm'}`
}

/** A time field's "23:30" as minutes after noon, and back. */
export function bedFromTime(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  return match ? (Number(match[1]) * 60 + Number(match[2]) + 720) % 1440 : undefined
}

export function bedToTime(minutes: number | undefined): string {
  if (minutes === undefined) return ''
  const total = (minutes + 720) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}
