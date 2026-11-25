import { describe, expect, it } from 'vitest'
import {
  AREA_KEEP_DAYS, CHECK_AREAS, areaReading, areaReadings, challengeStanding, dueThings, emptyAreaFields, mindFacts, projectThingId, projectWork, settleAreas, thingsOf,
  withBookFinished, withHappy, withLog, withTap, withoutThing, type AreaFields, type AreaThing, type Challenge,
} from './areas'
import { buildLifeRing } from './lifeRing'
import type { Project } from './types'
import { emptyProductState, loadProductState, saveProductState, scopeProductState, withRestCheckIn, withSawSomeone } from '../productState'

const today = '2026-11-25'
const thing = (overrides: Partial<AreaThing> = {}): AreaThing => ({ id: 'guitar', area: 'creativity', title: 'guitar', ...overrides })
const challenge = (overrides: Partial<Challenge> = {}): Challenge => ({ id: 'c', area: 'purpose', title: 'organizing meetings', target: 2, counts: 'logs', startOn: '2026-11-01', by: '2026-11-30', taps: 0, ...overrides })
const fields = (overrides: Partial<AreaFields> = {}): AreaFields => ({ ...emptyAreaFields, ...overrides })
const project: Project = { id: 'p1', domain: 'personal', title: 'basement', status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: 'build' }

