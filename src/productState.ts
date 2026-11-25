import type {
  Activity,
  Domain,
  Commitment,
  DayOverride,
  Delegation,
  Goal,
  Habit,
  HabitEntry,
  PersonRef,
  Project,
  RestCheckIn,
  TravelWindow,
} from './domain/types'
import { emptyAreaFields, settleAreas, withLog, type AreaFields } from './domain/areas'
import type { RingCommitment, RingEvidence } from './domain/lifeRing'
import type { TrackerSummary } from './domain/bodyTracker'
import { addMoneyReading, type MoneyAccount, type MoneyFigure, type MoneyGoal, type MoneySnapshot } from './domain/money'
import type { RestDay, RestGoals } from './domain/rest'
import type { LifeDomain } from './domain/types'
import { defaultPersonalHabits, retiredHabitIds } from './domain/habits'

export type ProductState = AreaFields & {
  goals: Goal[]
  habits: Habit[]
  habitEntries: HabitEntry[]
  projects: Project[]
  activities: Activity[]
  commitments: Commitment[]
  delegations: Delegation[]
  travelWindows: TravelWindow[]
  dayOverrides: DayOverride[]
  ringEvidence: RingEvidence[]
  ringCommitments: RingCommitment[]
  /** Life areas this person has switched off; they leave the wheel and the targets form. */
  ringOff: LifeDomain[]
  restCheckIns: RestCheckIn[]
  moneySnapshots: MoneySnapshot[]
  /** What the money slice is judged against. With none set, money takes a 28-day target like any other area. */
  moneyGoals: MoneyGoal[]
  /** Sleep and screen time by day, as read from the phone. */
  restDays: RestDay[]
  restGoals: RestGoals
  people: PersonRef[]
  /** The last summary read from workout-tracker; the body slice and reviews read it. */
  bodyTracker?: TrackerSummary
}

export const emptyProductState: ProductState = {
  goals: [], habits: defaultPersonalHabits, habitEntries: [], projects: [], activities: [], commitments: [], delegations: [], travelWindows: [],
  dayOverrides: [], ringEvidence: [], ringCommitments: [], ringOff: [], restCheckIns: [], moneySnapshots: [], moneyGoals: [], restDays: [], restGoals: {}, people: [], ...emptyAreaFields,
}

// The 'projects' area was stored as 'build' until 2026-11-24.
const renamed = <T extends string | undefined>(area: T): T => (area === 'build' ? 'projects' : area) as T

export function renameBuildArea(stored: Partial<ProductState>): Partial<ProductState> {
  return {
    ...stored,
    ...(stored.ringEvidence && { ringEvidence: stored.ringEvidence.map((item) => ({ ...item, domain: renamed(item.domain) })) }),
    ...(stored.ringCommitments && { ringCommitments: stored.ringCommitments.map((item) => ({ ...item, domain: renamed(item.domain) })) }),
    ...(stored.projects && { projects: stored.projects.map((item) => item.servesDomain ? { ...item, servesDomain: renamed(item.servesDomain) } : item) }),
  }
}

/** Saves a day's money numbers, whoever read them: a screenshot, the chat, or the form. */
export function withMoneyReading(state: ProductState, on: string, figures: Partial<Record<MoneyFigure, number>>, accounts: MoneyAccount[] = []): ProductState {
  const moneySnapshots = addMoneyReading(state.moneySnapshots, on, figures, accounts)
  if (moneySnapshots === state.moneySnapshots) return state
  const logged = state.ringEvidence.some((item) => item.domain === 'money' && item.on === on)
  return { ...state, moneySnapshots, ringEvidence: logged ? state.ringEvidence : [...state.ringEvidence, { domain: 'money', on, value: 1 }] }
}

/** "saw someone": the person, the contact, and a connection log that moves any open challenge there. */
export function withSawSomeone(state: ProductState, name: string, day: string, thingId?: string): ProductState {
  const known = state.people.find((item) => item.displayName === name)
  return withLog({
    ...state,
    people: [...state.people.filter((item) => item !== known), { id: known?.id ?? newKey('person'), displayName: name, lastSeenOn: day }],
    ringEvidence: [...state.ringEvidence, { domain: 'connection', on: day, value: 1 }],
    activities: [...state.activities, { id: newKey('activity'), domain: 'personal', kind: 'connection', occurredAt: new Date().toISOString(), withPeople: [name] }],
  }, { id: newKey('log'), area: 'connection', on: day, withPeople: [name], ...(thingId ? { thingId } : {}) }, day)
}

