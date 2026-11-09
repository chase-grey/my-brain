import { describe, expect, it } from 'vitest'
import type { Task } from '../domain/types'
import type { WorkProviderTask } from './workBridgeProvider'
import { mergeWorkTasks } from './workTaskSync'

const remote: WorkProviderTask = {
  id: 'entry-1', providerListId: 'outlook', domain: 'work', title: 'PQA DLG 2332576', dueDate: '2026-09-08',
  completed: false, important: true, notes: 'ask Jev first',
}

const routine: Task = {
  id: 'work-email-zero', taskId: 'work-email-zero', domain: 'work', title: 'clear email', completed: false,
  estimateMin: 30, originalEstimateMin: 30, priority: 2, energy: 'shallow', recurrence: 'weekdays-135', pinned: false, carries: 0, metadataComplete: true,
}

describe('work task sync', () => {
  it('lands new outlook tasks in triage with their notes and importance', () => {
    const [task] = mergeWorkTasks([remote], [])
    expect(task).toMatchObject({ id: 'entry-1', providerListId: 'outlook', title: 'PQA DLG 2332576', dueDate: '2026-09-08', notes: 'ask Jev first', priority: 1, metadataComplete: false })
  })

  it('keeps local triage while outlook refreshes title, due date, and completion', () => {
    const triaged: Task = { ...remote, taskId: remote.id, estimateMin: 90, originalEstimateMin: 90, priority: 2, energy: 'deep', planDate: '2026-11-06', pinned: true, carries: 1, metadataComplete: true, notes: 'my own notes' }
    const [task] = mergeWorkTasks([{ ...remote, title: 'PQA DLG 2332576 (renamed)', dueDate: undefined, completed: true }], [triaged])
    expect(task).toMatchObject({ title: 'PQA DLG 2332576 (renamed)', dueDate: undefined, completed: true, estimateMin: 90, energy: 'deep', planDate: '2026-11-06', pinned: true, notes: 'my own notes', metadataComplete: true })
  })

  it('keeps routines and app-native tasks and drops outlook tasks that left the window', () => {
    const gone: Task = { ...remote, id: 'entry-old', taskId: 'entry-old', estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0 }
    const typedOffline: Task = { ...routine, id: 'local-1', taskId: 'local-1', title: 'typed while the bridge was down', recurrence: undefined }
    expect(mergeWorkTasks([remote], [gone, routine, typedOffline]).map((task) => task.id)).toEqual(['entry-1', 'work-email-zero', 'local-1'])
  })
})
