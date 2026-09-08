import { describe, expect, it } from 'vitest'
import { applyWeek, travelFactor, weekTier } from './streaks'
import type { Commitment } from './types'

const commitment: Commitment = { weekStart: '2026-09-07', domain: 'personal', targetMin: 240, halfTargetMin: 120, strategicMin: 0, habitDaysRequired: 0, maintenance: [], ceilingMin: 300 }

describe('weekly streaks', () => {
  it('assigns tiers and banks surplus', () => {
    expect(weekTier(300, commitment)).toBe('surplus')
    expect(applyWeek({ weeks: 2, freezes: 0, freezeSpent: false }, 'surplus')).toEqual({ weeks: 3, freezes: 1, freezeSpent: false })
  })

  it('spends a freeze on a miss', () => {
    expect(applyWeek({ weeks: 4, freezes: 1, freezeSpent: false }, 'missed')).toEqual({ weeks: 5, freezes: 0, freezeSpent: true })
  })

  it('does not judge a zero-capacity travel week', () => {
    const factor = travelFactor([{ id: 'x', domain: 'personal', start: '2026-09-08', end: '2026-09-12', capacityFactor: 0, label: 'away' }], '2026-09-07', 'personal')
    expect(factor).toBe(0)
    expect(applyWeek({ weeks: 4, freezes: 0, freezeSpent: false }, 'missed', factor).weeks).toBe(4)
  })
})
