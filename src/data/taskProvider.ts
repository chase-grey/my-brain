import type { ProviderTask } from '../domain/types'

export type NewProviderTask = Pick<ProviderTask, 'title' | 'dueDate'>
export type ProviderTaskChanges = Partial<Pick<ProviderTask, 'title' | 'dueDate' | 'completed'>>

export interface TaskProvider {
  listTasks(): Promise<ProviderTask[]>
  createTask(listId: string, task: NewProviderTask): Promise<ProviderTask>
  updateTask(task: ProviderTask, changes: ProviderTaskChanges): Promise<ProviderTask>
}
