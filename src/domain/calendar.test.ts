import { describe, expect, it } from 'vitest'
import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { Goal } from './types'
import { addDays, blockWindow, busyMinutes, eventsOn, reconcileHeldGoal, timeRange } from './calendar'

const block = (id: string, start: string, end: string, isAllDay = false): CalendarBlock => ({ id, subject: id, start, end, isAllDay })
const goal: Goal = { id: 'g', domain: 'personal', horizon: 'season', title: 'paint the bedroom', funded: true, status: 'active', revisions: [], shape: 'block', scheduledOn: '2026-11-07', calendarEventId: 'e' }

describe('calendar', () => {
  it('holds a block from 1pm for four hours by default', () => {
    expect(blockWindow('2026-11-07')).toEqual({ start: '2026-11-07T13:00:00', end: '2026-11-07T17:00:00' })
    expect(blockWindow('2026-11-07', 2, 9)).toEqual({ start: '2026-11-07T09:00:00', end: '2026-11-07T11:00:00' })
  })

  it('adds days across a month boundary', () => {
    expect(addDays('2026-11-30', 2)).toBe('2026-12-02')
  })

  it('lists a day’s events including multi-day all-day ones and sums busy minutes', () => {
    const blocks = [
      block('dinner', '2026-11-02T18:00:00', '2026-11-02T19:30:00'),
      block('trip', '2026-11-01T00:00:00', '2026-11-03T00:00:00', true),
      block('tomorrow', '2026-11-03T09:00:00', '2026-11-03T10:00:00'),
    ]
    expect(eventsOn(blocks, '2026-11-02').map((item) => item.id)).toEqual(['dinner', 'trip'])
    expect(eventsOn(blocks, '2026-11-03').map((item) => item.id)).toEqual(['tomorrow'])
    expect(busyMinutes(blocks, '2026-11-02')).toBe(90)
  })

  it('formats time ranges without padding', () => {
    expect(timeRange(block('a', '2026-11-02T13:00:00', '2026-11-02T17:30:00'))).toMatch(/^1(:00)?pm–5:30pm$/)
    expect(timeRange(block('a', '2026-11-02T00:00:00', '2026-11-03T00:00:00', true))).toBe('all day')
  })

  it('follows the day moved in outlook and releases a deleted hold', () => {
    expect(reconcileHeldGoal(goal, block('e', '2026-11-07T15:00:00', '2026-11-07T19:00:00'))).toEqual({ kind: 'unchanged' })
    expect(reconcileHeldGoal(goal, block('e', '2026-11-08T13:00:00', '2026-11-08T17:00:00'))).toEqual({ kind: 'moved', scheduledOn: '2026-11-08' })
    expect(reconcileHeldGoal(goal, undefined)).toEqual({ kind: 'released' })
    expect(reconcileHeldGoal({ ...goal, calendarEventId: undefined }, undefined)).toEqual({ kind: 'unchanged' })
  })
})
