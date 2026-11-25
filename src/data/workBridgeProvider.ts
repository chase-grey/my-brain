import type { ProviderTask } from '../domain/types'
import type { CalendarBlock } from './calendarGraphProvider'
import type { NewProviderTask, ProviderTaskChanges, TaskProvider } from './taskProvider'

type BridgeTask = {
  entryId: string
  subject: string
  dueDate?: string | null
  complete: boolean
  completedOn?: string | null
  importance?: number
  notes?: string
}

/** The Outlook default Tasks folder, which is where Microsoft To Do keeps the work account's list. */
export const outlookTaskList = 'outlook'

export type WorkProviderTask = ProviderTask & {
  completedOn?: string
  important: boolean
  notes: string
}

function toWorkTask(task: BridgeTask): WorkProviderTask {
  return {
    id: task.entryId, providerListId: outlookTaskList, domain: 'work', title: task.subject,
    dueDate: task.dueDate ?? undefined, completed: task.complete, completedOn: task.completedOn ?? undefined,
    important: task.importance === 2, notes: task.notes ?? '',
  }
}

export type WorkStatus = {
  tasks: number
  calendarItems: number
  inbox: number
  important: number
}

export class WorkBridgeProvider implements TaskProvider {
  constructor(private readonly baseUrl = 'http://127.0.0.1:47321', private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  async status(): Promise<WorkStatus> {
    return await this.request<WorkStatus>('/status')
  }

  /** Work events from start up to end, both local dates such as 2026-11-02, read from Outlook on the work pc. */
  async events(start: string, end: string): Promise<CalendarBlock[]> {
    const { events } = await this.request<{ events: CalendarBlock[] }>(`/calendar?start=${start}&end=${end}`)
    return events.map(({ id, subject, start, end, isAllDay, free }) => ({ id, subject, start, end, isAllDay: Boolean(isAllDay), free: Boolean(free) }))
  }

  async listTasks(): Promise<WorkProviderTask[]> {
    return (await this.request<BridgeTask[]>('/tasks')).map(toWorkTask)
  }

  async createTask(_listId: string, task: NewProviderTask): Promise<WorkProviderTask> {
    const body = { title: task.title, dueDate: task.dueDate, notes: task.notes }
    return toWorkTask(await this.request<BridgeTask>('/tasks', { method: 'POST', body: JSON.stringify(body) }))
  }

  async updateTask(task: ProviderTask, changes: ProviderTaskChanges): Promise<WorkProviderTask> {
    if (task.domain !== 'work') throw new Error('task belongs to another space')
    // JSON drops undefined, so an explicit null is how "clear the due date" reaches Outlook.
    const body = 'dueDate' in changes ? { ...changes, dueDate: changes.dueDate ?? null } : changes
    return toWorkTask(await this.request<BridgeTask>(`/tasks/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: JSON.stringify(body) }))
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
    if (!response.ok) {
      const detail = await response.json().then((body: { error?: string }) => body.error, () => undefined)
      throw new Error(detail || `work bridge returned ${response.status}`)
    }
    return await response.json() as T
  }
}
