import type { StoreType, Task } from './types'

export const storeOptions: { value: StoreType; label: string; shortLabel: string }[] = [
  { value: 'grocery', label: 'Grocery store', shortLabel: 'Grocery' },
  { value: 'online', label: 'Online', shortLabel: 'Online' },
  { value: 'hardware', label: 'Hardware store', shortLabel: 'Hardware' },
  { value: 'thrift', label: 'Thrift store', shortLabel: 'Thrift' },
  { value: 'other', label: 'Other', shortLabel: 'Other' },
]

/** A store saved under a name it no longer has is read as the one it has now. */
export function currentStore(storeType: string | undefined): StoreType | undefined {
  if (storeType === 'amazon') return 'online'
  if (storeType === 'general') return 'other'
  return storeType as StoreType | undefined
}

export function storeLabel(storeType: StoreType): string {
  return storeOptions.find((option) => option.value === storeType)?.shortLabel ?? storeType
}

export function visibleStoreItems(tasks: Task[], storeType: StoreType): Task[] {
  return tasks
    .filter((task) => task.domain === 'personal' && task.storeType === storeType)
    .filter((task) => storeType === 'grocery' || !task.completed)
    .sort((a, b) => Number(a.completed) - Number(b.completed))
}
