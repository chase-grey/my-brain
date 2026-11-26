// A project's steps: the pieces of it still to do, kept on the project and in the order they would be done.
// They are not tasks: none of them shows on today until Chase says he is working on the project and for how long,
// and then only the ones he picked, for that day (AGENTS.md, "project steps").

import type { Activity, Domain, Project, Task } from './types'

export type ProjectStep = {
  id: string
  projectId: string
  title: string
  estimateMin: number
  /** The moment it was ticked off. */
  doneAt?: string
  /** The day it was pulled into. It goes back to the project when that day is over. */
  planDate?: string
}

export type StepFields = { projectSteps: ProjectStep[] }
type WithSteps = StepFields & { projects: Project[]; activities: Activity[] }

export const defaultStepMin = 30
/** A finished step is kept this long, the same as an area's logs. */
export const STEP_KEEP_DAYS = 400

const stepTaskPrefix = 'step:'
/** The id a step goes by on today, where it is drawn as a task row. */
export const stepTaskId = (stepId: string) => `${stepTaskPrefix}${stepId}`
export const stepIdOf = (taskId: string) => taskId.startsWith(stepTaskPrefix) ? taskId.slice(stepTaskPrefix.length) : undefined

const localDay = (moment: string) => new Date(moment).toLocaleDateString('en-CA')
const clean = (minutes: unknown) => typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.round(minutes), 24 * 60) : defaultStepMin
const sameTitle = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

export function stepsOf(state: StepFields, projectId: string): ProjectStep[] {
  return state.projectSteps.filter((step) => step.projectId === projectId)
}

export function openSteps(state: StepFields, projectId: string): ProjectStep[] {
  return stepsOf(state, projectId).filter((step) => !step.doneAt)
}

export function stepsLeftMin(state: StepFields, projectId: string): number {
  return openSteps(state, projectId).reduce((sum, step) => sum + step.estimateMin, 0)
}

export function newStep(projectId: string, title: string, estimateMin: unknown, id: string): ProjectStep {
  return { id, projectId, title: title.trim(), estimateMin: clean(estimateMin) }
}

export function withStep<T extends StepFields>(state: T, step: ProjectStep): T {
  const exists = state.projectSteps.some((item) => item.id === step.id)
  return { ...state, projectSteps: exists ? state.projectSteps.map((item) => item.id === step.id ? step : item) : [...state.projectSteps, step] }
}

export function withoutStep<T extends StepFields>(state: T, id: string): T {
  return { ...state, projectSteps: state.projectSteps.filter((item) => item.id !== id) }
}

/** Moves a step one place earlier or later among its project's steps. */
export function withStepMoved<T extends StepFields>(state: T, id: string, delta: -1 | 1): T {
  const step = state.projectSteps.find((item) => item.id === id)
  if (!step) return state
  const own = stepsOf(state, step.projectId)
  const other = own[own.indexOf(step) + delta]
  if (!other) return state
  return { ...state, projectSteps: state.projectSteps.map((item) => item === step ? other : item === other ? step : item) }
}

/**
 * Replaces the steps still open on a project with a new list, in its order. A step whose words did not change
 * keeps its id and its place on today; finished steps are left as they are.
 */
export function withOpenSteps<T extends StepFields>(state: T, projectId: string, list: { title: string; estimateMin?: unknown }[], newId: () => string): T {
  const open = openSteps(state, projectId)
  const used = new Set<ProjectStep>()
  const next = list.filter((item) => item.title.trim()).map((item) => {
    const kept = open.find((step) => !used.has(step) && sameTitle(step.title, item.title))
    if (kept) used.add(kept)
    return kept ? { ...kept, title: item.title.trim(), estimateMin: item.estimateMin === undefined ? kept.estimateMin : clean(item.estimateMin) } : newStep(projectId, item.title, item.estimateMin, newId())
  })
  return { ...state, projectSteps: [...state.projectSteps.filter((step) => step.projectId !== projectId || step.doneAt), ...next] }
}

/** Adds steps to the end of a project, leaving out any it already has by the same words. */
export function withMoreSteps<T extends StepFields>(state: T, projectId: string, list: { title: string; estimateMin?: unknown }[], newId: () => string): T {
  const have = stepsOf(state, projectId)
  const added: ProjectStep[] = []
  for (const item of list) {
    if (!item.title.trim() || [...have, ...added].some((step) => sameTitle(step.title, item.title))) continue
    added.push(newStep(projectId, item.title, item.estimateMin, newId()))
  }
  return added.length ? { ...state, projectSteps: [...state.projectSteps, ...added] } : state
}

/**
 * The steps that fit a length of time: taken in the project's order, each one that still fits. When even the
 * first is longer than the time there is, it is offered alone, as a start on it.
 */
export function fitSteps(steps: ProjectStep[], minutes: number): ProjectStep[] {
  const open = steps.filter((step) => !step.doneAt)
  let left = minutes
  const fit = open.filter((step) => {
    if (step.estimateMin > left) return false
    left -= step.estimateMin
    return true
  })
  return fit.length || !open.length || minutes <= 0 ? fit : [open[0]]
}

