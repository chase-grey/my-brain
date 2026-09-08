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
import { defaultPersonalHabits } from './domain/habits'

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
  restCheckIns: RestCheckIn[]
  moneySnapshots: MoneySnapshot[]
  people: PersonRef[]
}

export const emptyProductState: ProductState = {
  goals: [], habits: defaultPersonalHabits, habitEntries: [], projects: [], activities: [], commitments: [], delegations: [], travelWindows: [],
  dayOverrides: [], ringEvidence: [], ringCommitments: [], restCheckIns: [], moneySnapshots: [], people: [],
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
    scoped.restCheckIns = []
    scoped.moneySnapshots = []
    scoped.people = []
  }
  return scoped
}

export function loadProductState(domain: Domain): ProductState {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey(domain)) ?? localStorage.getItem('my-brain.product.v1') ?? '{}') as Partial<ProductState>
    const habits = [...(stored.habits ?? [])].filter((habit) => habit.domain === domain)
    for (const habit of defaultPersonalHabits.filter((item) => item.domain === domain)) {
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
    return scopeProductState(emptyProductState, domain)
  }
}

export function saveProductState(state: ProductState, domain: Domain): void {
  try {
    const scoped = scopeProductState(state, domain)
    const { ringEvidence, ringCommitments, restCheckIns, moneySnapshots, people, ...common } = scoped
    localStorage.setItem(storageKey(domain), JSON.stringify(domain === 'personal'
      ? { ...common, ringEvidence, ringCommitments, restCheckIns, moneySnapshots, people }
      : common))
  } catch {
    // The active in-memory state remains usable.
  }
}
