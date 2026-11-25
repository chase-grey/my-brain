import { describe, expect, it } from 'vitest'
import { buildLifeRing } from './lifeRing'
import { bedClock, bedFromTime, bedToTime, mergeRestDays, restReading, type RestDay } from './rest'

const goals = { sleepMin: 420, screenMaxMin: 180 }

describe('rest slice from the phone', () => {
  it('fills by the share of nights with enough sleep and days under the screen time limit', () => {
    const days: RestDay[] = [
      { day: '2026-11-21', sleepMin: 450, screenMin: 150 },
      { day: '2026-11-22', sleepMin: 400, screenMin: 200 },
      { day: '2026-11-23', sleepMin: 430, screenMin: 170 },
      { day: '2026-11-24', sleepMin: 300, screenMin: 240 },
    ]
    expect(restReading(days, goals, '2026-11-25')).toEqual({
      fill: 0.5,
      sleep: { met: 2, judged: 4, averageMin: 395, goalMin: 420 },
      screen: { met: 2, judged: 4, averageMin: 190, goalMin: 180 },
      daysTracked: 4,
    })
  })

  it('leaves out today\'s screen time, which is still running, but counts last night', () => {
    const reading = restReading([{ day: '2026-11-24', sleepMin: 450, screenMin: 100 }, { day: '2026-11-25', sleepMin: 450, screenMin: 20 }], goals, '2026-11-25')!
    expect(reading.sleep).toMatchObject({ judged: 2 })
    expect(reading.screen).toMatchObject({ judged: 1 })
  })

  it('leaves out a day the phone has nothing for rather than calling it missed', () => {
    const reading = restReading([{ day: '2026-11-10', sleepMin: 450 }, { day: '2026-11-20', sleepMin: 450 }], goals, '2026-11-25')!
    expect(reading).toMatchObject({ fill: 1, sleep: { met: 2, judged: 2 } })
    expect(reading.screen).toBeUndefined()
  })

  it('reads only the last 28 days', () => {
    const reading = restReading([{ day: '2026-10-20', sleepMin: 100 }, { day: '2026-11-20', sleepMin: 450 }], goals, '2026-11-25')!
    expect(reading.sleep).toMatchObject({ met: 1, judged: 1 })
  })

  it('is absent without a goal or without days, so rest works like any other area', () => {
    expect(restReading([{ day: '2026-11-24', sleepMin: 450, screenMin: 100 }], {}, '2026-11-25')).toBeUndefined()
    expect(restReading([], goals, '2026-11-25')).toBeUndefined()
    expect(buildLifeRing([], [], '2026-11-25').find((arc) => arc.domain === 'rest')).toMatchObject({ state: 'dormant' })
  })

  it('takes over the rest slice from the 28-day target', () => {
    const rest = restReading([{ day: '2026-11-24', sleepMin: 450 }], { sleepMin: 420 }, '2026-11-25')
    expect(buildLifeRing([], [], '2026-11-25', [], undefined, { rest }).find((arc) => arc.domain === 'rest')).toMatchObject({ fill: 1, state: 'establishing' })
  })

  it('folds a reading into the days kept: the phone wins for a day it reports and the rest stay', () => {
    const kept: RestDay[] = [{ day: '2026-11-20', sleepMin: 400, screenMin: 100 }, { day: '2026-11-21', screenMin: 90 }]
    const read: RestDay[] = [{ day: '2026-11-21', sleepMin: 431.6, screenMin: 120 }, { day: '2026-11-22', sleepMin: 440 }, { day: '2026-11-30', sleepMin: 1 }, { day: 'junk', sleepMin: 1 }, { day: '2026-11-23' }]
    expect(mergeRestDays(kept, read, '2026-11-25')).toEqual([
      { day: '2026-11-20', sleepMin: 400, screenMin: 100 },
      { day: '2026-11-21', sleepMin: 432, screenMin: 120 },
      { day: '2026-11-22', sleepMin: 440 },
    ])
  })

  it('drops days past 400 so the list cannot grow without end', () => {
    const kept: RestDay[] = Array.from({ length: 900 }, (_, index) => ({ day: new Date(Date.UTC(2024, 5, 1) + index * 86_400_000).toISOString().slice(0, 10), sleepMin: 420 }))
    const merged = mergeRestDays(kept, [], '2026-11-25')
    expect(merged.length).toBe(392)
    expect(merged[0].day).toBe('2025-10-22')
  })
})

describe('bedtime', () => {
  it('counts the nights asleep by the time set, as a third equal part of the slice', () => {
    // 690 is 11:30pm, 750 is 12:30am.
    const days: RestDay[] = [{ day: '2026-11-23', sleepMin: 450, bedMin: 660 }, { day: '2026-11-24', sleepMin: 450, bedMin: 750 }]
    const reading = restReading(days, { sleepMin: 420, bedByMin: 690 }, '2026-11-25')!
    expect(reading.bed).toEqual({ met: 1, judged: 2, averageMin: 705, goalMin: 690 })
    expect(reading.fill).toBeCloseTo(0.75)
  })

  it('says nothing about bedtime until the phone sends one', () => {
    expect(restReading([{ day: '2026-11-24', sleepMin: 450 }], { sleepMin: 420, bedByMin: 690 }, '2026-11-25')!.bed).toBeUndefined()
    expect(mergeRestDays([], [{ day: '2026-11-24', sleepMin: 450, bedMin: 700 }], '2026-11-25')[0].bedMin).toBe(700)
  })

  it('reads minutes after noon as a clock time and back', () => {
    expect([bedClock(690), bedClock(750), bedClock(600)]).toEqual(['11:30pm', '12:30am', '10pm'])
    expect(bedFromTime('23:30')).toBe(690)
    expect(bedToTime(750)).toBe('00:30')
  })
})
