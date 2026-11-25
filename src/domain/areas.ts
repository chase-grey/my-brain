// Purpose, connection, mind, creativity and projects are judged by Chase, not counted (2026-11-25).
// Each holds the things he names in it; each thing carries his answer to "happy with how often", asked again once
// a month. A thing can carry a streak he types in. A challenge is a count toward a target, with or without a date.
// Logging is optional: a log is a record, and it moves any open challenge on the same thing.

import type { Activity, LifeDomain, Project } from './types'

export const CHECK_AREAS = ['purpose', 'connection', 'mind', 'creativity', 'projects'] as const
export type CheckArea = typeof CHECK_AREAS[number]
export const isCheckArea = (area: LifeDomain): area is CheckArea => (CHECK_AREAS as readonly string[]).includes(area)

export type Happy = 'happy' | 'more' | 'not'
export const HAPPY: Happy[] = ['happy', 'more', 'not']
export const happyLabels: Record<Happy, string> = { happy: 'happy', more: 'could be more', not: 'not happy' }
const happyScore: Record<Happy, number> = { happy: 1, more: 0.5, not: 0 }

/** An answer older than this is due again: the slice dims and keeps its last fill. */
export const CHECK_STALE_DAYS = 35
/** Logs, and challenges that are over, are kept this long; a year of reviews needs no more. */
export const AREA_KEEP_DAYS = 400

export type AreaThing = {
  id: string
  area: CheckArea
  title: string
  happy?: Happy
  /** The day the answer was given. */
  happyOn?: string
  /** A run kept somewhere else (a language app), typed in whenever. Never ticked daily here. */
  streak?: number
  streakOn?: string
}

/** What moves a challenge: taps and logs, days with a journal entry, or books finished. */
export type ChallengeCounts = 'logs' | 'journal' | 'books'

export type Challenge = {
  id: string
  area: CheckArea
  thingId?: string
  title: string
  target: number
  counts: ChallengeCounts
  startOn: string
  /** Left out for a count with no deadline, such as songs learned. */
  by?: string
  /** Marked by hand, on top of whatever the logs say. */
  taps: number
  metOn?: string
}

export type AreaLog = {
  id: string
  area: CheckArea
  thingId?: string
  on: string
  note?: string
  minutes?: number
  withPeople?: string[]
}

export type Book = { id: string; title: string; startedOn: string; finishedOn?: string; readOn: string[] }

export type AreaFields = { areaThings: AreaThing[]; areaChallenges: Challenge[]; areaLogs: AreaLog[]; books: Book[] }
export const emptyAreaFields: AreaFields = { areaThings: [], areaChallenges: [], areaLogs: [], books: [] }

/** What a reading needs from outside the area's own records. */
export type AreaContext = { projects?: Project[]; activities?: Activity[]; journalDays?: string[] }

export type ChallengeStanding = {
  challenge: Challenge
  count: number
  state: 'met' | 'on pace' | 'behind' | 'no date' | 'missed'
  /** 0 to 1: this challenge's share of the slice. */
  score: number
  progress: number
  /** Over: met with no date, or its date has gone by. */
  past: boolean
}

export type ThingStanding = { thing: AreaThing; due: boolean }

export type AreaReading = {
  area: CheckArea
  /** 0 to 1; left out until a thing has an answer or a challenge is open. */
  fill?: number
  things: ThingStanding[]
  challenges: ChallengeStanding[]
  past: ChallengeStanding[]
  /** An answer is missing or older than CHECK_STALE_DAYS. */
  due: boolean
  /** A thing is "not happy" or a challenge is behind. */
  drifting: boolean
  logged28: number
}

const dayMs = 86_400_000
const ms = (day: string) => new Date(`${day}T00:00:00Z`).getTime()
const iso = (time: number) => new Date(time).toISOString().slice(0, 10)
const clamp = (value: number) => Math.min(1, Math.max(0, value))
export const daysAgo = (today: string, days: number) => iso(ms(today) - days * dayMs)

export const projectThingId = (projectId: string) => `project:${projectId}`

/** The things in an area. In projects they are the personal projects still open, each with the answer kept for it. */
export function thingsOf(area: CheckArea, state: AreaFields, projects: Project[] = []): AreaThing[] {
  if (area !== 'projects') return state.areaThings.filter((item) => item.area === area)
  return projects
    .filter((project) => project.domain === 'personal' && project.status === 'active' && (!project.servesDomain || project.servesDomain === 'projects'))
    .map((project) => ({ ...state.areaThings.find((item) => item.id === projectThingId(project.id)), id: projectThingId(project.id), area, title: project.title }))
}

export function challengeCount(challenge: Challenge, state: AreaFields, context: AreaContext = {}): number {
  const within = (day: string | undefined): day is string => !!day && day >= challenge.startOn && (!challenge.by || day <= challenge.by)
  if (challenge.counts === 'journal') return (context.journalDays ?? []).filter(within).length
  if (challenge.counts === 'books') return state.books.filter((book) => within(book.finishedOn)).length
  const logs = state.areaLogs.filter((log) => log.area === challenge.area && (!challenge.thingId || log.thingId === challenge.thingId) && within(log.on))
  return challenge.taps + logs.length
}

