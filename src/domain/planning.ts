import type { Activity, Band, Commitment, DayPlan, Goal, Project, Task } from './types'

const DAY_MS = 86_400_000

function dateAtUtc(date: string): number {
  return new Date(`${date}T00:00:00Z`).getTime()
}

export function capacityBand(availableMin: number, longestRunMin: number, wideThresholdMin = 120): Band {
  if (availableMin < 60 || longestRunMin < 30) return 'thin'
  if (longestRunMin >= wideThresholdMin) return 'wide'
  return 'fragmented'
}

export function dayPlan(date: string, availableMin: number, longestRunMin: number, overrideMin?: number): DayPlan {
  const effectiveAvailable = overrideMin ?? availableMin
  return {
    date,
    availableMin,
    longestRunMin,
    overrideMin,
    band: capacityBand(effectiveAvailable, longestRunMin),
  }
}

export function writeCommitment(input: Omit<Commitment, 'halfTargetMin'>): Commitment {
  if (input.targetMin > input.ceilingMin) throw new Error('weekly target exceeds its ceiling')
  if (input.maintenance.length > 4) throw new Error('a domain can have at most four maintenance floors')
  return { ...input, halfTargetMin: Math.ceil(input.targetMin / 2) }
}

export function clearedEstimateMin(activities: Activity[], since?: string): number {
  return activities.reduce((total, activity) => {
    if (since && activity.occurredAt.slice(0, 10) < since) return total
    return total + (activity.estimateDeltaMin ?? 0)
  }, 0)
}

export function projectRemainingMin(project: Project, tasks: Task[]): number {
  const taskTotal = tasks
    .filter((task) => task.domain === project.domain && task.projectId === project.id && !task.completed)
    .reduce((sum, task) => sum + task.estimateMin, 0)
  return project.estimateMin === undefined ? taskTotal : Math.max(project.estimateMin, taskTotal)
}

export function projectedDone(project: Project, tasks: Task[], activities: Activity[], today: string): string | undefined {
  const sixWeeksAgo = new Date(dateAtUtc(today) - 42 * DAY_MS).toISOString().slice(0, 10)
  const cleared = activities
    .filter((activity) => activity.domain === project.domain && activity.projectId === project.id)
    .filter((activity) => activity.occurredAt.slice(0, 10) >= sixWeeksAgo)
    .reduce((sum, activity) => sum + (activity.estimateDeltaMin ?? 0), 0)
  if (cleared <= 0) return undefined
  const remaining = projectRemainingMin(project, tasks)
  const days = Math.ceil(remaining / (cleared / 42))
  return new Date(dateAtUtc(today) + days * DAY_MS).toISOString().slice(0, 10)
}

export function reviseGoal(goal: Goal, field: 'hours' | 'date', value: number | string, on: string, why?: string): Goal {
  const key = field === 'hours' ? 'hoursCommitted' : 'targetDate'
  const previous = goal[key]
  if (previous === undefined) throw new Error(`goal has no committed ${field}`)
  return {
    ...goal,
    [key]: value,
    revisions: [...goal.revisions, { on, field, from: previous, to: value, why }],
  }
}
