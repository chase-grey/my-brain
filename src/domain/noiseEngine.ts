import type { Priority, Task } from './types'

export const SPREAD = 1.5
export const MAX_LEAD_DAYS = 30
export const MIN_LEAD_DAYS: Record<Priority, number> = {
  1: 10,
  2: 5,
  3: 2,
  4: 0,
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected an ISO date, received ${value}`)
  }
}

function addDays(isoDate: string, amount: number): string {
  assertIsoDate(isoDate)
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function leadDays(task: Task, weeklyCapacityMin: number): number {
  if (!Number.isFinite(weeklyCapacityMin) || weeklyCapacityMin <= 0) {
    throw new Error('weeklyCapacityMin must be greater than zero')
  }

  const effortLead = Math.ceil((task.estimateMin / weeklyCapacityMin) * 7 * SPREAD)
  return Math.min(MAX_LEAD_DAYS, Math.max(MIN_LEAD_DAYS[task.priority], effortLead))
}

export function surfaceDate(task: Task, weeklyCapacityMin: number): string | undefined {
  if (!task.dueDate) return undefined
  return addDays(task.dueDate, -leadDays(task, weeklyCapacityMin))
}

export function surfaces(task: Task, today: string, weeklyCapacityMin: number): boolean {
  assertIsoDate(today)
  if (task.completed) return false
  if (task.hiddenUntil && today < task.hiddenUntil) return false
  if (task.pinned) return true
  if (task.planDate && task.planDate <= today) return true

  const startsSurfacing = surfaceDate(task, weeklyCapacityMin)
  return startsSurfacing !== undefined && today >= startsSurfacing
}
