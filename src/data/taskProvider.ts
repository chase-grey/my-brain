import type { ProviderTask } from '../domain/types'

// Notes travel only where the provider keeps a body for them (Outlook); To Do ignores them.
export type NewProviderTask = Pick<ProviderTask, 'title' | 'dueDate'> & { notes?: string }
export type ProviderTaskChanges = Partial<Pick<ProviderTask, 'title' | 'dueDate' | 'completed'>> & { notes?: string }

export interface TaskProvider {
  listTasks(): Promise<ProviderTask[]>
  createTask(listId: string, task: NewProviderTask): Promise<ProviderTask>
  updateTask(task: ProviderTask, changes: ProviderTaskChanges): Promise<ProviderTask>
}
