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
