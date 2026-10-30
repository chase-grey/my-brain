import { describe, expect, it } from 'vitest'
import type { ProviderTask, Task, TaskMeta } from '../domain/types'
import { mergePersonalTasks, taskMetadata } from './personalTaskSync'

const provider: ProviderTask = {
  id: 'provider', providerListId: 'list', domain: 'personal', title: 'from to-do', completed: false,
}

const meta: TaskMeta = {
  taskId: 'provider', domain: 'personal', estimateMin: 45, originalEstimateMin: 45,
  priority: 2, energy: 'deep', pinned: false, carries: 0,
}

describe('personal task sync', () => {
  it('joins remote provider fields to remote metadata', () => {
    expect(mergePersonalTasks([provider], [meta])[0]).toMatchObject({
      title: 'from to-do', providerListId: 'list', estimateMin: 45, metadataComplete: true,
    })
  })

  it('keeps app-native recurring tasks and defaults new provider tasks into triage', () => {
    const routine: Task = {
      id: 'routine', taskId: 'routine', domain: 'personal', title: 'vitamins', completed: false,
      estimateMin: 5, originalEstimateMin: 5, priority: 2, energy: 'shallow', recurrence: 'daily',
      pinned: false, carries: 0,
    }
    const merged = mergePersonalTasks([provider], [], [routine])

    expect(merged.map((task) => task.id)).toEqual(['provider', 'routine'])
    expect(merged[0]).toMatchObject({ estimateMin: 30, metadataComplete: false })
  })

  it('preserves multiline notes and clearing notes through metadata sync', () => {
    const notes = 'Call Alex\nAsk about the PC setup: https://example.com'
    const task: Task = { ...provider, ...meta, notes }
    const restored = mergePersonalTasks([provider], taskMetadata([task]))[0]
    expect(restored.notes).toBe(notes)
    expect(mergePersonalTasks([provider], taskMetadata([{ ...restored, notes: '' }]))[0].notes).toBe('')
  })

  it('writes only sidecar-owned task fields', () => {
    const task = { ...provider, ...meta, taskId: provider.id }
    expect(taskMetadata([task])).toEqual([meta])
  })
})
