import type { Activity, Commitment, DayOverride, Mode } from './types'
import { clearedEstimateMin } from './planning'

export type WeekReceipt = {
  plannedMin: number
  clearedMin: number
  remainingMin: number
  byMode: Record<Mode, number>
  blocksHeld: number
  blocksUsed: number
  paid: boolean
}

export function buildWeekReceipt(commitment: Commitment, activities: Activity[], overrides: DayOverride[]): WeekReceipt {
  const end = new Date(`${commitment.weekStart}T00:00:00Z`)
  end.setUTCDate(end.getUTCDate() + 7)
  const weekEnd = end.toISOString().slice(0, 10)
  activities = activities.filter((item) => item.domain === commitment.domain && item.occurredAt.slice(0, 10) >= commitment.weekStart && item.occurredAt.slice(0, 10) < weekEnd)
  overrides = overrides.filter((item) => item.domain === commitment.domain && item.date >= commitment.weekStart && item.date < weekEnd)
  const clearedMin = clearedEstimateMin(activities, commitment.weekStart)
  const byMode = activities.reduce<Record<Mode, number>>((totals, activity) => {
    if (activity.mode) totals[activity.mode] = (totals[activity.mode] ?? 0) + (activity.estimateDeltaMin ?? activity.minutes ?? 0)
    return totals
  }, {})
  const held = overrides.filter((item) => item.domain === commitment.domain && item.kind === 'held')
  return {
    plannedMin: commitment.targetMin,
    clearedMin,
    remainingMin: Math.max(0, commitment.targetMin - clearedMin),
    byMode,
    blocksHeld: held.length,
    blocksUsed: held.filter((item) => item.calendarEventId).length,
    paid: clearedMin >= commitment.targetMin,
  }
}
