export type ReviewKind = 'week' | 'month' | 'year'
export const reviewKinds: readonly ReviewKind[] = ['week', 'month', 'year']

/** `key` names the period: the Monday for a week, YYYY-MM for a month, YYYY for a year. `end` is the first day after it. */
export type Period = { kind: ReviewKind; key: string; start: string; end: string; label: string }

const iso = (date: Date) => date.toISOString().slice(0, 10)
const utc = (day: string) => new Date(`${day}T00:00:00Z`)

export function addDays(day: string, count: number): string {
  const date = utc(day)
  date.setUTCDate(date.getUTCDate() + count)
  return iso(date)
}

export function mondayOf(day: string): string {
  return addDays(day, -((utc(day).getUTCDay() + 6) % 7))
}

export function keyOf(kind: ReviewKind, day: string): string {
  return kind === 'week' ? mondayOf(day) : kind === 'month' ? day.slice(0, 7) : day.slice(0, 4)
}

export function periodOf(kind: ReviewKind, key: string): Period {
  if (kind === 'week') {
    const short = utc(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toLowerCase()
    return { kind, key, start: key, end: addDays(key, 7), label: `week of ${short}` }
  }
  if (kind === 'month') {
    const [year, month] = key.split('-').map(Number)
    const name = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' }).toLowerCase()
    return { kind, key, start: `${key}-01`, end: iso(new Date(Date.UTC(year, month, 1))), label: `${name} ${year}` }
  }
  return { kind, key, start: `${key}-01-01`, end: `${Number(key) + 1}-01-01`, label: key }
}

/** The period just before the one `day` falls in: what a review on `day` looks back at. */
export function lastCompleted(kind: ReviewKind, day: string): Period {
  return periodOf(kind, keyOf(kind, addDays(periodOf(kind, keyOf(kind, day)).start, -1)))
}

export function previousPeriod(period: Period): Period {
  return lastCompleted(period.kind, period.start)
}

export function nextPeriod(period: Period): Period {
  return periodOf(period.kind, keyOf(period.kind, period.end))
}

export function inPeriod(period: Pick<Period, 'start' | 'end'>, day: string): boolean {
  const date = day.slice(0, 10)
  return date >= period.start && date < period.end
}

/** The smaller periods a bigger review is built from: a month's weeks (by their Monday), a year's months. */
export function partsOf(period: Period): Period[] {
  if (period.kind === 'week') return []
  const part: ReviewKind = period.kind === 'month' ? 'week' : 'month'
  const parts: Period[] = []
  for (let at = periodOf(part, keyOf(part, period.start)); at.start < period.end; at = nextPeriod(at)) {
    if (at.start >= period.start) parts.push(at)
  }
  return parts
}

/** Which reviews are owed, biggest first. A marker holds the key of the last period already shown. */
export type ReviewMarkers = Partial<Record<ReviewKind, string>>

export function owedReviews(markers: ReviewMarkers, day: string): Period[] {
  return [...reviewKinds].reverse().map((kind) => lastCompleted(kind, day)).filter((period) => markers[period.kind] !== undefined && markers[period.kind]! < period.key)
}

/** First run: nothing is owed for the time before the feature existed. */
export function seedMarkers(markers: ReviewMarkers, day: string): ReviewMarkers {
  const seeded = { ...markers }
  for (const kind of reviewKinds) seeded[kind] ??= lastCompleted(kind, day).key
  return seeded
}
