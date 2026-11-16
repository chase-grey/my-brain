import type { ProviderTask } from '../domain/types'
import type { Delegation, Ignore, Job, JobLevel, QueuePicks, WorkConfig, WorkSnapshot } from '../work/types'
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

  // Dashboard data: the bridge caches a work snapshot in the vault and rebuilds it hourly or on demand.
  async snapshot(): Promise<WorkSnapshot> {
    return await this.request<WorkSnapshot>('/work/snapshot')
  }

  async refreshSnapshot(): Promise<WorkSnapshot> {
    return await this.request<WorkSnapshot>('/work/refresh', { method: 'POST' })
  }

  async config(): Promise<WorkConfig> {
    return await this.request<WorkConfig>('/work/config')
  }

  async saveConfig(changes: Partial<WorkConfig>): Promise<WorkConfig> {
    return await this.request<WorkConfig>('/work/config', { method: 'PUT', body: JSON.stringify(changes) })
  }

  async ignore(entry: Ignore): Promise<WorkConfig> {
    return await this.request<WorkConfig>('/work/ignores', { method: 'POST', body: JSON.stringify(entry) })
  }

  async unignore(kind: Ignore['kind'], id: string | number): Promise<WorkConfig> {
    return await this.request<WorkConfig>(`/work/ignores/${kind}/${encodeURIComponent(String(id))}`, { method: 'DELETE' })
  }

  // Delegated QANs: a job is one QAN handed to a Claude Code session in Session Runner (docs/work-delegation.md).
  async jobs(): Promise<{ jobs: Job[]; delegation: Delegation }> {
    return await this.request<{ jobs: Job[]; delegation: Delegation }>('/work/jobs')
  }

  /** Records the job and starts its session in Session Runner. */
  async takeQan(qanId: string, title: string, level: JobLevel): Promise<Job> {
    return await this.request<Job>('/work/jobs', { method: 'POST', body: JSON.stringify({ qanId, title, level, launch: true }) })
  }

  async updateJob(qanId: string, changes: Partial<Pick<Job, 'level' | 'state'>>): Promise<Job> {
    return await this.request<Job>(`/work/jobs/${encodeURIComponent(qanId)}`, { method: 'PATCH', body: JSON.stringify(changes) })
  }

  async openJob(qanId: string): Promise<{ job: Job; opened: string }> {
    return await this.request<{ job: Job; opened: string }>(`/work/jobs/${encodeURIComponent(qanId)}/open`, { method: 'POST' })
  }

  async queuePicks(): Promise<QueuePicks> {
    return await this.request<QueuePicks>('/work/queue/picks')
  }

  /** Has Claude rank the queue against my history; takes up to a few minutes. */
  async askQueuePicks(): Promise<QueuePicks> {
    return await this.request<QueuePicks>('/work/queue/picks', { method: 'POST' })
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
