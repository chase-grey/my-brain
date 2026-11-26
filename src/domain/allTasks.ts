import { compareCandidates, endOfWeek } from './personalNow'
import { remindedBy } from './remind'
import { priorityLabels } from './taskGuess'
import type { Domain, Project, Task } from './types'
import { shortDate, weekday } from '../format'

/**
 * The tasks screen: every task of a space still to do, by when it is due (AGENTS.md, "all tasks").
 * Today stays short; this is where the rest is seen.
 */

export type TaskGroupId = 'overdue' | 'today' | 'week' | 'later' | 'undated' | 'sort' | 'routines'

export type TaskGroup = { id: TaskGroupId; title: string; tasks: Task[] }

/** In the order the screen shows them. */
const groupTitles: [TaskGroupId, string][] = [
  ['overdue', 'overdue'],
  ['today', 'today'],
  ['week', 'this week'],
  ['later', 'later'],
  ['undated', 'no date'],
  ['sort', 'new to sort'],
  ['routines', 'routines'],
]

/** Which group a task is in, or none: a finished task, a store item (stores has those) and one handed to someone else are not here. */
export function groupOf(task: Task, today: string, domain: Domain): TaskGroupId | undefined {
  if (task.domain !== domain || task.storeType || task.kind === 'delegated' || task.triageForTaskId) return undefined
  if (task.recurrence) return 'routines'
  if (task.completed) return undefined
  if (task.metadataComplete === false) return 'sort'
  if (task.dueDate && task.dueDate < today) return 'overdue'
  if (task.dueDate === today || remindedBy(task, today)) return 'today'
  if (!task.dueDate) return 'undated'
  return task.dueDate <= endOfWeek(today) ? 'week' : 'later'
}

const byDue = (a: Task, b: Task) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || compareCandidates(a, b)
const windowOrder = { morning: 0, day: 1, anytime: 2, evening: 3 }

/** Every task of the space still to do, in its group. A group with nothing in it is left out. `query` keeps the titles that hold those words. */
export function taskGroups(tasks: Task[], today: string, domain: Domain, query = ''): TaskGroup[] {
  const words = query.trim().toLowerCase()
  const held = new Map<TaskGroupId, Task[]>()
  for (const task of tasks) {
    const group = groupOf(task, today, domain)
    if (!group || (words && !task.title.toLowerCase().includes(words))) continue
    held.set(group, [...(held.get(group) ?? []), task])
  }
  return groupTitles.flatMap(([id, title]) => {
    const found = held.get(id)
    if (!found) return []
    // New to sort keeps the order it arrived in, as on today.
    const sorted = id === 'sort' ? found
      : id === 'routines' ? [...found].sort((a, b) => windowOrder[a.timeWindow ?? 'anytime'] - windowOrder[b.timeWindow ?? 'anytime'] || a.title.localeCompare(b.title))
        : id === 'undated' || id === 'today' ? [...found].sort(compareCandidates)
          : [...found].sort(byDue)
    return [{ id, title, tasks: sorted }]
  })
}

/** The line under a task's title: when it is due, how much it matters when that is not normal, its project, and the day it is hidden until. */
export function taskLine(task: Task, group: TaskGroupId, today: string, projects: Pick<Project, 'id' | 'title'>[]): string | undefined {
  const line = [
    task.dueDate && (group === 'week' ? weekday(task.dueDate) : group === 'overdue' || group === 'later' ? shortDate(task.dueDate) : undefined),
    group === 'routines' && (task.recurrence === 'daily' ? 'every day' : 'mon, wed, fri'),
    group !== 'sort' && task.priority !== 3 && priorityLabels[task.priority],
    projects.find((project) => project.id === task.projectId)?.title,
    task.hiddenUntil && task.hiddenUntil > today && `hidden until ${shortDate(task.hiddenUntil)}`,
  ].filter(Boolean).join(' · ')
  return line || undefined
}
