import { describe, expect, it } from 'vitest'
import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { Goal } from './types'
import { addDays, blockWindow, busyMinutes, eventsOn, fittingMinutes, freeNow, keptPick, reconcileHeldGoal, timeNow, timeRange } from './calendar'

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

  it('reads the time free right now from the calendar', () => {
    const at = (time: string) => new Date(`2026-11-02T${time}:00`)
    const blocks = [
      block('trip', '2026-11-01T00:00:00', '2026-11-03T00:00:00', true),
      block('standup', '2026-11-02T09:00:00', '2026-11-02T09:30:00'),
      block('review', '2026-11-02T09:30:00', '2026-11-02T10:15:00'),
      block('dinner', '2026-11-02T18:00:00', '2026-11-02T19:30:00'),
      block('tomorrow', '2026-11-03T09:00:00', '2026-11-03T10:00:00'),
    ]
    expect(freeNow(blocks, at('08:13'))).toEqual({ freeMin: 47, nextStart: '2026-11-02T09:00:00' })
    // Back-to-back events are one stretch: busy until the last of them ends.
    expect(freeNow(blocks, at('09:10'))).toEqual({ busyUntil: '2026-11-02T10:15:00' })
    expect(freeNow(blocks, at('10:15'))).toEqual({ freeMin: 465, nextStart: '2026-11-02T18:00:00' })
    // Nothing later before 9pm: clear until then, and tomorrow's events are not today's.
    expect(freeNow(blocks, at('19:30'))).toEqual({ freeMin: 90, nextStart: undefined })
    // An event after 9pm is past the day's end, so it does not shorten the stretch.
    expect(freeNow([block('late', '2026-11-02T21:30:00', '2026-11-02T22:00:00')], at('20:00'))).toEqual({ freeMin: 60, nextStart: undefined })
    // Neither does one shown as free.
    expect(freeNow([{ ...block('hold', '2026-11-02T12:30:00', '2026-11-02T13:30:00'), free: true }, block('sync', '2026-11-02T14:00:00', '2026-11-02T14:30:00')], at('12:45'))).toEqual({ freeMin: 75, nextStart: '2026-11-02T14:00:00' })
    // An all-day event holds no time.
    expect(freeNow([blocks[0]], at('12:00'))).toEqual({ freeMin: 540, nextStart: undefined })
  })

  it('ends time for tasks at 9pm unless a length is picked after that', () => {
    const at = (time: string, day = '02') => new Date(`2026-11-${day}T${time}:00`)
    const options = [30, 60, 120] as const
    expect(freeNow([], at('20:59'))).toEqual({ freeMin: 1, nextStart: undefined })
    expect(freeNow([], at('21:00'))).toEqual({ dayOver: true })
    expect(fittingMinutes({ dayOver: true }, options, 60)).toBe(0)
    // With no calendar, as at work, the day still ends.
    expect(timeNow(undefined, at('14:00'))).toBeUndefined()
    expect(timeNow(undefined, at('21:05'))).toEqual({ dayOver: true })
    // A length picked in the afternoon lasts until 9pm and no further; one picked after 9pm stands.
    expect(keptPick({ min: 120, at: at('15:00').getTime() }, at('20:30'))).toBe(120)
    expect(keptPick({ min: 120, at: at('15:00').getTime() }, at('21:10'))).toBeUndefined()
    expect(keptPick({ min: 60, at: at('21:15').getTime() }, at('22:00'))).toBe(60)
    // And none carries into the next day.
    expect(keptPick({ min: 60, at: at('21:15').getTime() }, at('08:00', '03'))).toBeUndefined()
    expect(keptPick(undefined, at('08:00'))).toBeUndefined()
  })

  it('starts the time picker on the longest choice that fits', () => {
    const options = [30, 60, 120] as const
    expect(fittingMinutes(undefined, options, 60)).toBe(60)
    expect(fittingMinutes({ busyUntil: '2026-11-02T10:15:00' }, options, 60)).toBe(30)
    expect(fittingMinutes({ freeMin: 12 }, options, 60)).toBe(30)
    expect(fittingMinutes({ freeMin: 47 }, options, 60)).toBe(30)
    expect(fittingMinutes({ freeMin: 60 }, options, 60)).toBe(60)
    expect(fittingMinutes({ freeMin: 119 }, options, 60)).toBe(60)
    expect(fittingMinutes({ freeMin: 465 }, options, 60)).toBe(120)
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
