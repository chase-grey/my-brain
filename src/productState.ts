import type {
  Activity,
  Domain,
  Commitment,
  DayOverride,
  Delegation,
  Goal,
  Habit,
  HabitEntry,
  MoneySnapshot,
  PersonRef,
  Project,
  RestCheckIn,
  TravelWindow,
} from './domain/types'
import type { RingCommitment, RingEvidence } from './domain/lifeRing'
import type { TrackerSummary } from './domain/bodyTracker'
import type { LifeDomain } from './domain/types'
import { defaultPersonalHabits, retiredHabitIds } from './domain/habits'

export type ProductState = {
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
  people: PersonRef[]
  /** The last summary read from workout-tracker; the body slice and reviews read it. */
  bodyTracker?: TrackerSummary
}

export const emptyProductState: ProductState = {
  goals: [], habits: defaultPersonalHabits, habitEntries: [], projects: [], activities: [], commitments: [], delegations: [], travelWindows: [],
  dayOverrides: [], ringEvidence: [], ringCommitments: [], ringOff: [], restCheckIns: [], moneySnapshots: [], people: [],
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
    scoped.people = []
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
    return scopeProductState({ ...emptyProductState, ...stored, habits, habitEntries: stored.habitEntries ?? [] }, domain)
  } catch {
    return scopeProductState(seedHabits ? emptyProductState : { ...emptyProductState, habits: [] }, domain)
  }
}

export function saveProductState(state: ProductState, domain: Domain): void {
  try {
    const scoped = scopeProductState(state, domain)
    const { ringEvidence, ringCommitments, ringOff, restCheckIns, moneySnapshots, people, bodyTracker, ...common } = scoped
    localStorage.setItem(storageKey(domain), JSON.stringify(domain === 'personal'
      ? { ...common, ringEvidence, ringCommitments, ringOff, restCheckIns, moneySnapshots, people, bodyTracker }
      : common))
  } catch {
    // The active in-memory state remains usable.
  }
}
