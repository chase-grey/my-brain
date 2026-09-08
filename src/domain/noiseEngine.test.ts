import { describe, expect, it } from 'vitest'
import { task } from './fixtures'
import { leadDays, surfaceDate, surfaces } from './noiseEngine'

const today = '2026-08-28'
const weeklyCapacityMin = 300

describe('leadDays', () => {
  it('uses the priority floor for a small task', () => {
    expect(leadDays(task({ estimateMin: 30, priority: 1 }), weeklyCapacityMin)).toBe(10)
  })

  it('expands lead time from estimate and capacity, capped at 30 days', () => {
    expect(leadDays(task({ estimateMin: 600, priority: 3 }), weeklyCapacityMin)).toBe(21)
    expect(leadDays(task({ estimateMin: 3_000, priority: 4 }), weeklyCapacityMin)).toBe(30)
  })
})

describe('surfaceDate', () => {
  it('subtracts derived lead days from a real due date', () => {
    expect(
      surfaceDate(task({ dueDate: '2026-09-18', estimateMin: 600, priority: 3 }), weeklyCapacityMin),
    ).toBe(today)
  })

  it('has no value when the provider task has no due date', () => {
    expect(surfaceDate(task(), weeklyCapacityMin)).toBeUndefined()
  })
})

describe('surfaces', () => {
  it('lets hiddenUntil override every positive rule', () => {
    expect(
      surfaces(task({ pinned: true, planDate: today, hiddenUntil: '2026-08-29' }), today, weeklyCapacityMin),
    ).toBe(false)
  })

  it('surfaces pinned and planned tasks', () => {
    expect(surfaces(task({ pinned: true }), today, weeklyCapacityMin)).toBe(true)
    expect(surfaces(task({ planDate: today }), today, weeklyCapacityMin)).toBe(true)
  })

  it('surfaces a large future task when its derived warning window opens', () => {
    expect(
      surfaces(
        task({ dueDate: '2026-09-18', estimateMin: 600, priority: 3 }),
        today,
        weeklyCapacityMin,
      ),
    ).toBe(true)
  })

  it('does not surface completed or genuinely future work', () => {
    expect(surfaces(task({ completed: true, pinned: true }), today, weeklyCapacityMin)).toBe(false)
    expect(surfaces(task({ planDate: '2026-08-29' }), today, weeklyCapacityMin)).toBe(false)
  })
})
