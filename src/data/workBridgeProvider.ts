import type { ProviderTask } from '../domain/types'
import type { NewProviderTask, ProviderTaskChanges, TaskProvider } from './taskProvider'

type BridgeTask = {
  entryId: string
  subject: string
  dueDate?: string
  complete: boolean
}

export type WorkStatus = {
  tasks: number
  calendarItems: number
  inbox: number
  important: number
}

export class WorkBridgeProvider implements TaskProvider {
  constructor(private readonly baseUrl = 'http://127.0.0.1:47321', private readonly fetcher: typeof fetch = fetch) {}

  async status(): Promise<WorkStatus> {
    return await this.request<WorkStatus>('/status')
  }

  async listTasks(): Promise<ProviderTask[]> {
    return (await this.request<BridgeTask[]>('/tasks')).map((task) => ({
      id: task.entryId, domain: 'work', title: task.subject, dueDate: task.dueDate, completed: task.complete,
    }))
  }

  async createTask(_listId: string, task: NewProviderTask): Promise<ProviderTask> {
    const created = await this.request<BridgeTask>('/tasks', { method: 'POST', body: JSON.stringify(task) })
    return { id: created.entryId, domain: 'work', title: created.subject, dueDate: created.dueDate, completed: created.complete }
  }

  async updateTask(task: ProviderTask, changes: ProviderTaskChanges): Promise<ProviderTask> {
    if (task.domain !== 'work') throw new Error('task belongs to another space')
    const updated = await this.request<BridgeTask>(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: JSON.stringify(changes) })
    return { id: updated.entryId, domain: 'work', title: updated.subject, dueDate: updated.dueDate, completed: updated.complete }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) throw new Error(`work bridge returned ${response.status}`)
    return await response.json() as T
  }
}
