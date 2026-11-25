// The rest slice reads the phone: sleep from Health Connect and screen time from Android's usage record, against
// goals the person sets. The phone only keeps about a week of daily screen time, so each reading is folded into
// the days already kept here.

export type RestDay = { day: string; sleepMin?: number; screenMin?: number }

/** Sleep to get each night, and the most screen time to spend each day. */
export type RestGoals = { sleepMin?: number; screenMaxMin?: number }

export type RestMeasure = { met: number; judged: number; averageMin: number; goalMin: number }

export type RestReading = {
  /** 0 to 1: how the slice fills. */
  fill: number
  sleep?: RestMeasure
  screen?: RestMeasure
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
    if (next.sleepMin !== undefined || next.screenMin !== undefined) days.set(item.day, next)
  }
  const oldest = iso(ms(today) - REST_KEEP * dayMs)
  return [...days.values()].filter((item) => item.day > oldest).sort((a, b) => a.day.localeCompare(b.day))
}

function measure(days: RestDay[], key: 'sleepMin' | 'screenMin', goalMin: number, meets: (value: number) => boolean): RestMeasure | undefined {
  const values = days.map((item) => item[key]).filter(isMinutes)
  if (!values.length) return undefined
  return { met: values.filter(meets).length, judged: values.length, averageMin: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), goalMin }
}

/**
 * The last 28 days against the goals: the share of nights with enough sleep and the share of days under the
 * screen time limit, each weighing the same. Today's screen time is still running, so it is left out.
 * A day the phone has nothing for is left out rather than held against the person.
 * Nothing when no goal has numbers behind it, so rest works like any other area.
 */
export function restReading(days: RestDay[], goals: RestGoals, today: string): RestReading | undefined {
  const from = iso(ms(today) - REST_WINDOW * dayMs)
  const window = days.filter((item) => item.day > from && item.day <= today)
  const sleep = goals.sleepMin ? measure(window, 'sleepMin', goals.sleepMin, (value) => value >= goals.sleepMin!) : undefined
  const screen = goals.screenMaxMin ? measure(window.filter((item) => item.day < today), 'screenMin', goals.screenMaxMin, (value) => value <= goals.screenMaxMin!) : undefined
  const parts = [sleep, screen].filter((item): item is RestMeasure => !!item)
  if (!parts.length) return undefined
  return {
    fill: parts.reduce((sum, item) => sum + item.met / item.judged, 0) / parts.length,
    ...(sleep ? { sleep } : {}),
    ...(screen ? { screen } : {}),
    daysTracked: days.length,
  }
}
