import type { Energy, Task } from '../domain/types'
import type { WorkProviderTask } from './workBridgeProvider'

/**
 * Outlook is the source of truth for work tasks that came from it: title, due date, and completion
 * refresh on every sync, while the triage metadata the app owns (estimate, energy, plan date, project)
 * stays local. Routines and tasks created here while the bridge was down are app-native and survive untouched.
 */
export function mergeWorkTasks(providerTasks: WorkProviderTask[], localTasks: Task[]): Task[] {
  const local = new Map(localTasks.filter((task) => task.domain === 'work').map((task) => [task.id, task]))
  const synced = providerTasks.filter((task) => task.domain === 'work').map((remote): Task => {
    const existing = local.get(remote.id)
    if (existing) {
      return {
        ...existing,
        providerListId: remote.providerListId,
        title: remote.title,
        dueDate: remote.dueDate,
        completed: remote.completed,
        notes: existing.notes || remote.notes || undefined,
      }
    }
    return {
      id: remote.id,
      taskId: remote.id,
      providerListId: remote.providerListId,
      domain: 'work',
      title: remote.title,
      dueDate: remote.dueDate,
      completed: remote.completed,
      notes: remote.notes || undefined,
      estimateMin: 30,
      originalEstimateMin: 30,
      priority: remote.important ? 1 : 3,
      energy: 'shallow' as Energy,
      pinned: false,
      carries: 0,
      metadataComplete: false,
    }
  })
  const syncedIds = new Set(synced.map((task) => task.id))
  const appNative = localTasks.filter((task) => task.domain === 'work' && !task.providerListId && !syncedIds.has(task.id))
  return [...synced, ...appNative]
}
