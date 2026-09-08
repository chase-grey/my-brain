import type { Commitment, TravelWindow } from './types'

export type WeekResult = {
  weekStart: string
  clearedMin: number
  targetMin: number
  tier: 'missed' | 'half' | 'met' | 'surplus'
}

export type StreakState = {
  weeks: number
  freezes: number
  freezeSpent: boolean
}

export function weekTier(clearedMin: number, commitment: Commitment): WeekResult['tier'] {
  if (clearedMin >= commitment.targetMin * 1.25) return 'surplus'
  if (clearedMin >= commitment.targetMin) return 'met'
  if (clearedMin >= commitment.halfTargetMin) return 'half'
  return 'missed'
}

export function travelFactor(windows: TravelWindow[], weekStart: string, domain: Commitment['domain']): number {
  const weekEnd = new Date(`${weekStart}T00:00:00Z`)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const end = weekEnd.toISOString().slice(0, 10)
  return windows
    .filter((window) => window.domain === domain && window.start <= end && window.end >= weekStart)
    .reduce((factor, window) => Math.min(factor, window.capacityFactor), 1)
}

export function applyWeek(state: StreakState, tier: WeekResult['tier'], capacityFactor = 1): StreakState {
  if (capacityFactor === 0) return { ...state, freezeSpent: false }
  if (tier === 'surplus') return { weeks: state.weeks + 1, freezes: state.freezes + 1, freezeSpent: false }
  if (tier === 'met' || tier === 'half') return { ...state, weeks: state.weeks + 1, freezeSpent: false }
  if (state.freezes > 0) return { ...state, weeks: state.weeks + 1, freezes: state.freezes - 1, freezeSpent: true }
  return { weeks: 0, freezes: 0, freezeSpent: false }
}
