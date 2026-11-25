import type { Energy, ProviderTask, Task, TaskMeta } from '../domain/types'
import { isOld } from '../domain/age'
import { projectTasks } from '../domain/taskProjection'

export const personalTaskMetaFile = 'task-meta.v1.json'

export function taskMetadata(tasks: Task[]): TaskMeta[] {
  return tasks.filter((task) => task.domain === 'personal').map((task) => ({
    taskId: task.id,
    notes: task.notes,
    domain: task.domain,
    estimateMin: task.estimateMin,
    originalEstimateMin: task.originalEstimateMin,
    priority: task.priority,
    planDate: task.planDate,
    hiddenUntil: task.hiddenUntil,
    energy: task.energy,
    place: task.place,
    storeType: task.storeType,
    recurrence: task.recurrence,
    timeWindow: task.timeWindow,
    lastCompletedDate: task.lastCompletedDate,
    metadataComplete: task.metadataComplete,
    triageForTaskId: task.triageForTaskId,
    pinned: task.pinned,
    carries: task.carries,
    projectId: task.projectId,
    kind: task.kind,
    mode: task.mode,
  }))
}

/**
 * To Do tasks nobody has sorted come in as new to sort, unless they are old: a backlog from years ago, or mail
 * flagged long ago that Outlook keeps in its flagged list, is left in To Do and never brought into the app.
 */
export function mergePersonalTasks(
  providerTasks: ProviderTask[],
  metadata: TaskMeta[],
  localAppTasks: Task[] = [],
  now = new Date().toISOString(),
): Task[] {
  providerTasks = providerTasks.filter((task) => task.domain === 'personal')
  metadata = metadata.filter((item) => item.domain === 'personal')
  const projection = projectTasks(providerTasks, metadata)
  const projected = [
    ...projection.triaged.map((task) => ({ ...task, metadataComplete: task.metadataComplete ?? true })),
    ...projection.untriaged.map(defaultUntriagedTask),
  // An unsorted task can already carry a saved record from an earlier sync, so the age rule reads the flag, not the record's absence.
  ].filter((task) => task.completed || task.metadataComplete !== false || !isOld(task.createdAt, now))
  const providerIds = new Set(providerTasks.map((task) => task.id))
  const appNative = localAppTasks.filter((task) => task.domain === 'personal' && task.recurrence && !providerIds.has(task.id))
  return [...projected, ...appNative]
}

function defaultUntriagedTask(task: ProviderTask): Task {
  return {
    ...task,
    taskId: task.id,
    estimateMin: 30,
    originalEstimateMin: 30,
    priority: 3,
    energy: 'shallow' as Energy,
    pinned: false,
    carries: 0,
    metadataComplete: false,
  }
}
