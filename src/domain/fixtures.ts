import type { Task } from './types'

export function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    taskId: 'task-1',
    domain: 'personal',
    title: 'Default task',
    completed: false,
    estimateMin: 30,
    originalEstimateMin: 30,
    priority: 3,
    energy: 'shallow',
    pinned: false,
    carries: 0,
    ...overrides,
  }
}