/**
 * Where a challenge stands today. With a date, the count should rise in a straight line from the day it was set;
 * it is behind only once a whole one short of that line. Without a date it is never behind and scores how far along it is.
 * A dated challenge stays in the slice until its date, met or not; an undated one leaves when it is met.
 */
export function challengeStanding(challenge: Challenge, state: AreaFields, today: string, context: AreaContext = {}): ChallengeStanding {
  const count = challengeCount(challenge, state, context)
  const progress = challenge.target > 0 ? clamp(count / challenge.target) : 1
  const met = count >= challenge.target
  const over = !!challenge.by && challenge.by < today
  if (met) return { challenge, count, state: 'met', score: 1, progress: 1, past: over || !challenge.by }
  if (over) return { challenge, count, state: 'missed', score: 0, progress, past: true }
  if (!challenge.by) return { challenge, count, state: 'no date', score: progress, progress, past: false }
  const span = ms(challenge.by) - ms(challenge.startOn) + dayMs
  const expected = challenge.target * clamp((ms(today) - ms(challenge.startOn) + dayMs) / span)
  const onPace = count >= Math.floor(expected)
  return { challenge, count, state: onPace ? 'on pace' : 'behind', score: onPace ? 1 : clamp(count / expected), progress, past: false }
}

/** "1 of 2 · behind", the line a challenge row and a review share. */
export function challengeText(standing: ChallengeStanding): string {
  const head = `${standing.count} of ${standing.challenge.target}`
  return standing.state === 'no date' ? head : `${head} · ${standing.state}`
}

/**
 * How an area reads today. The fill is the average of the answers (happy 1, could be more a half, not happy nothing);
 * with challenges open, the answers are half and the challenges the other half, the split the body slice uses.
 */
export function areaReading(area: CheckArea, state: AreaFields, today: string, context: AreaContext = {}): AreaReading {
  const stale = daysAgo(today, CHECK_STALE_DAYS)
  const things = thingsOf(area, state, context.projects).map((thing) => ({ thing, due: !thing.happy || !thing.happyOn || thing.happyOn <= stale }))
  const standings = state.areaChallenges.filter((item) => item.area === area).map((item) => challengeStanding(item, state, today, context))
  const challenges = standings.filter((item) => !item.past)
  const answers = things.flatMap((item) => item.thing.happy ? [happyScore[item.thing.happy]] : [])
  const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
  const parts = [answers.length ? average(answers) : undefined, challenges.length ? average(challenges.map((item) => item.score)) : undefined].filter((value): value is number => value !== undefined)
  const from = daysAgo(today, 28)
  return {
    area,
    ...(parts.length ? { fill: average(parts) } : {}),
    things,
    challenges,
    past: standings.filter((item) => item.past).sort((a, b) => (b.challenge.by ?? b.challenge.metOn ?? '').localeCompare(a.challenge.by ?? a.challenge.metOn ?? '')),
    due: things.some((item) => item.due),
    drifting: things.some((item) => item.thing.happy === 'not') || challenges.some((item) => item.state === 'behind'),
    logged28: state.areaLogs.filter((log) => log.area === area && log.on > from && log.on <= today).length,
  }
}

export function areaReadings(state: AreaFields, today: string, context: AreaContext = {}): Record<CheckArea, AreaReading> {
  return Object.fromEntries(CHECK_AREAS.map((area) => [area, areaReading(area, state, today, context)])) as Record<CheckArea, AreaReading>
}

/** Every thing whose answer is due, across the areas that are on: what the month review asks about. */
export function dueThings(state: AreaFields, today: string, off: LifeDomain[] = [], context: AreaContext = {}): AreaThing[] {
  return CHECK_AREAS.filter((area) => !off.includes(area)).flatMap((area) => areaReading(area, state, today, context).things.filter((item) => item.due).map((item) => item.thing))
}

/**
 * Marks challenges met on the day they got there, and lets old records leave: logs after AREA_KEEP_DAYS, challenges
 * that long after their date or the day they were met, finished books and read days the same.
 */
export function settleAreas<T extends AreaFields>(state: T, today: string, context: AreaContext = {}): T {
  const oldest = daysAgo(today, AREA_KEEP_DAYS)
  const areaLogs = state.areaLogs.filter((log) => log.on > oldest)
  const books = state.books.filter((book) => !book.finishedOn || book.finishedOn > oldest).map((book) => book.readOn.some((day) => day <= oldest) ? { ...book, readOn: book.readOn.filter((day) => day > oldest) } : book)
  const kept = { ...state, areaLogs, books }
  const areaChallenges = state.areaChallenges
    .map((challenge) => !challenge.metOn && challengeCount(challenge, kept, context) >= challenge.target ? { ...challenge, metOn: today } : challenge)
    .filter((challenge) => (challenge.by ?? challenge.metOn ?? today) > oldest)
  const same = areaLogs.length === state.areaLogs.length && JSON.stringify(books) === JSON.stringify(state.books) && JSON.stringify(areaChallenges) === JSON.stringify(state.areaChallenges)
  return same ? state : { ...state, areaLogs, books, areaChallenges }
}

