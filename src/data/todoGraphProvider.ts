import type { ProviderTask } from '../domain/types'
import type { GraphClient } from './graphClient'
import type { NewProviderTask, ProviderTaskChanges, TaskProvider } from './taskProvider'

export type GraphTaskList = {
  id: string
  displayName: string
  wellknownListName?: 'none' | 'defaultList' | 'flaggedEmails' | 'unknownFutureValue'
}

type GraphDateTime = {
  dateTime: string
  timeZone: string
}

type GraphTodoTask = {
  id: string
  title: string
  status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred'
  dueDateTime?: GraphDateTime
}

function encode(value: string): string {
  return encodeURIComponent(value)
}

function toProviderTask(task: GraphTodoTask, listId: string): ProviderTask {
  return {
    id: task.id,
    providerListId: listId,
    domain: 'personal',
    title: task.title,
    dueDate: task.dueDateTime?.dateTime.slice(0, 10),
    completed: task.status === 'completed',
  }
}

function toGraphChanges(changes: ProviderTaskChanges): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (changes.title !== undefined) result.title = changes.title
  if (changes.completed !== undefined) result.status = changes.completed ? 'completed' : 'notStarted'
  if ('dueDate' in changes) {
    result.dueDateTime = changes.dueDate
      ? { dateTime: `${changes.dueDate}T00:00:00`, timeZone: 'UTC' }
      : null
  }
  return result
}

export class TodoGraphProvider implements TaskProvider {
  constructor(private readonly graph: GraphClient) {}

  async listTaskLists(): Promise<GraphTaskList[]> {
    return await this.graph.collection<GraphTaskList>('/me/todo/lists?$select=id,displayName,wellknownListName')
  }

  async defaultListId(): Promise<string> {
    const lists = await this.listTaskLists()
    const list = lists.find((candidate) => candidate.wellknownListName === 'defaultList') ?? lists[0]
    if (!list) throw new Error('microsoft to-do has no task list')
    return list.id
  }

  async listTasks(): Promise<ProviderTask[]> {
    const lists = await this.listTaskLists()
    const taskGroups = await Promise.all(lists.map(async (list) => {
      const path = `/me/todo/lists/${encode(list.id)}/tasks?$select=id,title,status,dueDateTime`
      const tasks = await this.graph.collection<GraphTodoTask>(path)
      return tasks.map((task) => toProviderTask(task, list.id))
    }))
    return taskGroups.flat()
  }

  async createTask(listId: string, task: NewProviderTask): Promise<ProviderTask> {
    const created = await this.graph.request<GraphTodoTask>(`/me/todo/lists/${encode(listId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify({ title: task.title, ...toGraphChanges({ dueDate: task.dueDate }) }),
    })
    return toProviderTask(created, listId)
  }

  async updateTask(task: ProviderTask, changes: ProviderTaskChanges): Promise<ProviderTask> {
    if (task.domain !== 'personal') throw new Error('task belongs to another space')
    if (!task.providerListId) throw new Error('provider task is missing its list id')
    const updated = await this.graph.request<GraphTodoTask>(
      `/me/todo/lists/${encode(task.providerListId)}/tasks/${encode(task.id)}`,
      { method: 'PATCH', body: JSON.stringify(toGraphChanges(changes)) },
    )
    return toProviderTask(updated, task.providerListId)
  }
}
