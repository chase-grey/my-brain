import type { Task } from './types'

/**
 * A reminder is a moment on the clock where the phone is, written "2026-11-30T07:00". It is its own thing: a task
 * with one needs no due date, and setting one never sets the other. Two moments compare as plain text.
 */
const shape = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

export function localMoment(date = new Date()): string {
  const two = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`
}

/** The moment when the words are one that exists, to the minute. Nothing for anything else. */
export function validMoment(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const parts = shape.exec(value.slice(0, 16))
  if (!parts) return undefined
  const [year, month, day, hour, minute] = parts.slice(1).map(Number)
  const date = new Date(year, month - 1, day, hour, minute)
  const real = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day && hour < 24 && minute < 60
  return real ? parts[0] : undefined
}

/** A reminder still to come. One whose moment has gone is not offered or set again. */
export function upcoming(remindAt: string | undefined, now: string): string | undefined {
  return remindAt && remindAt > now ? remindAt : undefined
}

/** Only a personal task that is not a routine carries a reminder: the phone is what gives it. */
export function takesReminder(task: Pick<Task, 'domain' | 'recurrence'>): boolean {
  return task.domain === 'personal' && !task.recurrence
}

/**
 * A reminded task sits on today from the day of its reminder until it is done, so one that was swiped away is
 * still there to see. Done on the day it stays, ticked, like a task due that day.
 */
export function remindedBy(task: Pick<Task, 'domain' | 'recurrence' | 'remindAt' | 'completed'>, today: string): boolean {
  if (!task.remindAt || !takesReminder(task)) return false
  const day = task.remindAt.slice(0, 10)
  return day === today || (!task.completed && day < today)
}

function clock(remindAt: string): string {
  const hour = Number(remindAt.slice(11, 13))
  const minute = remindAt.slice(14, 16)
  return `${hour % 12 || 12}${minute === '00' ? '' : `:${minute}`}${hour < 12 ? 'am' : 'pm'}`
}

function dayAfter(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00`)
  date.setDate(date.getDate() + days)
  return localMoment(date).slice(0, 10)
}

/** The moment as it is said: "today 7am", "tomorrow 6:30pm", "mon 7am" inside a week, "dec 14 7am" past that. */
export function remindLabel(remindAt: string, now: string): string {
  const day = remindAt.slice(0, 10)
  const today = now.slice(0, 10)
  const date = new Date(`${day}T12:00:00`)
  const name = day === today ? 'today'
    : day === dayAfter(today, 1) ? 'tomorrow'
    : day > today && day < dayAfter(today, 7) ? date.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase()
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toLowerCase()
  return `${name} ${clock(remindAt)}`
}

/** The line beside a reminded task on today. */
export function remindHint(remindAt: string, today: string): string {
  return remindAt.slice(0, 10) === today ? `reminder ${clock(remindAt)}` : `reminded ${remindLabel(remindAt, `${today}T00:00`).replace(/ \S+$/, '')}`
}

export type Reminder = { id: number; taskId: string; title: string; at: string }

/** Android names a notification by a number, so a task's id is folded into one that stays the same. */
export function reminderId(taskId: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < taskId.length; index += 1) hash = Math.imul(hash ^ taskId.charCodeAt(index), 0x01000193)
  return (hash >>> 1) || 1
}

/** What the phone should be holding: every open task whose reminder is still to come, soonest first. */
export function remindersFor(tasks: Task[], now: string): Reminder[] {
  return tasks
    .filter((task) => takesReminder(task) && !task.completed && upcoming(task.remindAt, now))
    .map((task) => ({ id: reminderId(task.id), taskId: task.id, title: task.title, at: task.remindAt! }))
    .sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id)
}
