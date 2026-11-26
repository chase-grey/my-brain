import type { Task, TaskMeta } from '../domain/types'
import { isOld } from '../domain/age'
import { taskMetadata } from './personalTaskSync'

/**
 * How a sorted task reaches the other devices. What I chose for a task (its time, priority, where, that it is
 * sorted at all) is kept in the account, one record a task, and every device reads the same records.
 *
 * - A change sends only the tasks it changed. A device never sends a task it did not touch, so one holding an
 *   old picture cannot put a task back under new to sort.
 * - A change that could not be sent waits on the device and goes up at the next sync, with the time it was made.
 * - The account's record stands over the device's, except for a change still waiting to go up.
 * - A task sorted on this device that the account has no record of is sent up, not thrown away.
 */

const waitingKey = 'my-brain.personal.task-meta-waiting.v1'
/** A finished task this old gives its record up, so a device's log does not grow for ever. */
export const recordKeptDays = 400

/** Task id to the moment its record was last changed here and not yet sent. */
export type Waiting = Record<string, string>

export function loadWaiting(storage: Storage = localStorage): Waiting {
  try {
    return JSON.parse(storage.getItem(waitingKey) ?? '{}') as Waiting
  } catch {
    return {}
  }
}

export function saveWaiting(waiting: Waiting, storage: Storage = localStorage): void {
  try {
    storage.setItem(waitingKey, JSON.stringify(waiting))
  } catch {
    // Without storage the change is still sent now; it only cannot wait.
  }
}

/** Each personal task's record as text, to tell later which ones a change touched. */
export function metaSnapshot(tasks: Task[]): Map<string, string> {
  return new Map(taskMetadata(tasks).map((meta) => [meta.taskId, JSON.stringify(meta)]))
}

/** The tasks whose record is not what it was in `before`. */
export function changedIds(before: Map<string, string>, tasks: Task[]): string[] {
  return [...metaSnapshot(tasks)].filter(([id, record]) => before.get(id) !== record).map(([id]) => id)
}

/** Whether a task's record is still worth keeping in the account. */
export function keepsRecord(task: Pick<Task, 'completed' | 'createdAt'>, now: string): boolean {
  return !(task.completed && isOld(task.createdAt, now, recordKeptDays))
}

/**
 * The records a sync goes by, and the ids of tasks sorted here that the account has not heard of (`unsent`).
 */
export function reconcileMeta(remote: TaskMeta[], local: Task[], waiting: Waiting, now: string): { metadata: TaskMeta[]; unsent: string[] } {
  const records = new Map(remote.map((meta) => [meta.taskId, meta]))
  const unsent: string[] = []
  const tasks = new Map(local.map((task) => [task.id, task]))
  for (const meta of taskMetadata(local)) {
    if (waiting[meta.taskId]) {
      records.set(meta.taskId, meta)
    } else if (!records.has(meta.taskId) && meta.metadataComplete !== false) {
      records.set(meta.taskId, meta)
      if (keepsRecord(tasks.get(meta.taskId)!, now)) unsent.push(meta.taskId)
    }
  }
  return { metadata: [...records.values()], unsent }
}

/** The events to write for what is waiting, and what is left waiting for a task that is no longer here. */
export function waitingEntries(waiting: Waiting, tasks: Task[]): { entityType: 'taskMeta'; entityId: string; op: 'set'; value: TaskMeta; occurredAt: string }[] {
  const records = new Map(taskMetadata(tasks).map((meta) => [meta.taskId, meta]))
  return Object.entries(waiting).filter(([id]) => records.has(id)).map(([id, at]) => ({ entityType: 'taskMeta' as const, entityId: id, op: 'set' as const, value: records.get(id)!, occurredAt: at }))
}

/** What is still waiting once `sent` has gone up: anything changed again since stays. */
export function afterSending(waiting: Waiting, sent: Waiting, tasks: Task[]): Waiting {
  const here = new Set(tasks.map((task) => task.id))
  return Object.fromEntries(Object.entries(waiting).filter(([id, at]) => here.has(id) && sent[id] !== at))
}