/** The monthly felt rating. A second one inside the same 28 days replaces the first, so a month never gets two votes. */
export function withRestCheckIn(state: ProductState, rating: number, day: string): ProductState {
  const start = new Date(`${day}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - 27)
  const from = start.toISOString().slice(0, 10)
  const earlier = state.restCheckIns.find((item) => item.periodEnd > from)
  const now = new Date().toISOString()
  const checkIn: RestCheckIn = earlier
    ? { ...earlier, rating: rating as RestCheckIn['rating'], revisedAt: now }
    : { id: newKey('rest'), periodStart: from, periodEnd: day, rating: rating as RestCheckIn['rating'], createdAt: now }
  return {
    ...state,
    restCheckIns: [...state.restCheckIns.filter((item) => item !== earlier), checkIn],
    ringEvidence: [...state.ringEvidence.filter((item) => !(earlier && item.domain === 'rest' && item.on === earlier.periodEnd)), { domain: 'rest', on: earlier?.periodEnd ?? day, value: rating }],
  }
}

/** The newest felt rating, and whether it is more than 35 days old or missing. */
export function latestRestCheckIn(state: ProductState, today: string): { checkIn?: RestCheckIn; due: boolean } {
  const checkIn = [...state.restCheckIns].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)).pop()
  const stale = new Date(`${today}T00:00:00Z`)
  stale.setUTCDate(stale.getUTCDate() - 35)
  return { checkIn, due: !checkIn || checkIn.periodEnd <= stale.toISOString().slice(0, 10) }
}

const newKey = (prefix: string) => globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const storageKey = (domain: Domain) => `my-brain.${domain}.product.v1`

export function scopeProductState(state: ProductState, domain: Domain): ProductState {
  const scoped = structuredClone(state)
  for (const key of ['goals', 'habits', 'projects', 'activities', 'commitments', 'delegations', 'travelWindows', 'dayOverrides'] as const) {
    // All domain-owned collections use the same ownership boundary.
    Object.assign(scoped, { [key]: state[key].filter((item) => item.domain === domain) })
  }
  scoped.habitEntries = state.habitEntries.filter((entry) => scoped.habits.some((habit) => habit.id === entry.habitId))
  if (domain === 'work') {
    scoped.ringEvidence = []
    scoped.ringCommitments = []
    scoped.ringOff = []
    scoped.restCheckIns = []
    scoped.moneySnapshots = []
    scoped.moneyGoals = []
    scoped.restDays = []
    scoped.restGoals = {}
    scoped.people = []
    Object.assign(scoped, emptyAreaFields)
    delete scoped.bodyTracker
  }
  return scoped
}

/** `seedHabits` adds the owner's own habits (vitamins); everyone else starts with none. */
export function loadProductState(domain: Domain, seedHabits = true): ProductState {
  try {
    const stored = renameBuildArea(JSON.parse(localStorage.getItem(storageKey(domain)) ?? localStorage.getItem('my-brain.product.v1') ?? '{}') as Partial<ProductState>)
    const habits = [...(stored.habits ?? [])].filter((habit) => habit.domain === domain && !retiredHabitIds.includes(habit.id))
    for (const habit of seedHabits ? defaultPersonalHabits.filter((item) => item.domain === domain) : []) {
      const index = habits.findIndex((item) => item.id === habit.id)
      if (index < 0) habits.push(habit)
      else habits[index] = {
        ...habit,
        ...habits[index],
        parts: habits[index].parts ?? habit.parts,
        timeWindow: habits[index].timeWindow ?? habit.timeWindow,
      }
    }
    return settleAreas(scopeProductState({ ...emptyProductState, ...stored, habits, habitEntries: stored.habitEntries ?? [] }, domain), new Date().toLocaleDateString('en-CA'))
  } catch {
    return scopeProductState(seedHabits ? emptyProductState : { ...emptyProductState, habits: [] }, domain)
  }
}

export function saveProductState(state: ProductState, domain: Domain): void {
  try {
    const scoped = scopeProductState(state, domain)
    const { ringEvidence, ringCommitments, ringOff, restCheckIns, moneySnapshots, moneyGoals, restDays, restGoals, people, bodyTracker, areaThings, areaChallenges, areaLogs, books, ...common } = scoped
    localStorage.setItem(storageKey(domain), JSON.stringify(domain === 'personal'
      ? { ...common, ringEvidence, ringCommitments, ringOff, restCheckIns, moneySnapshots, moneyGoals, restDays, restGoals, people, bodyTracker, areaThings, areaChallenges, areaLogs, books }
      : common))
  } catch {
    // The active in-memory state remains usable.
  }
}