/** Saves an answer. A project's thing is made the first time it is answered. */
export function withHappy<T extends AreaFields>(state: T, thing: Pick<AreaThing, 'id' | 'area' | 'title'>, happy: Happy, today: string): T {
  const stored = state.areaThings.find((item) => item.id === thing.id)
  const next: AreaThing = { ...stored, id: thing.id, area: thing.area, title: thing.title, happy, happyOn: today }
  return { ...state, areaThings: stored ? state.areaThings.map((item) => item.id === thing.id ? next : item) : [...state.areaThings, next] }
}

export function withThing<T extends AreaFields>(state: T, thing: AreaThing): T {
  const exists = state.areaThings.some((item) => item.id === thing.id)
  return { ...state, areaThings: exists ? state.areaThings.map((item) => item.id === thing.id ? thing : item) : [...state.areaThings, thing] }
}

/** A dropped thing takes its answer with it. Its challenges and logs stay, no longer tied to it. */
export function withoutThing<T extends AreaFields>(state: T, id: string): T {
  const untie = <Item extends { thingId?: string }>(item: Item): Item => {
    if (item.thingId !== id) return item
    const { thingId: _dropped, ...rest } = item
    return rest as Item
  }
  return { ...state, areaThings: state.areaThings.filter((item) => item.id !== id), areaChallenges: state.areaChallenges.map(untie), areaLogs: state.areaLogs.map(untie) }
}

export function withChallenge<T extends AreaFields>(state: T, challenge: Challenge, today: string, context: AreaContext = {}): T {
  const exists = state.areaChallenges.some((item) => item.id === challenge.id)
  return settleAreas({ ...state, areaChallenges: exists ? state.areaChallenges.map((item) => item.id === challenge.id ? challenge : item) : [...state.areaChallenges, challenge] }, today, context)
}

export function withoutChallenge<T extends AreaFields>(state: T, id: string): T {
  return { ...state, areaChallenges: state.areaChallenges.filter((item) => item.id !== id) }
}

/** One more, or one fewer, marked by hand. */
export function withTap<T extends AreaFields>(state: T, id: string, delta: number, today: string, context: AreaContext = {}): T {
  return settleAreas({ ...state, areaChallenges: state.areaChallenges.map((item) => item.id === id ? { ...item, taps: Math.max(0, item.taps + delta) } : item) }, today, context)
}

export function withLog<T extends AreaFields>(state: T, log: AreaLog, today: string, context: AreaContext = {}): T {
  return settleAreas({ ...state, areaLogs: [...state.areaLogs, log] }, today, context)
}

export function withoutLog<T extends AreaFields>(state: T, id: string): T {
  return { ...state, areaLogs: state.areaLogs.filter((item) => item.id !== id) }
}

export function withBook<T extends AreaFields>(state: T, book: Book): T {
  return { ...state, books: [...state.books, book] }
}

/** Ticks or unticks a day's reading. */
export function withReadDay<T extends AreaFields>(state: T, bookId: string, day: string): T {
  return { ...state, books: state.books.map((book) => book.id !== bookId ? book : { ...book, readOn: book.readOn.includes(day) ? book.readOn.filter((item) => item !== day) : [...book.readOn, day].sort() }) }
}

export function withBookFinished<T extends AreaFields>(state: T, bookId: string, today: string, context: AreaContext = {}): T {
  return settleAreas({ ...state, books: state.books.map((book) => book.id === bookId ? { ...book, finishedOn: today } : book) }, today, context)
}

export function withoutBook<T extends AreaFields>(state: T, bookId: string): T {
  return { ...state, books: state.books.filter((book) => book.id !== bookId) }
}

/** What a project got in the last 28 days: tasks finished, and the time on them plus any sessions logged by hand. */
export function projectWork(project: Project, state: AreaFields, activities: Activity[], today: string): { tasks: number; minutes: number } {
  const from = daysAgo(today, 28)
  const recent = (day: string) => day > from && day <= today
  const done = activities.filter((item) => item.kind === 'task-completed' && item.projectId === project.id && recent(item.occurredAt.slice(0, 10)))
  const sessions = state.areaLogs.filter((log) => log.area === 'projects' && log.thingId === projectThingId(project.id) && recent(log.on))
  return {
    tasks: done.length,
    minutes: done.reduce((sum, item) => sum + (item.estimateDeltaMin ?? item.minutes ?? 0), 0) + sessions.reduce((sum, log) => sum + (log.minutes ?? 0), 0),
  }
}

/** What mind shows beside its things: journal days, days read and books finished, counted and never read. */
export function mindFacts(state: AreaFields, today: string, journalDays: string[] = []): { journalDays: number; readDays: number; booksFinished: number } {
  const from = daysAgo(today, 28)
  const recent = (day: string) => day > from && day <= today
  return {
    journalDays: journalDays.filter(recent).length,
    readDays: new Set(state.books.flatMap((book) => book.readOn).filter(recent)).size,
    booksFinished: state.books.filter((book) => book.finishedOn?.slice(0, 4) === today.slice(0, 4)).length,
  }
}
