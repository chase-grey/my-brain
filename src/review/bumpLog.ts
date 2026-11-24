import type { Domain, Task } from '../domain/types'
import { addDays } from './period'

/** One time a task's day was pushed later, or its day was taken away while it was still open. */
export type Bump = { taskId: string; title: string; on: string; from: string; to?: string }

/** Long enough for a year in review plus the comparison with the year before it started. */
export const keepBumpDays = 800

const storageKey = (domain: Domain) => `my-brain.${domain}.bumps.v1`

function bumpOf(before: Task, after: Task, today: string): Bump | undefined {
  if (after.completed || after.recurrence || before.recurrence) return undefined
  for (const field of ['planDate', 'dueDate'] as const) {
    const from = before[field]
    const to = after[field]
    if (!from || from === to) continue
    // Pulling a task earlier is not a bump, and neither is clearing a day that had not arrived.
    if (to ? to > from : from <= today) return { taskId: after.id, title: after.title, on: today, from, ...(to ? { to } : {}) }
  }
  return undefined
}

/** Every bump between two versions of the task list. Tasks that are new or gone are not bumps. */
export function bumpsBetween(before: Task[], after: Task[], today: string): Bump[] {
  const previous = new Map(before.map((task) => [task.id, task]))
  return after.flatMap((task) => {
    const earlier = previous.get(task.id)
    const bump = earlier && bumpOf(earlier, task, today)
    return bump ? [bump] : []
  })
}

export function trimBumps(bumps: Bump[], today: string): Bump[] {
  const oldest = addDays(today, -keepBumpDays)
  return bumps.filter((bump) => bump.on >= oldest)
}

export function loadBumps(domain: Domain): Bump[] {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(domain)) ?? '[]') as Bump[]
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

export function recordBumps(domain: Domain, bumps: Bump[], today: string): void {
  if (!bumps.length) return
  try {
    localStorage.setItem(storageKey(domain), JSON.stringify(trimBumps([...loadBumps(domain), ...bumps], today)))
  } catch {
    // A missed bump only makes a review kinder than it should be.
  }
}
