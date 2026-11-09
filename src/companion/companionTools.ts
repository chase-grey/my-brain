import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { Domain, Goal, Horizon, Plan, Priority, Project, Task } from '../domain/types'
import type { AnthropicTool } from './anthropicClient'
import type { VaultStore } from './githubVault'
import { GitHubError } from './githubVault'
import { forgetMemory, memoryFilePath, memoryIndexPath, memoryTypes, readMemoryIndex, saveMemory, validateMemoryName } from './memory'

export type TaskSummary = Pick<Task, 'id' | 'title' | 'dueDate' | 'completed' | 'estimateMin' | 'priority' | 'projectId' | 'notes'>
export type GoalSummary = Pick<Goal, 'id' | 'title' | 'horizon' | 'status' | 'targetDate' | 'hoursCommitted' | 'shape' | 'scheduledOn'> & { funded?: boolean; held?: boolean }
export type ProjectSummary = Pick<Project, 'id' | 'title' | 'status' | 'mode' | 'goalId'>
export type PlanSummary = {
  today: string
  openCount: number
  dueToday: TaskSummary[]
  overdue: TaskSummary[]
  thisWeek: TaskSummary[]
  suggested: TaskSummary[]
  availableMin: number
  goals: GoalSummary[]
  projects: ProjectSummary[]
  calendar?: CalendarSummary[]
}
export type CalendarSummary = Pick<CalendarBlock, 'subject' | 'start' | 'end' | 'isAllDay'>

export type NewTaskInput = { title: string; dueDate?: string; estimateMin?: number; priority?: Priority; notes?: string }
export type NewGoalInput = { title: string; horizon?: Horizon; targetDate?: string }
export type GoalChanges = Partial<Pick<Goal, 'title' | 'status' | 'targetDate' | 'hoursCommitted' | 'funded' | 'shape' | 'scheduledOn'>>

export interface CompanionActions {
  listTasks(options?: { includeCompleted?: boolean }): TaskSummary[]
  findTask(id: string): TaskSummary | undefined
  createTask(input: NewTaskInput): TaskSummary
  completeTask(id: string): { id: string; title: string; alreadyDone: boolean } | undefined
  /** Puts a completed task back to open; the inverse of completeTask. */
  reopenTask(id: string): void
  /** Removes a task and hands back the whole record so restoreTask can put it back as it was. */
  removeTask(id: string): Task | undefined
  restoreTask(task: Task): void
  listGoals(): GoalSummary[]
  findGoal(id: string): GoalSummary | undefined
  addGoal(input: NewGoalInput): GoalSummary
  updateGoal(id: string, changes: GoalChanges): GoalSummary | undefined
  removeGoal(id: string): void
  listProjects(): ProjectSummary[]
  listCalendar(): CalendarBlock[]
  holdGoal(id: string): Promise<GoalSummary>
  releaseGoal(id: string): Promise<void>
  todaySummary(): PlanSummary
}

export type ToolContext = { actions: CompanionActions; vault?: VaultStore; memoryFolder?: string }
export type Undo = () => Promise<void>
/** A successful change carries the way back; reads and failures do not. */
export type ToolOutcome = { ok: true; content: string; undo?: Undo } | { ok: false; error: string }

const datePattern = /^\d{4}-\d{2}-\d{2}$/
const dateSchema = { type: 'string', description: 'YYYY-MM-DD' }

