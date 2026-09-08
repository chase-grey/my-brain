import { describe, expect, it } from 'vitest'
import { task } from './fixtures'
import { buildNowPlan, buildPersonalNowPlan, isDoneToday, thisWeekCommitments, todayCommitments } from './personalNow'

const input = {
  today: '2026-08-28',
  availableMin: 60,
  weeklyCapacityMin: 300,
  energy: 'shallow' as const,
  place: 'home' as const,
  availableNeeds: ['computer', 'phone'] as const,
}

describe('personal Now vertical slice', () => {
  it('narrows surfaced work to a complete plan that fits the stated window', () => {
    const result = buildPersonalNowPlan(
      [
        task({ id: 'planned', taskId: 'planned', title: 'Book dentist', planDate: input.today, estimateMin: 15, priority: 2, needs: ['phone'] }),
        task({ id: 'pinned', taskId: 'pinned', title: 'Order brake pads', pinned: true, estimateMin: 30, priority: 3, needs: ['computer'] }),
        task({ id: 'future', taskId: 'future', title: 'Paint hallway', planDate: '2026-09-02', estimateMin: 45, priority: 1 }),
        task({ id: 'tools', taskId: 'tools', title: 'Fix bike', pinned: true, estimateMin: 45, priority: 1, needs: ['tools'] }),
      ],
      input,
    )

    expect(result.tasks.map((item) => item.id)).toEqual(['planned', 'pinned'])
    expect(result.totalMin).toBe(45)
    expect(result.totalMin).toBeLessThanOrEqual(result.availableMin)
  })

  it('never presents an over-capacity task as fitting', () => {
    const result = buildPersonalNowPlan(
      [task({ id: 'large', taskId: 'large', pinned: true, estimateMin: 90, priority: 1 })],
      input,
    )

    expect(result.tasks).toEqual([])
    expect(result.totalMin).toBe(0)
  })

  it('prefers higher-priority surfaced work when everything cannot fit', () => {
    const result = buildPersonalNowPlan(
      [
        task({ id: 'low', taskId: 'low', pinned: true, estimateMin: 45, priority: 4 }),
        task({ id: 'high', taskId: 'high', pinned: true, estimateMin: 45, priority: 1 }),
      ],
      input,
    )

    expect(result.tasks.map((item) => item.id)).toEqual(['high'])
  })

  it('keeps daily and due commitments out of the optional time-boxed plan', () => {
    const daily = task({ id: 'vitamins', taskId: 'vitamins', recurrence: 'daily', timeWindow: 'morning', estimateMin: 2, place: ['home'] })
    const due = task({ id: 'due', taskId: 'due', dueDate: input.today, estimateMin: 15 })
    const optional = task({ id: 'optional', taskId: 'optional', pinned: true, estimateMin: 30 })

    expect(todayCommitments([optional, due, daily], input.today).map((item) => item.id)).toEqual(['vitamins', 'due'])
    expect(buildPersonalNowPlan([optional, due, daily], input).tasks.map((item) => item.id)).toEqual(['optional'])
  })

  it('shows actionable work due later this week', () => {
    const saturday = task({ id: 'saturday', taskId: 'saturday', dueDate: '2026-08-29' })
    const sunday = task({ id: 'sunday', taskId: 'sunday', dueDate: '2026-08-30' })
    const unavailable = task({ id: 'unavailable', taskId: 'unavailable', dueDate: '2026-08-29', hiddenUntil: '2026-08-29' })
    const nextWeek = task({ id: 'next-week', taskId: 'next-week', dueDate: '2026-08-31' })

    expect(thisWeekCommitments([sunday, nextWeek, unavailable, saturday], input.today).map((item) => item.id)).toEqual(['saturday', 'sunday'])
  })

  it('keeps this week separate from extra time', () => {
    const weekly = task({ id: 'weekly', taskId: 'weekly', dueDate: '2026-08-30', pinned: true })
    const extra = task({ id: 'extra', taskId: 'extra', pinned: true })

    expect(buildPersonalNowPlan([weekly, extra], input).tasks.map((item) => item.id)).toEqual(['extra'])
  })

  it('hides commitments until they become available', () => {
    const hidden = task({ dueDate: input.today, hiddenUntil: '2026-08-29' })
    expect(todayCommitments([hidden], input.today)).toEqual([])
    expect(todayCommitments([hidden], '2026-08-29')).toEqual([hidden])
  })

  it('completes a daily routine for one date without completing it forever', () => {
    const daily = task({ recurrence: 'daily', lastCompletedDate: input.today })
    expect(isDoneToday(daily, input.today)).toBe(true)
    expect(isDoneToday(daily, '2026-08-29')).toBe(false)
  })

  it('keeps work and personal plans separate', () => {
    const personal = task({ id: 'personal', taskId: 'personal', pinned: true, needs: ['phone'] })
    const work = task({ id: 'work', taskId: 'work', domain: 'work', pinned: true, place: ['office'], needs: ['computer'] })

    expect(buildNowPlan([personal, work], { ...input, domain: 'personal', place: 'office' }).tasks.map((item) => item.id)).toEqual(['personal'])
    expect(buildNowPlan([personal, work], { ...input, domain: 'work', place: 'office' }).tasks.map((item) => item.id)).toEqual(['work'])
  })

  it('shows personal phone and computer tasks while at work', () => {
    const phone = task({ id: 'phone', taskId: 'phone', pinned: true, needs: ['phone'] })
    const computer = task({ id: 'computer', taskId: 'computer', pinned: true, needs: ['computer'] })
    const home = task({ id: 'home', taskId: 'home', pinned: true, place: ['home'] })
    const tools = task({ id: 'tools', taskId: 'tools', pinned: true, needs: ['tools'] })

    const result = buildNowPlan([phone, computer, home, tools], {
      ...input,
      domain: 'personal',
      place: 'office',
      availableNeeds: ['computer', 'phone'],
    })

    expect(result.tasks.map((item) => item.id)).toEqual(['computer', 'phone'])
  })
})
