import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { Goal } from './types'

export const defaultBlockStartHour = 13
export const defaultBlockHours = 4

const pad = (value: number) => String(value).padStart(2, '0')

export function localDateTime(date: string, hour: number, minute = 0): string {
  return `${date}T${pad(hour)}:${pad(minute)}:00`
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return value.toLocaleDateString('en-CA')
}

/** The window a block goal is held for: the app picks the day and the length, the hour is moved in the calendar. */
export function blockWindow(scheduledOn: string, hours = defaultBlockHours, startHour = defaultBlockStartHour): { start: string; end: string } {
  const start = new Date(localDateTime(scheduledOn, startHour))
  const end = new Date(start.getTime() + hours * 3_600_000)
  const format = (value: Date) => `${value.toLocaleDateString('en-CA')}T${pad(value.getHours())}:${pad(value.getMinutes())}:00`
  return { start: format(start), end: format(end) }
}

export function eventsOn(blocks: CalendarBlock[], date: string): CalendarBlock[] {
  return blocks.filter((block) => block.isAllDay ? block.start.slice(0, 10) <= date && block.end.slice(0, 10) > date : block.start.slice(0, 10) === date)
}

export function busyMinutes(blocks: CalendarBlock[], date: string): number {
  return eventsOn(blocks, date).filter((block) => !block.isAllDay).reduce((sum, block) => {
    const start = new Date(block.start).getTime()
    const end = new Date(block.end).getTime()
    return sum + Math.max(0, Math.round((end - start) / 60_000))
  }, 0)
}

/** Time for tasks ends at 9pm. Past it nothing is offered unless a length is picked then. */
export const dayEndHour = 21

export function dayOver(now: Date = new Date()): boolean {
  return now.getHours() >= dayEndHour
}

/** What this moment holds: the day is over, an event is on until a time, or it is clear for some minutes. */
export type FreeNow = { dayOver: true } | { busyUntil: string } | { freeMin: number; nextStart?: string }

/** Back-to-back events count as one. With nothing before the day's end, the clear stretch runs to it. All-day events and ones shown as free hold no time. */
export function freeNow(blocks: CalendarBlock[], now: Date = new Date()): FreeNow {
  if (dayOver(now)) return { dayOver: true }
  const at = now.getTime()
  const timed = blocks.filter((block) => !block.isAllDay && !block.free).sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
  let busyUntil: CalendarBlock | undefined
  for (const block of timed) {
    const cursor = busyUntil ? new Date(busyUntil.end).getTime() : at
    if (new Date(block.start).getTime() <= cursor && new Date(block.end).getTime() > cursor) busyUntil = block
  }
  if (busyUntil) return { busyUntil: busyUntil.end }
  const dayEnd = new Date(now)
  dayEnd.setHours(dayEndHour, 0, 0, 0)
  const next = timed.find((block) => new Date(block.start).getTime() > at && new Date(block.start).getTime() < dayEnd.getTime())
  const until = next ? new Date(next.start).getTime() : dayEnd.getTime()
  return { freeMin: Math.floor((until - at) / 60_000), nextStart: next?.start }
}

/** Without a calendar only the end of the day is known. */
export function timeNow(blocks: CalendarBlock[] | undefined, now: Date = new Date()): FreeNow | undefined {
  if (blocks) return freeNow(blocks, now)
  return dayOver(now) ? { dayOver: true } : undefined
}

/** A picked length lasts the day, except that one picked before the day's end does not carry past it. */
export function keptPick(pick: { min: number; at: number } | undefined, now: Date = new Date()): number | undefined {
  if (!pick) return undefined
  const pickedAt = new Date(pick.at)
  if (pickedAt.toDateString() !== now.toDateString()) return undefined
  return dayOver(now) && !dayOver(pickedAt) ? undefined : pick.min
}

/**
 * The lengths the extra time slider stops at, from none to a full day: every 15 minutes to 2 hours,
 * every half hour to 6, every hour after. The slider starts on none, and that is never a picked length.
 */
export const timeStops: readonly number[] = [
  ...Array.from({ length: 9 }, (_, index) => index * 15),
  ...Array.from({ length: 8 }, (_, index) => 150 + index * 30),
  ...Array.from({ length: 18 }, (_, index) => 420 + index * 60),
]

export function clockTime(dateTime: string): string {
  const value = new Date(dateTime)
  const minutes = value.getMinutes()
  return value.toLocaleTimeString(undefined, { hour: 'numeric', minute: minutes ? '2-digit' : undefined }).toLowerCase().replace(/\s/g, '')
}

export function timeRange(block: CalendarBlock): string {
  if (block.isAllDay) return 'all day'
  return `${clockTime(block.start)}–${clockTime(block.end)}`
}

export type HeldGoalChange =
  | { kind: 'unchanged' }
  | { kind: 'moved'; scheduledOn: string }
  | { kind: 'released' }

/** What the calendar says about a held block goal: a day moved in Outlook comes back as the new date, a deleted event releases the hold. */
export function reconcileHeldGoal(goal: Goal, event: CalendarBlock | undefined): HeldGoalChange {
  if (!goal.calendarEventId) return { kind: 'unchanged' }
  if (!event) return { kind: 'released' }
  const scheduledOn = event.start.slice(0, 10)
  return scheduledOn === goal.scheduledOn ? { kind: 'unchanged' } : { kind: 'moved', scheduledOn }
}
