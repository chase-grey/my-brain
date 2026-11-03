import type { Activity, Goal, Project } from './types'

const DAY_MS = 86_400_000

export type PaceProgress = {
  shape: 'pace'
  hoursDone: number
  hoursCommitted?: number
  expectedHours?: number
  elapsed?: number
  state: 'met' | 'no target' | 'ahead' | 'on pace' | 'behind'
}

export type BlockProgress = {
  shape: 'block'
  scheduledOn?: string
  state: 'met' | 'unscheduled' | 'scheduled' | 'missed'
  loud: boolean
}

export type GoalProgress = PaceProgress | BlockProgress

function dayNumber(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / DAY_MS)
}

export function goalHoursDone(goal: Goal, projects: Project[], activities: Activity[]): number {
  const projectIds = new Set(projects.filter((project) => project.goalId === goal.id).map((project) => project.id))
  const minutes = activities
    .filter((activity) => activity.domain === goal.domain && activity.projectId && projectIds.has(activity.projectId))
    .filter((activity) => !goal.committedOn || activity.occurredAt.slice(0, 10) >= goal.committedOn)
    .reduce((sum, activity) => sum + (activity.estimateDeltaMin ?? activity.minutes ?? 0), 0)
  return Math.round(minutes / 6) / 10
}

export function elapsedFraction(goal: Goal, today: string): number | undefined {
  if (!goal.committedOn || !goal.targetDate) return undefined
  const start = dayNumber(goal.committedOn)
  const end = dayNumber(goal.targetDate)
  if (end <= start) return 1
  return Math.min(1, Math.max(0, (dayNumber(today) - start) / (end - start)))
}

export function goalProgress(goal: Goal, projects: Project[], activities: Activity[], today: string): GoalProgress {
  if (goal.shape === 'block') {
    if (goal.status === 'met') return { shape: 'block', scheduledOn: goal.scheduledOn, state: 'met', loud: false }
    if (!goal.scheduledOn) return { shape: 'block', state: 'unscheduled', loud: true }
    if (goal.scheduledOn < today) return { shape: 'block', scheduledOn: goal.scheduledOn, state: 'missed', loud: true }
    return { shape: 'block', scheduledOn: goal.scheduledOn, state: 'scheduled', loud: false }
  }
  const hoursDone = goalHoursDone(goal, projects, activities)
  if (goal.status === 'met') return { shape: 'pace', hoursDone, hoursCommitted: goal.hoursCommitted, state: 'met' }
  const elapsed = elapsedFraction(goal, today)
  if (!goal.hoursCommitted || elapsed === undefined) return { shape: 'pace', hoursDone, hoursCommitted: goal.hoursCommitted, state: 'no target' }
  const expectedHours = goal.hoursCommitted * elapsed
  const slack = Math.max(1, goal.hoursCommitted * 0.1)
  const state = hoursDone < expectedHours - slack ? 'behind' : hoursDone > expectedHours + slack ? 'ahead' : 'on pace'
  return { shape: 'pace', hoursDone, hoursCommitted: goal.hoursCommitted, expectedHours, elapsed, state }
}