const noteTools: AnthropicTool[] = [
  { name: 'list_notes', description: 'List the markdown notes in the vault, optionally under one folder.', input_schema: { type: 'object', properties: { folder: { type: 'string', description: 'folder prefix such as "70 Goals"' } } } },
  { name: 'read_note', description: 'Read the full text of one vault note.', input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_note', description: 'Replace a vault note with new content, creating it when missing. Read it first unless the user asked for a fresh note.', input_schema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'append_note', description: 'Append text to the end of a vault note, creating it when missing.', input_schema: { type: 'object', properties: { path: { type: 'string' }, text: { type: 'string' } }, required: ['path', 'text'] } },
  { name: 'move_note', description: 'Move or rename a vault note. The user approves this in the app before it runs.', input_schema: { type: 'object', properties: { from: { type: 'string', description: 'current path' }, to: { type: 'string', description: 'new path, including the folder' } }, required: ['from', 'to'] } },
]

const memoryTools: AnthropicTool[] = [
  { name: 'save_memory', description: 'Remember something durable about the user: a preference, a fact about their life, a standing decision, or a correction. Writes one memory file and updates the index. Reuse an existing name to update that memory.', input_schema: { type: 'object', properties: { name: { type: 'string', description: 'short kebab-case slug, e.g. morning-routine' }, description: { type: 'string', description: 'one line shown in the index' }, content: { type: 'string', description: 'the memory itself; for a correction include why' }, type: { type: 'string', enum: [...memoryTypes] } }, required: ['name', 'description', 'content'] } },
  { name: 'forget_memory', description: 'Delete one memory by name and drop it from the index.', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
]

const taskTools: AnthropicTool[] = [
  { name: 'list_tasks', description: 'List the tasks in this space with their ids.', input_schema: { type: 'object', properties: { include_completed: { type: 'boolean' } } } },
  { name: 'create_task', description: 'Create a task in this space.', input_schema: { type: 'object', properties: { title: { type: 'string' }, due_date: dateSchema, estimate_min: { type: 'integer' }, priority: { type: 'integer', minimum: 1, maximum: 4, description: '1 is most urgent' }, notes: { type: 'string' } }, required: ['title'] } },
  { name: 'complete_task', description: 'Mark a task complete by id.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_task', description: 'Delete a task by id. The user approves this in the app before it runs; completing is usually the better choice.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list_goals', description: 'List active goals and projects with their ids.', input_schema: { type: 'object', properties: {} } },
  { name: 'add_goal', description: 'Add a goal.', input_schema: { type: 'object', properties: { title: { type: 'string' }, horizon: { type: 'string', enum: ['year', 'season', 'month'] }, target_date: dateSchema }, required: ['title'] } },
  { name: 'update_goal', description: 'Change a goal by id. A block goal is done in one sitting and has a scheduled_on day instead of hours; a pace goal has hours_committed by a target_date.', input_schema: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string', enum: ['active', 'met', 'abandoned'] }, target_date: dateSchema, hours_committed: { type: 'number' }, funded: { type: 'boolean' }, shape: { type: 'string', enum: ['pace', 'block'] }, scheduled_on: dateSchema }, required: ['id'] } },
  { name: 'today_summary', description: 'Current view of today: due, overdue, this week, suggestions, available minutes, calendar.', input_schema: { type: 'object', properties: {} } },
]

const calendarTools: AnthropicTool[] = [
  { name: 'list_calendar', description: 'Personal calendar events for the next seven days, in local time.', input_schema: { type: 'object', properties: {} } },
  { name: 'hold_in_calendar', description: 'Write a block goal\'s scheduled day into the personal calendar as a busy afternoon so the day stays free. Set scheduled_on with update_goal first.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'goal id' } }, required: ['id'] } },
]

export function companionTools(options: { hasVault: boolean; hasCalendar?: boolean }): AnthropicTool[] {
  const tools = options.hasCalendar ? [...taskTools, ...calendarTools] : taskTools
  return options.hasVault ? [...noteTools, ...memoryTools, ...tools] : tools
}

type Args = Record<string, unknown>

function arg(input: Args, key: string): unknown {
  return input[key]
}

function requireString(input: Args, key: string): string {
  const value = arg(input, key)
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
  return value
}

function optionalString(input: Args, key: string): string | undefined {
  const value = arg(input, key)
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${key} must be text`)
  return value
}

function optionalDate(input: Args, key: string): string | undefined {
  const value = optionalString(input, key)
  if (value !== undefined && !datePattern.test(value)) throw new Error(`${key} must be YYYY-MM-DD`)
  return value
}

function optionalNumber(input: Args, key: string): number | undefined {
  const value = arg(input, key)
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || Number.isNaN(value)) throw new Error(`${key} must be a number`)
  return value
}

function optionalEnum<T extends string>(input: Args, key: string, allowed: readonly T[]): T | undefined {
  const value = optionalString(input, key)
  if (value !== undefined && !allowed.includes(value as T)) throw new Error(`${key} must be one of ${allowed.join(', ')}`)
  return value as T | undefined
}

type RunResult = { result: unknown; undo?: Undo }

function done(result: unknown, undo?: Undo): RunResult {
  return { result, undo }
}

/** The note's content, or undefined when there is none; any other failure still throws. */
async function readIfExists(vault: VaultStore, path: string): Promise<string | undefined> {
  try {
    return (await vault.readNote(path)).content
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return undefined
    throw error
  }
}

/** Put a note back to how it was: its old content, or gone when it did not exist. */
async function restoreNote(vault: VaultStore, path: string, previous: string | undefined): Promise<void> {
  if (previous === undefined) await vault.deleteNote(path)
  else await vault.writeNote(path, previous)
}

function requireVault(vault: VaultStore | undefined): VaultStore {
  if (!vault) throw new Error('vault is not configured')
  return vault
}

async function run(name: string, input: Args, { actions, vault, memoryFolder = 'memory' }: ToolContext): Promise<RunResult> {
  switch (name) {
    case 'save_memory': {
      const store = requireVault(vault)
      const memoryName = validateMemoryName(requireString(input, 'name'))
      const path = memoryFilePath(memoryFolder, memoryName)
      const [previous, previousIndex] = await Promise.all([readIfExists(store, path), readMemoryIndex(store, memoryFolder)])
      const result = await saveMemory(store, memoryFolder, {
        name: memoryName,
        description: requireString(input, 'description'),
        content: requireString(input, 'content'),
        type: optionalEnum(input, 'type', memoryTypes),
      })
      return done(result, async () => {
        await restoreNote(store, path, previous)
        await store.writeNote(memoryIndexPath(memoryFolder), previousIndex)
      })
    }
    case 'forget_memory': {
      const store = requireVault(vault)
      const memoryName = validateMemoryName(requireString(input, 'name'))
      const path = memoryFilePath(memoryFolder, memoryName)
      const [previous, previousIndex] = await Promise.all([readIfExists(store, path), readMemoryIndex(store, memoryFolder)])
      const result = await forgetMemory(store, memoryFolder, memoryName)
      return done(result, async () => {
        if (previous !== undefined) await store.writeNote(path, previous)
        await store.writeNote(memoryIndexPath(memoryFolder), previousIndex)
      })
    }
    case 'list_notes': {
      const store = requireVault(vault)
      const folder = optionalString(input, 'folder')?.replace(/\/+$/, '')
      const notes = await store.listNotes()
      return done(notes.map((note) => note.path).filter((path) => !folder || path.startsWith(`${folder}/`)))
    }
    case 'read_note':
      return done((await requireVault(vault).readNote(requireString(input, 'path'))).content)
    case 'write_note': {
      const store = requireVault(vault)
      const path = requireString(input, 'path')
      const previous = await readIfExists(store, path)
      await store.writeNote(path, requireString(input, 'content'))
      return done({ ok: true, path }, () => restoreNote(store, path, previous))
    }
    case 'append_note': {
      const store = requireVault(vault)
      const path = requireString(input, 'path')
      const previous = await readIfExists(store, path)
      await store.appendNote(path, requireString(input, 'text'))
      return done({ ok: true, path }, () => restoreNote(store, path, previous))
    }
    case 'move_note': {
      const store = requireVault(vault)
      const from = requireString(input, 'from')
      const to = requireString(input, 'to')
      if (from === to) throw new Error('from and to are the same path')
      if (await readIfExists(store, to) !== undefined) throw new Error(`a note already exists at ${to}`)
      const content = (await store.readNote(from)).content
      await store.writeNote(to, content)
      await store.deleteNote(from)
      return done({ ok: true, from, to }, async () => {
        await store.writeNote(from, content)
        await store.deleteNote(to)
      })
    }
    case 'list_tasks':
      return done(actions.listTasks({ includeCompleted: arg(input, 'include_completed') === true }))
    case 'create_task': {
      const task = actions.createTask({
        title: requireString(input, 'title').trim(),
        dueDate: optionalDate(input, 'due_date'),
        estimateMin: optionalNumber(input, 'estimate_min'),
        priority: optionalNumber(input, 'priority') as Priority | undefined,
        notes: optionalString(input, 'notes'),
      })
      return done(task, async () => { actions.removeTask(task.id) })
    }
    case 'complete_task': {
      const id = requireString(input, 'id')
      const result = actions.completeTask(id)
      if (!result) throw new Error('no task with that id')
      return done(result, result.alreadyDone ? undefined : async () => { actions.reopenTask(id) })
    }
    case 'delete_task': {
      const removed = actions.removeTask(requireString(input, 'id'))
      if (!removed) throw new Error('no task with that id')
      return done({ id: removed.id, title: removed.title }, async () => { actions.restoreTask(removed) })
    }
    case 'list_goals':
      return done({ goals: actions.listGoals(), projects: actions.listProjects() })
    case 'add_goal': {
      const goal = actions.addGoal({ title: requireString(input, 'title').trim(), horizon: optionalEnum(input, 'horizon', ['year', 'season', 'month'] as const), targetDate: optionalDate(input, 'target_date') })
      return done(goal, async () => { actions.removeGoal(goal.id) })
    }
    case 'update_goal': {
      const id = requireString(input, 'id')
      const changes: GoalChanges = {}
      const title = optionalString(input, 'title')
      const status = optionalEnum(input, 'status', ['active', 'met', 'abandoned'] as const)
      const targetDate = optionalDate(input, 'target_date')
      const hoursCommitted = optionalNumber(input, 'hours_committed')
      const funded = arg(input, 'funded')
      const shape = optionalEnum(input, 'shape', ['pace', 'block'] as const)
      const scheduledOn = optionalDate(input, 'scheduled_on')
      if (title !== undefined) changes.title = title.trim()
      if (status !== undefined) changes.status = status
      if (targetDate !== undefined) changes.targetDate = targetDate
      if (hoursCommitted !== undefined) changes.hoursCommitted = hoursCommitted
      if (typeof funded === 'boolean') changes.funded = funded
      if (shape !== undefined) changes.shape = shape
      if (scheduledOn !== undefined) { changes.scheduledOn = scheduledOn; changes.shape = changes.shape ?? 'block' }
      const previous = actions.findGoal(id)
      const result = actions.updateGoal(id, changes)
      if (!result) throw new Error('no goal with that id')
      // Undo puts back only the fields this call touched, so edits made in between stay.
      const rollback: GoalChanges = {}
      for (const key of Object.keys(changes) as (keyof GoalChanges)[]) (rollback as Record<string, unknown>)[key] = previous?.[key]
      return done(result, previous ? async () => { actions.updateGoal(id, rollback) } : undefined)
    }
    case 'list_calendar':
      return done(actions.listCalendar().map(summarizeEvent))
    case 'hold_in_calendar': {
      const id = requireString(input, 'id')
      const alreadyHeld = actions.findGoal(id)?.held
      const result = await actions.holdGoal(id)
      return done(result, alreadyHeld ? undefined : () => actions.releaseGoal(id))
    }
    case 'today_summary':
      return done(actions.todaySummary())
    default:
      throw new Error(`unknown tool ${name}`)
  }
}

export async function executeTool(name: string, input: unknown, context: ToolContext): Promise<ToolOutcome> {
  try {
    const args = input && typeof input === 'object' ? input as Args : {}
    const { result, undo } = await run(name, args, context)
    const content = typeof result === 'string' ? result : JSON.stringify(result)
    return undo ? { ok: true, content, undo } : { ok: true, content }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'tool failed' }
  }
}

export function summarizeTask(task: Task): TaskSummary {
  const { id, title, dueDate, completed, estimateMin, priority, projectId, notes } = task
  return { id, title, dueDate, completed, estimateMin, priority, projectId, notes }
}

export function summarizeGoal(goal: Goal): GoalSummary {
  const { id, title, horizon, status, targetDate, hoursCommitted, funded, shape, scheduledOn } = goal
  return { id, title, horizon, status, targetDate, hoursCommitted, funded, shape, scheduledOn, held: goal.calendarEventId ? true : undefined }
}

export function summarizeEvent(event: CalendarBlock): CalendarSummary {
  const { subject, start, end, isAllDay } = event
  return { subject, start, end, isAllDay }
}

export function summarizeProject(project: Project): ProjectSummary {
  const { id, title, status, mode, goalId } = project
  return { id, title, status, mode, goalId }
}

export function companionTask(domain: Domain, input: NewTaskInput, today: string, id: string = crypto.randomUUID()): Task {
  const estimateMin = input.estimateMin && input.estimateMin > 0 ? Math.round(input.estimateMin) : 30
  const priority: Priority = input.priority && [1, 2, 3, 4].includes(input.priority) ? input.priority : 3
  return {
    id, taskId: id, domain, title: input.title, notes: input.notes, dueDate: input.dueDate, completed: false,
    estimateMin, originalEstimateMin: estimateMin, priority, planDate: today, energy: 'shallow',
    place: domain === 'work' ? ['office'] : undefined, needs: domain === 'work' ? ['computer'] : undefined,
    pinned: false, carries: 0, metadataComplete: true,
  }
}

export function companionGoal(domain: Domain, input: NewGoalInput, id: string = crypto.randomUUID()): Goal {
  return { id, domain, horizon: input.horizon ?? 'season', title: input.title, funded: true, status: 'active', targetDate: input.targetDate, revisions: [] }
}

export function buildPlanSummary(input: {
  today: string
  domain: Domain
  tasks: Task[]
  commitments: Task[]
  weeklyCommitments: Task[]
  plan: Plan
  goals: Goal[]
  projects: Project[]
  calendar?: CalendarBlock[]
}): PlanSummary {
  const open = input.tasks.filter((task) => task.domain === input.domain && !task.completed && !task.storeType)
  return {
    today: input.today,
    openCount: open.length,
    dueToday: input.commitments.map(summarizeTask),
    overdue: open.filter((task) => task.dueDate && task.dueDate < input.today).map(summarizeTask),
    thisWeek: input.weeklyCommitments.map(summarizeTask),
    suggested: input.plan.tasks.slice(0, 8).map(summarizeTask),
    availableMin: input.plan.availableMin,
    goals: input.goals.filter((goal) => goal.domain === input.domain && goal.status === 'active').map(summarizeGoal),
    projects: input.projects.filter((project) => project.domain === input.domain && project.status === 'active').map(summarizeProject),
    calendar: (input.calendar ?? []).map(summarizeEvent),
  }
}