/** Puts the picked steps of a project on a day, and takes its other steps off that day. */
export function withSession<T extends StepFields>(state: T, projectId: string, stepIds: string[], day: string): T {
  return {
    ...state,
    projectSteps: state.projectSteps.map((step) => {
      if (step.projectId !== projectId || step.doneAt) return step
      if (stepIds.includes(step.id)) return { ...step, planDate: day }
      if (step.planDate !== day) return step
      const { planDate: _off, ...rest } = step
      return rest
    }),
  }
}

/** Takes a project off a day: its steps go back to the project, none of them lost. */
export function withoutSession<T extends StepFields>(state: T, projectId: string, day: string): T {
  return {
    ...state,
    projectSteps: state.projectSteps.map((step) => {
      if (step.projectId !== projectId || step.planDate !== day) return step
      const { planDate: _off, ...rest } = step
      return rest
    }),
  }
}

/** A finished project gives up the steps it never got to. The ones that were done stay, as its record. */
export function withoutOpenSteps<T extends StepFields>(state: T, projectId: string): T {
  return { ...state, projectSteps: state.projectSteps.filter((step) => step.projectId !== projectId || step.doneAt) }
}

export type ProjectSession = { project: Project; open: ProjectStep[]; done: ProjectStep[] }

/** What was pulled into a day, by project: the steps still to do and the ones ticked off since. */
export function sessionsOn(state: StepFields & { projects: Project[] }, day: string, domain: Domain): ProjectSession[] {
  return state.projects.filter((project) => project.domain === domain).flatMap((project) => {
    const planned = stepsOf(state, project.id).filter((step) => step.planDate === day)
    return planned.length ? [{ project, open: planned.filter((step) => !step.doneAt), done: planned.filter((step) => step.doneAt) }] : []
  })
}

/** Ticks a step off, or takes the tick back. A tick counts for its project and the week the way a finished task does. */
export function withStepToggled<T extends WithSteps>(state: T, id: string, at: string, newId: () => string): T {
  const step = state.projectSteps.find((item) => item.id === id)
  const project = step && state.projects.find((item) => item.id === step.projectId)
  if (!step || !project) return state
  if (step.doneAt) {
    const { doneAt: _undone, ...rest } = step
    const last = state.activities.map((item) => item.kind === 'task-completed' && item.taskId === stepTaskId(id)).lastIndexOf(true)
    return { ...state, projectSteps: state.projectSteps.map((item) => item === step ? rest : item), activities: last < 0 ? state.activities : state.activities.filter((_, index) => index !== last) }
  }
  return {
    ...state,
    projectSteps: state.projectSteps.map((item) => item === step ? { ...step, doneAt: at } : item),
    activities: [...state.activities, { id: newId(), domain: project.domain, kind: 'task-completed', taskId: stepTaskId(id), projectId: project.id, mode: project.mode, occurredAt: at, estimateDeltaMin: step.estimateMin }],
  }
}

/** A step in the shape of a task, so today draws and ticks it with the row every task gets. */
export function stepTask(step: ProjectStep, project: Pick<Project, 'id' | 'domain'>): Task {
  const id = stepTaskId(step.id)
  return {
    id, taskId: id, domain: project.domain, title: step.title, completed: Boolean(step.doneAt), projectId: project.id,
    estimateMin: step.estimateMin, originalEstimateMin: step.estimateMin, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: true,
  }
}

/** The steps ticked off on a day, newest first, as rows for done today. */
export function stepsDoneOn(state: StepFields & { projects: Project[] }, day: string, domain: Domain): { task: Task; at: string }[] {
  return state.projectSteps.flatMap((step) => {
    const project = state.projects.find((item) => item.id === step.projectId && item.domain === domain)
    return project && step.doneAt && localDay(step.doneAt) === day ? [{ task: stepTask(step, project), at: step.doneAt }] : []
  }).sort((a, b) => b.at.localeCompare(a.at))
}

/**
 * Lets steps leave: a day that is over gives its unfinished steps back to their project, a finished step goes
 * after STEP_KEEP_DAYS, and a step whose project is gone goes with it.
 */
export function settleSteps<T extends StepFields & { projects: Project[] }>(state: T, today: string): T {
  const oldest = new Date(`${today}T12:00:00`)
  oldest.setDate(oldest.getDate() - STEP_KEEP_DAYS)
  const cutoff = oldest.toLocaleDateString('en-CA')
  const projects = new Set(state.projects.map((project) => project.id))
  let changed = false
  const projectSteps = state.projectSteps.flatMap((step) => {
    if (!projects.has(step.projectId) || (step.doneAt && localDay(step.doneAt) <= cutoff)) { changed = true; return [] }
    if (step.planDate && step.planDate < today && !step.doneAt) {
      changed = true
      const { planDate: _over, ...rest } = step
      return [rest]
    }
    return [step]
  })
  return changed ? { ...state, projectSteps } : state
}
