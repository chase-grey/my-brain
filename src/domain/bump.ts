import type { Task } from './types'

export type BumpResult = {
  bumped: Task
  displaced: Task[]
}

export function bumpTask(task: Task, planDate: string, sameDayTasks: Task[], dailyCapacityMin: number): BumpResult {
  const bumped = { ...task, planDate, carries: task.carries + 1 }
  const peers = sameDayTasks.filter((candidate) => candidate.domain === task.domain && candidate.id !== task.id && candidate.planDate === planDate && !candidate.completed)
  let used = bumped.estimateMin + peers.reduce((sum, candidate) => sum + candidate.estimateMin, 0)
  const displaced: Task[] = []
  for (const candidate of [...peers].sort((a, b) => b.priority - a.priority || b.carries - a.carries)) {
    if (used <= dailyCapacityMin) break
    displaced.push({ ...candidate, planDate: undefined, carries: candidate.carries + 1 })
    used -= candidate.estimateMin
  }
  return { bumped, displaced }
}
