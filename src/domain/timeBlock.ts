// Time blocked in the calendar for a task or a project: a busy event on a day and hour Chase picks, written to
// the calendar of the space it belongs to (AGENTS.md, "blocking time"). The app keeps only what it needs to
// show the block and take it back; the calendar is where it lives.

import type { CalendarBlock } from '../data/calendarGraphProvider'
import { clockTime } from './calendar'
import type { Domain } from './types'

export type TimeBlock = {
  id: string
  domain: Domain
  title: string
  /** Local date-times, 2026-12-05T13:00:00. */
  start: string
  end: string
  /** The event in the calendar. */
  eventId: string
  taskId?: string
  projectId?: string
  webLink?: string
}

export type BlockInput = { title: string; /** YYYY-MM-DDTHH:MM, on this device's clock. */ start: string; minutes: number; taskId?: string; projectId?: string }

/** What a space's calendar has to do for a block: the personal one through Microsoft, the work one through the bridge. */
export interface BlockCalendar {
  createBlock(subject: string, start: string, end: string): Promise<CalendarBlock>
  event(id: string): Promise<CalendarBlock | undefined>
  deleteEvent(id: string): Promise<void>
}

/** The line written into the event, which is also how the work bridge knows an event is one it may delete. */
export const blockNote = 'blocked by my brain.'

export const minBlockMin = 15
export const maxBlockMin = 12 * 60

const pad = (value: number) => String(value).padStart(2, '0')
const momentPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/

/** The start and end of a block as the calendar takes them. */
export function blockSpan(start: string, minutes: number): { start: string; end: string } {
  const from = new Date(start)
  const to = new Date(from.getTime() + minutes * 60_000)
  const format = (value: Date) => `${value.toLocaleDateString('en-CA')}T${pad(value.getHours())}:${pad(value.getMinutes())}:00`
  return { start: format(from), end: format(to) }
}

/** A start as the app keeps it, YYYY-MM-DDTHH:MM, or nothing when the words are not a real moment. */
export function validBlockStart(value: string): string | undefined {
  const match = momentPattern.exec(value.trim())
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return undefined
  const moment = `${match[1]}T${match[2]}:${match[3]}`
  const date = new Date(moment)
  // A day that does not exist (february 30) rolls over into another one.
  return Number.isNaN(date.getTime()) || date.toLocaleDateString('en-CA') !== match[1] ? undefined : moment
}

/** Why a block cannot be written, in plain words, or nothing when it can. */
export function blockProblem(input: Pick<BlockInput, 'title' | 'start' | 'minutes'>, now: Date = new Date()): string | undefined {
  if (!input.title.trim()) return 'it needs a name'
  const start = validBlockStart(input.start)
  if (!start) return 'pick a day and a time'
  if (new Date(start).getTime() <= now.getTime()) return 'that time has already passed'
  if (!Number.isFinite(input.minutes) || input.minutes < minBlockMin) return `a block is at least ${minBlockMin} minutes`
  if (input.minutes > maxBlockMin) return 'a block is at most 12 hours'
  return undefined
}

/** "sat, dec 5 · 1pm–3pm", the way a block reads wherever it shows. */
export function blockLabel(block: Pick<TimeBlock, 'start' | 'end'>): string {
  const day = new Date(block.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toLowerCase()
  return `${day} · ${clockTime(block.start)}–${clockTime(block.end)}`
}

export function blocksFor(blocks: TimeBlock[], target: { taskId?: string; projectId?: string }): TimeBlock[] {
  return blocks.filter((block) => (target.taskId !== undefined && block.taskId === target.taskId) || (target.projectId !== undefined && block.projectId === target.projectId)).sort((a, b) => a.start.localeCompare(b.start))
}

/** A block leaves once its time is over. */
export function settleBlocks<T extends { timeBlocks: TimeBlock[] }>(state: T, now: Date = new Date()): T {
  const timeBlocks = state.timeBlocks.filter((block) => new Date(block.end).getTime() > now.getTime())
  return timeBlocks.length === state.timeBlocks.length ? state : { ...state, timeBlocks }
}

export type BlockChange = { kind: 'unchanged' } | { kind: 'moved'; start: string; end: string } | { kind: 'gone' }

/** What the calendar says about a block: moved there, it comes back with its new time; deleted there, it is gone here too. */
export function reconcileBlock(block: TimeBlock, event: CalendarBlock | undefined): BlockChange {
  if (!event) return { kind: 'gone' }
  return event.start === block.start && event.end === block.end ? { kind: 'unchanged' } : { kind: 'moved', start: event.start, end: event.end }
}

export function withBlockChange<T extends { timeBlocks: TimeBlock[] }>(state: T, id: string, change: BlockChange): T {
  if (change.kind === 'unchanged') return state
  return {
    ...state,
    timeBlocks: change.kind === 'gone'
      ? state.timeBlocks.filter((block) => block.id !== id)
      : state.timeBlocks.map((block) => block.id === id ? { ...block, start: change.start, end: change.end } : block),
  }
}
