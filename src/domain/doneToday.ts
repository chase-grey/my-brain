import type { Activity, Domain, Task } from './types'
import { isDoneToday } from './personalNow'

/** The day on this device's clock that a moment fell on. */
export function localDay(moment: string): string {
  return new Date(moment).toLocaleDateString('en-CA')
}

/**
 * What was ticked off today, for the card at the bottom of today (AGENTS.md, "done today"): tasks, store items and
 * routines, newest first, with routines (which keep a day, not a time) after them. A task ticked off somewhere
 * else leaves no record of when and is not listed, and neither is one that was reopened.
 */
export function doneToday(tasks: Task[], activities: Activity[], today: string, domain: Domain): Task[] {
  const at = new Map<string, string>()
  for (const item of activities) {
    if (item.kind === 'task-completed' && item.taskId && localDay(item.occurredAt) === today) at.set(item.taskId, item.occurredAt)
  }
  const mine = tasks.filter((task) => task.domain === domain && task.kind !== 'delegated' && isDoneToday(task, today))
  const once = mine.filter((task) => !task.recurrence && at.has(task.id)).sort((a, b) => at.get(b.id)!.localeCompare(at.get(a.id)!))
  return [...once, ...mine.filter((task) => task.recurrence)]
}
