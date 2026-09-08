import { describe, expect, it, vi } from 'vitest'
import type { GraphClient } from './graphClient'
import { TodoGraphProvider } from './todoGraphProvider'

function graphStub() {
  return {
    collection: vi.fn(),
    request: vi.fn(),
  } as unknown as GraphClient
}

describe('microsoft to-do provider', () => {
  it('loads every list and preserves list identity for writes', async () => {
    const graph = graphStub()
    vi.mocked(graph.collection)
      .mockResolvedValueOnce([{ id: 'list/a', displayName: 'tasks' }])
      .mockResolvedValueOnce([{
        id: 'task-one', title: 'call dentist', status: 'notStarted',
        dueDateTime: { dateTime: '2026-09-10T00:00:00', timeZone: 'UTC' },
      }])

    const tasks = await new TodoGraphProvider(graph).listTasks()

    expect(tasks).toEqual([{
      id: 'task-one', providerListId: 'list/a', domain: 'personal', title: 'call dentist',
      dueDate: '2026-09-10', completed: false,
    }])
    expect(graph.collection).toHaveBeenNthCalledWith(1, '/me/todo/lists?$select=id,displayName,wellknownListName')
    expect(graph.collection).toHaveBeenLastCalledWith('/me/todo/lists/list%2Fa/tasks?$select=id,title,status,dueDateTime')
  })

  it('maps completion back to graph', async () => {
    const graph = graphStub()
    vi.mocked(graph.request).mockResolvedValue({ id: 'task-one', title: 'call dentist', status: 'completed' })
    const provider = new TodoGraphProvider(graph)

    const updated = await provider.updateTask({
      id: 'task-one', providerListId: 'list', domain: 'personal', title: 'call dentist', completed: false,
    }, { completed: true })

    expect(graph.request).toHaveBeenCalledWith('/me/todo/lists/list/tasks/task-one', {
      method: 'PATCH', body: JSON.stringify({ status: 'completed' }),
    })
    expect(updated.completed).toBe(true)
  })

  it('finds the provider default list for new tasks', async () => {
    const graph = graphStub()
    vi.mocked(graph.collection).mockResolvedValue([
      { id: 'custom', displayName: 'later', wellknownListName: 'none' },
      { id: 'default', displayName: 'tasks', wellknownListName: 'defaultList' },
    ])

    await expect(new TodoGraphProvider(graph).defaultListId()).resolves.toBe('default')
  })
})
