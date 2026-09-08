import type { Energy, ProviderTask, Task, TaskMeta } from '../domain/types'
import { projectTasks } from '../domain/taskProjection'

export const personalTaskMetaFile = 'task-meta.v1.json'

export function taskMetadata(tasks: Task[]): TaskMeta[] {
  return tasks.filter((task) => task.domain === 'personal').map((task) => ({
    taskId: task.id,
    domain: task.domain,
    estimateMin: task.estimateMin,
    originalEstimateMin: task.originalEstimateMin,
    priority: task.priority,
    planDate: task.planDate,
    hiddenUntil: task.hiddenUntil,
    energy: task.energy,
    place: task.place,
    needs: task.needs,
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

export function mergePersonalTasks(
  providerTasks: ProviderTask[],
  metadata: TaskMeta[],
  localAppTasks: Task[] = [],
): Task[] {
  providerTasks = providerTasks.filter((task) => task.domain === 'personal')
  metadata = metadata.filter((item) => item.domain === 'personal')
  const projection = projectTasks(providerTasks, metadata)
  const projected = [
    ...projection.triaged.map((task) => ({ ...task, metadataComplete: task.metadataComplete ?? true })),
    ...projection.untriaged.map(defaultUntriagedTask),
  ]
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
