import { describe, expect, it } from 'vitest'
import { projectTasks } from './taskProjection'
import type { ProviderTask, TaskMeta } from './types'

const providerTasks: ProviderTask[] = [
  { id: 'known', domain: 'personal', title: 'Known', completed: false },
  { id: 'new', domain: 'personal', title: 'New from To-Do', completed: false },
]

const metadata: TaskMeta[] = [
  {
    taskId: 'known',
    domain: 'personal',
    estimateMin: 30,
    originalEstimateMin: 30,
    priority: 2,
    energy: 'shallow',
    pinned: true,
    carries: 0,
  },
]

describe('provider-to-sidecar projection', () => {
  it('joins known provider tasks and keeps unknown tasks in the inbox', () => {
    const result = projectTasks(providerTasks, metadata)

    expect(result.triaged).toHaveLength(1)
    expect(result.triaged[0]).toMatchObject({ id: 'known', taskId: 'known', title: 'Known' })
    expect(result.untriaged.map((task) => task.id)).toEqual(['new'])
  })

  it('namespaces the join by domain', () => {
    const result = projectTasks(
      [{ id: 'known', domain: 'work', title: 'Work collision', completed: false }],
      metadata,
    )

    expect(result.triaged).toEqual([])
    expect(result.untriaged).toHaveLength(1)
  })
})
