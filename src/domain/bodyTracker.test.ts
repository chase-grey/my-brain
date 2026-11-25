import { afterEach, describe, expect, it, vi } from 'vitest'
import { bodyReading, fetchTrackerSummary, newerSummary, parseTrackerSummary, signInToTracker, type TrackerSummary } from './bodyTracker'
import { buildLifeRing } from './lifeRing'

const hit = (week: string, inProgress = false) => ({ week, result: 'hit' as const, ...(inProgress ? { inProgress } : {}) })
const summary = (over: Partial<TrackerSummary> = {}): TrackerSummary => ({
  v: 1, asOf: '2026-11-24', streak: 11, freezes: 4, weeksTracked: 16,
  weeks: [hit('2026-10-19'), hit('2026-10-26'), hit('2026-11-02'), hit('2026-11-09'), hit('2026-11-16')],
  goals: { open: 3, onPace: 3, met: 1 },
  ...over,
})

describe('body slice from workout-tracker', () => {
  it('fills the slice when the last four weeks were hit and every committed goal is on pace', () => {
    expect(bodyReading(summary(), '2026-11-24')).toEqual({ fill: 1, weeksHit: 4, weeksJudged: 4, streak: 11, goalsOpen: 3, goalsOnPace: 3, goalsMet: 1, weeksTracked: 16 })
  })

  it('counts the week being lived once the tracker calls it hit', () => {
    const reading = bodyReading(summary({ weeks: [...summary().weeks.slice(1, 4), { week: '2026-11-16', result: 'missed' }, hit('2026-11-23', true)], streak: 1 }), '2026-11-24')
    expect(reading).toMatchObject({ weeksHit: 3, weeksJudged: 4, streak: 1 })
  })

  it('scores a week saved by freezes a half and a missed week nothing', () => {
    const weeks = [hit('2026-10-26'), { week: '2026-11-02', result: 'froze' as const }, { week: '2026-11-09', result: 'missed' as const }, hit('2026-11-16')]
    expect(bodyReading(summary({ weeks, goals: { open: 0, onPace: 0, met: 0 } }), '2026-11-24').fill).toBe(0.625)
  })

  it('splits the fill between the weeks and the committed goals', () => {
    expect(bodyReading(summary({ goals: { open: 4, onPace: 1, met: 0 } }), '2026-11-24').fill).toBe(0.625)
  })

  it('reads the weeks alone when no goal is committed', () => {
    expect(bodyReading(summary({ goals: { open: 0, onPace: 0, met: 2 } }), '2026-11-24').fill).toBe(1)
  })

  it('counts a week the tracker never reported as missed and stops claiming the streak', () => {
    const reading = bodyReading(summary({ asOf: '2026-11-18' }), '2026-12-09')
    expect(reading).toMatchObject({ weeksHit: 2, weeksJudged: 4 })
    expect(reading.streak).toBeUndefined()
    expect(bodyReading(summary({ asOf: '2026-11-18' }), '2027-02-01').fill).toBe(0.5)
  })

  it('judges a new tracker on the weeks it has', () => {
    const reading = bodyReading(summary({ weeks: [hit('2026-11-16')], streak: 1, weeksTracked: 1, goals: { open: 0, onPace: 0, met: 0 } }), '2026-11-24')
    expect(reading).toMatchObject({ fill: 1, weeksHit: 1, weeksJudged: 1 })
  })

  it('follows a week that does not start on monday', () => {
    const weeks = ['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15'].map((week) => hit(week))
    expect(bodyReading(summary({ weeks, asOf: '2026-11-20' }), '2026-11-21')).toMatchObject({ weeksHit: 4, weeksJudged: 4, streak: 11 })
    expect(bodyReading(summary({ weeks, asOf: '2026-11-20' }), '2026-11-22')).toMatchObject({ weeksHit: 4, weeksJudged: 4, streak: 11 })
    expect(bodyReading(summary({ weeks, asOf: '2026-11-20' }), '2026-11-29')).toMatchObject({ weeksHit: 3, weeksJudged: 4 })
  })

  it('ignores a summary it cannot read', () => {
    expect(parseTrackerSummary(null)).toBeUndefined()
    expect(parseTrackerSummary('not json')).toBeUndefined()
    expect(parseTrackerSummary(JSON.stringify({ ...summary(), v: 2 }))).toBeUndefined()
    expect(parseTrackerSummary(JSON.stringify({ ...summary(), weeks: [] }))).toBeUndefined()
    expect(parseTrackerSummary(JSON.stringify({ ...summary(), weeks: [{ week: 'nov 16', result: 'hit' }] }))).toBeUndefined()
    expect(parseTrackerSummary(JSON.stringify(summary()))).toEqual(summary())
  })

  it('needs no 28-day target and leaves the other slices alone', () => {
    const ring = buildLifeRing([], [], '2026-11-24', [], bodyReading(summary(), '2026-11-24'))
    expect(ring.find((arc) => arc.domain === 'body')).toMatchObject({ fill: 1, state: 'early-signal', focus: false })
    expect(ring.find((arc) => arc.domain === 'mind')).toMatchObject({ state: 'dormant' })
    expect(buildLifeRing([], [], '2026-11-24', ['body'], bodyReading(summary(), '2026-11-24')).some((arc) => arc.domain === 'body')).toBe(false)
  })
})

describe('reading the summary across devices', () => {
  const stub = (body: unknown, ok = true) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok, json: async () => body }))
  afterEach(() => vi.unstubAllGlobals())

  it('asks the tracker for the account the key names', async () => {
    stub(summary())
    expect(await fetchTrackerSummary('key-1')).toEqual(summary())
    const asked = new URL(vi.mocked(fetch).mock.calls[0][0] as string)
    expect(asked.searchParams.get('route')).toBe('share')
    expect(asked.searchParams.get('user')).toBe('key-1')
  })

  it('has nothing when no summary is posted, the backend is older, or it cannot be reached', async () => {
    stub(null)
    expect(await fetchTrackerSummary('key-1')).toBeUndefined()
    stub({ error: 'Unknown route' })
    expect(await fetchTrackerSummary('key-1')).toBeUndefined()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await fetchTrackerSummary('key-1')).toBeUndefined()
  })

  it('keeps whichever summary is later, and the account one on a tie', () => {
    const older = summary({ asOf: '2026-11-20', streak: 10 })
    const remote = summary({ streak: 12 })
    expect(newerSummary(older, summary())).toEqual(summary())
    expect(newerSummary(summary(), older)).toEqual(summary())
    expect(newerSummary(summary(), remote)).toEqual(remote)
    expect(newerSummary(summary(), undefined)).toEqual(summary())
    expect(newerSummary(undefined, undefined)).toBeUndefined()
  })

  it('signs in for the account key and says why when it cannot', async () => {
    stub({ saved: 1, token: ' key-1 ', name: 'someone', owner: true })
    expect(await signInToTracker('a@example.com', 'pw')).toBe('key-1')
    stub({ error: 'Wrong email or password' })
    await expect(signInToTracker('a@example.com', 'pw')).rejects.toThrow('wrong email or password')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(signInToTracker('a@example.com', 'pw')).rejects.toThrow('could not reach workout tracker')
  })
})
