import type { StoreType, Task } from './types'

export const storeOptions: { value: StoreType; label: string; shortLabel: string }[] = [
  { value: 'grocery', label: 'Grocery store', shortLabel: 'Grocery' },
  { value: 'amazon', label: 'Amazon', shortLabel: 'Amazon' },
  { value: 'hardware', label: 'Hardware store', shortLabel: 'Hardware' },
  { value: 'other', label: 'Other', shortLabel: 'Other' },
]

export function storeLabel(storeType: StoreType): string {
  return storeOptions.find((option) => option.value === storeType)?.shortLabel ?? storeType
}

export function visibleStoreItems(tasks: Task[], storeType: StoreType): Task[] {
  return tasks
    .filter((task) => task.domain === 'personal' && task.storeType === storeType)
    .filter((task) => storeType === 'grocery' || !task.completed)
    .sort((a, b) => Number(a.completed) - Number(b.completed))
}
