export type Domain = 'personal' | 'work'
export type Priority = 1 | 2 | 3 | 4
export type Energy = 'deep' | 'shallow' | 'errand'
export type Place = 'office' | 'home' | 'out'
export type Need = 'computer' | 'phone' | 'tools' | 'car' | 'store'
export type StoreType = 'grocery' | 'amazon' | 'hardware' | 'other'
export type Recurrence = 'daily' | 'weekdays-135'
export type TimeWindow = 'morning' | 'day' | 'evening' | 'anytime'
export type Horizon = 'year' | 'season' | 'month'
export type GoalShape = 'pace' | 'block'
export type Kind = 'execution' | 'strategic' | 'habit' | 'delegated'
export type Rhythm = 'pace' | 'burst'
export type Drive = 'enforced' | 'intrinsic'
export type Season = 'winter' | 'spring' | 'summer' | 'fall'
export type Mode = string
export type LifeDomain = 'body' | 'purpose' | 'connection' | 'build' | 'mind' | 'creativity' | 'money' | 'rest'

export type ProviderTask = {
  id: string
  providerListId?: string
  domain: Domain
  title: string
  dueDate?: string
  completed: boolean
}

export type TaskMeta = {
  notes?: string
  taskId: string
  domain: Domain
  estimateMin: number
  originalEstimateMin: number
  priority: Priority
  planDate?: string
  hiddenUntil?: string
  energy: Energy
  place?: Place[]
  needs?: Need[]
  storeType?: StoreType
  recurrence?: Recurrence
  timeWindow?: TimeWindow
  lastCompletedDate?: string
  metadataComplete?: boolean
  triageForTaskId?: string
  pinned: boolean
  carries: number
  projectId?: string
  kind?: Kind
  mode?: Mode
}

export type Task = ProviderTask & TaskMeta

export type PersonalNowInput = {
  today: string
  availableMin: number
  weeklyCapacityMin: number
  energy: Energy
  place: Place
  availableNeeds: readonly Need[]
}

export type NowInput = PersonalNowInput & {
  domain: Domain
}

export type Plan = {
  tasks: Task[]
  totalMin: number
  availableMin: number
}

export type Revision = {
  on: string
  field: 'hours' | 'date' | 'ceiling'
  from: string | number
  to: string | number
  why?: string
}

export type Goal = {
  id: string
  domain: Domain
  horizon: Horizon
  parentId?: string
  title: string
  season?: Season
  funded: boolean
  status: 'active' | 'met' | 'abandoned'
  hoursCommitted?: number
  targetDate?: string
  committedOn?: string
  shape?: GoalShape
  scheduledOn?: string
  calendarEventId?: string
  revisions: Revision[]
}

export type Project = {
  id: string
  domain: Domain
  goalId?: string
  title: string
  estimateMin?: number
  status: 'active' | 'done' | 'parked'
  rhythm: Rhythm
  drive: Drive
  minBlockMin?: number
  dormantSeasons?: Season[]
  mode: Mode
  servesDomain?: LifeDomain
}

export type ActivityKind = 'task-progress' | 'task-completed' | 'strategic' | 'maintenance-block' | 'practice' | 'connection'

export type Activity = {
  id: string
  domain: Domain
  kind: ActivityKind
  taskId?: string
  projectId?: string
  lane?: 'email' | 'strategic' | 'project' | 'admin'
  mode?: Mode
  occurredAt: string
  estimateDeltaMin?: number
  minutes?: number
  note?: string
  withPeople?: string[]
}

export type Habit = {
  id: string
  domain: Domain
  title: string
  cadence: { unit: 'day' | 'week' | 'month'; interval: number }
  estimateMin: number
  startedOn: string
  countsTowardStreak: boolean
  timeWindow: TimeWindow
  parts: HabitPart[]
}

export type HabitPart = {
  id: string
  title: string
  intervalDays: number
}

export type HabitEntry = {
  habitId: string
  date: string
  completedPartIds: string[]
}

export type Delegation = {
  id: string
  domain: Domain
  title: string
  assignee: string
  askedOn: string
  theirCommittedDate?: string
  checkBackOn: string
  status: 'asked' | 'in-progress' | 'blocked' | 'delivered'
  link?: string
}

export type TravelWindow = {
  id: string
  domain: Domain
  start: string
  end: string
  capacityFactor: number
  label: string
}

export type Band = 'wide' | 'fragmented' | 'thin'

export type DayPlan = {
  date: string
  availableMin: number
  longestRunMin: number
  overrideMin?: number
  band: Band
  modeCandidate?: Mode
}

export type WeekShape = {
  weekStart: string
  domain: Domain
  days: DayPlan[]
}

export type DayOverride = {
  date: string
  domain: Domain
  kind: 'floor' | 'held'
  minutes?: number
  nominatedProjectId?: string
  note?: string
  calendarEventId?: string
}

export type Commitment = {
  weekStart: string
  domain: Domain
  targetMin: number
  strategicMin: number
  habitDaysRequired: number
  maintenance: { lane: string; minMin: number }[]
  halfTargetMin: number
  ceilingMin: number
  paidAt?: string
}

export type PersonRef = {
  id: string
  displayName: string
  lastSeenOn?: string
}

export type RestCheckIn = {
  id: string
  periodStart: string
  periodEnd: string
  rating: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  journal?: string
  createdAt: string
  revisedAt?: string
}

export type MoneySnapshot = {
  month: string
  netWorth: number
  homeRemaining: number
  carRemaining: number
  incomeMonthly: number
  spendingMonthly: number
}