describe('areas judged by answers', () => {
  it('covers purpose, connection, mind, creativity and projects, and leaves body, money and rest to their own readings', () => {
    expect([...CHECK_AREAS]).toEqual(['purpose', 'connection', 'mind', 'creativity', 'projects'])
  })

  it('fills by the answers: happy is full, could be more is half, not happy is nothing', () => {
    const state = fields({ areaThings: [thing({ happy: 'happy', happyOn: today }), thing({ id: 'writing', title: 'writing', happy: 'more', happyOn: today }), thing({ id: 'rap', title: 'rap', happy: 'not', happyOn: today })] })
    const reading = areaReading('creativity', state, today)
    expect(reading.fill).toBeCloseTo(0.5)
    expect(reading.drifting).toBe(true)
    expect(reading.due).toBe(false)
  })

  it('needs no logging: one answer fills the slice with nothing ever logged', () => {
    const reading = areaReading('creativity', fields({ areaThings: [thing({ happy: 'happy', happyOn: today })] }), today)
    expect(reading).toMatchObject({ fill: 1, logged28: 0, drifting: false })
  })

  it('has no fill until something is answered or a challenge is open', () => {
    expect(areaReading('purpose', fields(), today).fill).toBeUndefined()
    expect(areaReading('creativity', fields({ areaThings: [thing()] }), today)).toMatchObject({ due: true })
    expect(areaReading('creativity', fields({ areaThings: [thing()] }), today).fill).toBeUndefined()
  })

  it('calls an answer due after 35 days and keeps the last fill', () => {
    const state = fields({ areaThings: [thing({ happy: 'happy', happyOn: '2026-10-20' })] })
    expect(areaReading('creativity', state, today)).toMatchObject({ fill: 1, due: true })
    expect(areaReading('creativity', fields({ areaThings: [thing({ happy: 'happy', happyOn: '2026-10-22' })] }), today).due).toBe(false)
    expect(dueThings(state, today).map((item) => item.title)).toEqual(['guitar'])
    expect(dueThings(state, today, ['creativity'])).toEqual([])
  })

  it('splits the fill between answers and open challenges, half each', () => {
    const state = fields({ areaThings: [thing({ id: 'm', area: 'purpose', title: 'mentoring', happy: 'happy', happyOn: today })], areaChallenges: [challenge({ target: 4, taps: 1 })] })
    // Day 25 of 30 expects 3.3 of 4; one done is behind and scores 1 / 3.33.
    const reading = areaReading('purpose', state, today)
    expect(reading.challenges[0]).toMatchObject({ state: 'behind', count: 1 })
    expect(reading.fill).toBeCloseTo((1 + 0.3) / 2)
    expect(reading.drifting).toBe(true)
  })

  it('is behind on a challenge only once a whole one short of the straight line', () => {
    // Two by nov 30, set nov 1: on nov 10 the line is at 0.67, so none yet is still on pace.
    expect(challengeStanding(challenge(), fields(), '2026-11-10').state).toBe('on pace')
    expect(challengeStanding(challenge(), fields(), '2026-11-20').state).toBe('behind')
    expect(challengeStanding(challenge({ taps: 1 }), fields(), '2026-11-20').state).toBe('on pace')
  })

  it('counts a log toward every open challenge on the same thing, and taps on top', () => {
    const state = withLog(fields({ areaChallenges: [challenge({ thingId: 'meetings' }), challenge({ id: 'other', thingId: 'mentoring' }), challenge({ id: 'any', thingId: undefined })] }),
      { id: 'l', area: 'purpose', thingId: 'meetings', on: today, note: 'tenant union' }, today)
    const count = (id: string) => challengeStanding(state.areaChallenges.find((item) => item.id === id)!, state, today).count
    expect([count('c'), count('other'), count('any')]).toEqual([1, 0, 1])
    expect(challengeStanding(withTap(state, 'c', 1, today).areaChallenges[0], withTap(state, 'c', 1, today), today)).toMatchObject({ count: 2, state: 'met' })
  })

  it('keeps a dated challenge in the slice until its date and moves it to past after, met or missed', () => {
    const met = challenge({ taps: 2 })
    expect(challengeStanding(met, fields(), today)).toMatchObject({ state: 'met', past: false, score: 1 })
    expect(challengeStanding(met, fields(), '2026-12-01')).toMatchObject({ state: 'met', past: true })
    expect(challengeStanding(challenge({ taps: 1 }), fields(), '2026-12-01')).toMatchObject({ state: 'missed', past: true })
    const reading = areaReading('purpose', fields({ areaChallenges: [challenge({ taps: 1 })] }), '2026-12-01')
    expect(reading.challenges).toHaveLength(0)
    expect(reading.past).toHaveLength(1)
    expect(reading.fill).toBeUndefined()
  })

  it('never calls a count with no date behind, and lets it leave when it is met', () => {
    const songs = challenge({ area: 'creativity', title: 'songs learned', target: 5, by: undefined, taps: 2 })
    expect(challengeStanding(songs, fields(), today)).toMatchObject({ state: 'no date', score: 0.4, past: false })
    expect(challengeStanding({ ...songs, taps: 5 }, fields(), today)).toMatchObject({ state: 'met', past: true })
  })

  it('counts journal days and finished books for a mind challenge without a tap', () => {
    const journal = challenge({ area: 'mind', title: 'journal 3 days', target: 3, counts: 'journal' })
    expect(challengeStanding(journal, fields(), today, { journalDays: ['2026-10-30', '2026-11-02', '2026-11-20', '2026-11-24'] }).count).toBe(3)
    const books = challenge({ id: 'b', area: 'mind', title: 'finish a book', target: 1, counts: 'books' })
    const state = withBookFinished(fields({ areaChallenges: [books], books: [{ id: 'k', title: 'dune', startedOn: '2026-11-02', readOn: [] }] }), 'k', today)
    expect(state.areaChallenges[0].metOn).toBe(today)
    expect(mindFacts(state, today, ['2026-11-24', '2026-09-01'])).toEqual({ journalDays: 1, readDays: 0, booksFinished: 1 })
  })

  it('makes the projects area out of the personal projects still open, and keeps an answer for each', () => {
    const projects = [project, { ...project, id: 'p2', title: 'bike', status: 'done' as const }, { ...project, id: 'p3', title: 'deck', domain: 'work' as const }]
    expect(thingsOf('projects', fields(), projects).map((item) => item.title)).toEqual(['basement'])
    const state = withHappy(fields(), { id: projectThingId('p1'), area: 'projects', title: 'basement' }, 'more', today)
    expect(areaReading('projects', state, today, { projects })).toMatchObject({ fill: 0.5, due: false })
  })

  it('adds up a project\'s finished tasks and the sessions logged by hand over 28 days', () => {
    const state = fields({ areaLogs: [{ id: 'l', area: 'projects', thingId: projectThingId('p1'), on: '2026-11-20', minutes: 90 }, { id: 'old', area: 'projects', thingId: projectThingId('p1'), on: '2026-10-01', minutes: 60 }] })
    const activities = [{ id: 'a', domain: 'personal' as const, kind: 'task-completed' as const, projectId: 'p1', occurredAt: '2026-11-22T15:00:00.000Z', estimateDeltaMin: 30 }]
    expect(projectWork(project, state, activities, today)).toEqual({ tasks: 1, minutes: 120 })
  })

  it('takes the answer with a dropped thing and unties its challenges and logs', () => {
    const state = withoutThing(fields({ areaThings: [thing({ happy: 'happy', happyOn: today })], areaChallenges: [challenge({ area: 'creativity', thingId: 'guitar' })], areaLogs: [{ id: 'l', area: 'creativity', thingId: 'guitar', on: today }] }), 'guitar')
    expect(state.areaThings).toEqual([])
    expect(state.areaChallenges[0].thingId).toBeUndefined()
    expect(state.areaLogs[0].thingId).toBeUndefined()
  })

  it('lets old records leave: a year of daily logs and finished challenges settles to the last 400 days', () => {
    const day = (back: number) => new Date(Date.parse(`${today}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10)
    const logs = Array.from({ length: 800 }, (_, index) => ({ id: `l${index}`, area: 'purpose' as const, on: day(index) }))
    const challenges = Array.from({ length: 30 }, (_, index) => challenge({ id: `c${index}`, startOn: day(index * 30 + 29), by: day(index * 30) }))
    const settled = settleAreas(fields({ areaLogs: logs, areaChallenges: challenges }), today)
    expect(settled.areaLogs).toHaveLength(AREA_KEEP_DAYS)
    expect(settled.areaChallenges).toHaveLength(14)
    expect(settleAreas(settled, today)).toBe(settled)
  })
})

describe('the wheel', () => {
  it('reads the five areas from their answers, never from a 28-day target', () => {
    const state = fields({ areaThings: [thing({ happy: 'not', happyOn: '2026-10-01' })] })
    const ring = buildLifeRing([{ domain: 'creativity', on: '2026-11-20', value: 9 }], [{ domain: 'creativity', commitment28: 4 }], today, [], undefined, { areas: areaReadings(state, today) })
    expect(ring.find((arc) => arc.domain === 'creativity')).toMatchObject({ fill: 0, focus: true, stale: true })
    expect(ring.find((arc) => arc.domain === 'purpose')).toMatchObject({ state: 'dormant', focus: false })
    expect(ring.find((arc) => arc.domain === 'purpose')?.fill).toBeUndefined()
  })
})

describe('keeping it', () => {
  it('saves the areas with the personal space and never with work', () => {
    const state = { ...emptyProductState, habits: [], areaThings: [thing({ happy: 'happy', happyOn: today })], books: [{ id: 'k', title: 'dune', startedOn: today, readOn: [] }] }
    expect(scopeProductState(state, 'work')).toMatchObject({ areaThings: [], books: [], areaLogs: [], areaChallenges: [] })
    const store = new Map<string, string>()
    globalThis.localStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) } } as Storage
    saveProductState(state, 'personal')
    expect(loadProductState('personal', false).areaThings).toEqual(state.areaThings)
    saveProductState(state, 'work')
    expect(loadProductState('work', false).areaThings).toEqual([])
  })

  it('logs "saw someone" once: the person, the contact, and a connection log that moves a challenge', () => {
    const start = { ...emptyProductState, areaChallenges: [challenge({ area: 'connection', title: 'see friends', target: 1 })] }
    const state = withSawSomeone(withSawSomeone(start, 'Sam', '2026-11-20'), 'Sam', today)
    expect(state.people).toHaveLength(1)
    expect(state.people[0]).toMatchObject({ displayName: 'Sam', lastSeenOn: today })
    expect(state.areaLogs).toHaveLength(2)
    expect(state.areaChallenges[0].metOn).toBe('2026-11-20')
  })

  it('keeps one felt rating for a month: a second inside 28 days replaces the first', () => {
    const once = withRestCheckIn(emptyProductState, 4, '2026-11-10')
    const twice = withRestCheckIn(once, 7, today)
    expect(twice.restCheckIns).toHaveLength(1)
    expect(twice.restCheckIns[0]).toMatchObject({ rating: 7, periodEnd: '2026-11-10' })
    expect(twice.ringEvidence.filter((item) => item.domain === 'rest')).toEqual([{ domain: 'rest', on: '2026-11-10', value: 7 }])
    expect(withRestCheckIn(twice, 5, '2026-12-20').restCheckIns).toHaveLength(2)
  })
})
