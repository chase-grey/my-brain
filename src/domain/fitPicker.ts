import type { Domain, Energy, Mode, Need, Place, Project, Task } from './types'
import { surfaces } from './noiseEngine'

export type FitInput = {
  domain: Domain
  today: string
  availableMin: number
  weeklyCapacityMin: number
  energy: Energy
  place: Place
  availableNeeds: readonly Need[]
  currentMode?: Mode
}

export type FitPlan = {
  kind: 'continue' | 'sweep' | 'mixed'
  tasks: Task[]
  totalMin: number
  mode?: Mode
}

function eligible(task: Task, project: Project | undefined, input: FitInput): boolean {
  if (task.domain !== input.domain) return false
  if (task.completed || !surfaces(task, input.today, input.weeklyCapacityMin)) return false
  if (task.energy !== input.energy) return false
  if (task.place?.length && !task.place.includes(input.place)) return false
  if (task.needs?.some((need) => !input.availableNeeds.includes(need))) return false
  const minBlock = project?.rhythm === 'burst' ? project.minBlockMin ?? 0 : 0
  return input.availableMin >= minBlock && task.estimateMin <= input.availableMin
}

function taskMode(task: Task, projects: Map<string, Project>): Mode | undefined {
  return task.mode ?? (task.projectId ? projects.get(task.projectId)?.mode : undefined)
}

function score(task: Task, mode: Mode | undefined, input: FitInput): number {
  const urgency = (5 - task.priority) * 100
  const due = task.dueDate ? Math.max(0, 60 - Math.floor((new Date(`${task.dueDate}T00:00:00Z`).getTime() - new Date(`${input.today}T00:00:00Z`).getTime()) / 86_400_000)) : 0
  const cohesion = mode && mode === input.currentMode ? 80 : 0
  return urgency + due + task.carries * 25 + cohesion - task.estimateMin / 10
}

function pack(candidates: Task[], input: FitInput, projects: Map<string, Project>): Task[] {
  const result: Task[] = []
  let used = 0
  for (const task of candidates.sort((a, b) => score(b, taskMode(b, projects), input) - score(a, taskMode(a, projects), input))) {
    if (used + task.estimateMin > input.availableMin) continue
    result.push(task)
    used += task.estimateMin
  }
  return result
}

export function buildFitPlans(tasks: Task[], projects: Project[], input: FitInput): FitPlan[] {
  const projectMap = new Map(projects.filter((project) => project.domain === input.domain).map((project) => [project.id, project]))
  const candidates = tasks.filter((task) => eligible(task, task.projectId ? projectMap.get(task.projectId) : undefined, input))
  const modes = new Map<Mode, Task[]>()
  for (const task of candidates) {
    const mode = taskMode(task, projectMap)
    if (mode) modes.set(mode, [...(modes.get(mode) ?? []), task])
  }
  const plans: FitPlan[] = []
  for (const [mode, items] of modes) {
    const selected = pack(items, { ...input, currentMode: mode }, projectMap)
    if (selected.length) plans.push({ kind: mode === input.currentMode ? 'continue' : 'sweep', tasks: selected, totalMin: selected.reduce((sum, task) => sum + task.estimateMin, 0), mode })
  }
  const mixed = pack(candidates, input, projectMap)
  if (mixed.length) plans.push({ kind: 'mixed', tasks: mixed, totalMin: mixed.reduce((sum, task) => sum + task.estimateMin, 0) })
  return plans.sort((a, b) => b.totalMin - a.totalMin || Number(b.kind === 'continue') - Number(a.kind === 'continue')).slice(0, 3)
}
