import type { Domain, NowInput, PersonalNowInput, Plan, Task } from './types'
import { surfaces } from './noiseEngine'

export function isDoneToday(task: Task, today: string): boolean {
  return task.recurrence ? task.lastCompletedDate === today : task.completed
}

function recursToday(task: Task, today: string): boolean {
  if (task.recurrence === 'daily') return true
  if (task.recurrence === 'weekdays-135') return [1, 3, 5].includes(new Date(`${today}T12:00:00`).getDay())
  return false
}

export function isAvailable(task: Task, today: string): boolean {
  return !task.hiddenUntil || task.hiddenUntil <= today
}

export function isTodayCommitment(task: Task, today: string, domain: Domain = 'personal'): boolean {
  if (task.domain !== domain) return false
  if (task.kind === 'delegated') return false
  if (!isAvailable(task, today)) return false
  if (task.recurrence) return recursToday(task, today)
  if (!task.dueDate) return false
  return task.dueDate === today || (!task.completed && task.dueDate < today)
}

export function todayCommitments(tasks: Task[], today: string, domain: Domain = 'personal'): Task[] {
  return tasks.filter((task) => isTodayCommitment(task, today, domain)).sort((a, b) => {
    const doneDifference = Number(isDoneToday(a, today)) - Number(isDoneToday(b, today))
    if (doneDifference) return doneDifference
    if (a.timeWindow !== b.timeWindow) {
      const order = { morning: 0, day: 1, anytime: 2, evening: 3 }
      return order[a.timeWindow ?? 'anytime'] - order[b.timeWindow ?? 'anytime']
    }
    return compareCandidates(a, b)
  })
}

function endOfWeek(today: string): string {
  const date = new Date(`${today}T00:00:00.000Z`)
  const daysUntilSunday = (7 - date.getUTCDay()) % 7
  date.setUTCDate(date.getUTCDate() + daysUntilSunday)
  return date.toISOString().slice(0, 10)
}

export function isThisWeekCommitment(task: Task, today: string, domain: Domain = 'personal'): boolean {
  if (task.domain !== domain || task.completed || task.recurrence) return false
  if (!task.dueDate || task.dueDate <= today || task.dueDate > endOfWeek(today)) return false
  return isAvailable(task, today)
}

export function thisWeekCommitments(tasks: Task[], today: string, domain: Domain = 'personal'): Task[] {
  return tasks.filter((task) => isThisWeekCommitment(task, today, domain)).sort((a, b) => {
    const dueDifference = (a.dueDate ?? '').localeCompare(b.dueDate ?? '')
    return dueDifference || compareCandidates(a, b)
  })
}

function isEligible(task: Task, input: NowInput): boolean {
  if (task.domain !== input.domain) return false
  if (task.kind === 'delegated') return false
  if (isTodayCommitment(task, input.today, input.domain)) return false
  if (isThisWeekCommitment(task, input.today, input.domain)) return false
  if (task.energy !== input.energy) return false
  if (task.place?.length && !task.place.includes(input.place)) return false
  if (task.needs?.some((need) => !input.availableNeeds.includes(need))) return false
  return surfaces(task, input.today, input.weeklyCapacityMin)
}

function compareCandidates(a: Task, b: Task): number {
  if (a.priority !== b.priority) return a.priority - b.priority
  if (a.dueDate !== b.dueDate) {
    if (!a.dueDate) return 1
    if (!b.dueDate) return -1
    return a.dueDate.localeCompare(b.dueDate)
  }
  if (a.carries !== b.carries) return b.carries - a.carries
  if (a.estimateMin !== b.estimateMin) return a.estimateMin - b.estimateMin
  return a.id.localeCompare(b.id)
}

export function buildNowPlan(tasks: Task[], input: NowInput): Plan {
  if (!Number.isFinite(input.availableMin) || input.availableMin < 0) {
    throw new Error('availableMin must be zero or greater')
  }

  const selected: Task[] = []
  let totalMin = 0

  for (const candidate of tasks.filter((task) => isEligible(task, input)).sort(compareCandidates)) {
    if (totalMin + candidate.estimateMin > input.availableMin) continue
    selected.push(candidate)
    totalMin += candidate.estimateMin
  }

  return {
    tasks: selected,
    totalMin,
    availableMin: input.availableMin,
  }
}

export function buildPersonalNowPlan(tasks: Task[], input: PersonalNowInput): Plan {
  return buildNowPlan(tasks, { ...input, domain: 'personal' })
}
