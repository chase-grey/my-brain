import type { ProviderTask, TaskMeta } from './domain/types'

function isoToday(): string {
  return new Date().toLocaleDateString('en-CA')
}

const today = isoToday()

export const demoProviderTasks: ProviderTask[] = [
  { id: 'dentist', domain: 'personal', title: 'Book the dentist', completed: false },
  { id: 'brake-pads', domain: 'personal', title: 'Bike brake pads', completed: false },
  { id: 'north-wall', domain: 'personal', title: 'Finish the north wall', completed: false },
  { id: 'groceries', domain: 'personal', title: 'Milk', completed: false },
  { id: 'inbox-new', domain: 'personal', title: 'New task from Microsoft To-Do', completed: false },
]

export const demoTaskMetadata: TaskMeta[] = [
  {
    taskId: 'dentist',
    domain: 'personal',
    estimateMin: 15,
    originalEstimateMin: 15,
    priority: 2,
    planDate: today,
    energy: 'shallow',
    needs: ['phone'],
    pinned: false,
    carries: 0,
  },
  {
    taskId: 'brake-pads',
    domain: 'personal',
    estimateMin: 30,
    originalEstimateMin: 30,
    priority: 3,
    energy: 'shallow',
    needs: ['computer'],
    storeType: 'amazon',
    pinned: true,
    carries: 1,
  },
  {
    taskId: 'north-wall',
    domain: 'personal',
    estimateMin: 90,
    originalEstimateMin: 120,
    priority: 2,
    planDate: today,
    energy: 'deep',
    place: ['home'],
    pinned: false,
    carries: 0,
  },
  {
    taskId: 'groceries',
    domain: 'personal',
    estimateMin: 35,
    originalEstimateMin: 35,
    priority: 3,
    planDate: today,
    energy: 'errand',
    place: ['out'],
    needs: ['car', 'store'],
    storeType: 'grocery',
    pinned: false,
    carries: 0,
  },
]
