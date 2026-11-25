import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { FreeNow } from '../domain/calendar'
import { MONEY_FIGURES, type MoneyAccount, type MoneyFigure } from '../domain/money'
import type { Domain, Goal, Horizon, Plan, Priority, Project, Task } from '../domain/types'
import type { AnthropicTool } from './anthropicClient'
import type { VaultStore } from './githubVault'
import { GitHubError } from './githubVault'
import { today } from '../format'
import { isTripTool, runTripTool, tripTools } from '../trips/tripTools'
import { isMailTool, mailTools, runMailTool, type MailReader } from './mailTools'
import { isIssueApp, issueApps, issueBodyLimit, issueTitleLimit, type IssueStore } from '../issues/issues'
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
  /** Only the time the user picked on today. A default is never passed along as theirs. */
  availableMin?: number
  /** What the calendar says about right now, once it has been read. */
  freeNow?: FreeNow
  goals: GoalSummary[]
  projects: ProjectSummary[]
  calendar?: CalendarSummary[]
  /** Personal only: the latest money figures and how each money goal stands, as lines for the prompt. */
  money?: string[]
}
export type CalendarSummary = Pick<CalendarBlock, 'subject' | 'start' | 'end' | 'isAllDay'>

export type NewTaskInput = { title: string; dueDate?: string; estimateMin?: number; priority?: Priority; notes?: string; projectId?: string }
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
  /** Personal only. Saves today's money numbers and hands back the way to take them out again. */
  recordMoney?(figures: Partial<Record<MoneyFigure, number>>, accounts: MoneyAccount[]): { saved: string[]; undo(): void }
}

export type ToolContext = { actions: CompanionActions; vault?: VaultStore; memoryFolder?: string; mail?: MailReader; issues?: IssueStore }
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
  { name: 'create_task', description: 'Create a task in this space.', input_schema: { type: 'object', properties: { title: { type: 'string' }, due_date: dateSchema, estimate_min: { type: 'integer', description: 'how long it takes, in minutes' }, priority: { type: 'integer', minimum: 1, maximum: 4, description: '1 is most urgent' }, notes: { type: 'string' }, project_id: { type: 'string', description: 'the project it belongs to, when there is one' } }, required: ['title'] } },
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

const moneyTools: AnthropicTool[] = [
  { name: 'record_money', description: 'Save money numbers as of today, read off screenshots the user sent or stated by them. Only figures that were shown or stated; never work one out. savings is cash in checking and savings together, investments is brokerage and retirement together, and the three debts are what is still owed as positive numbers.', input_schema: { type: 'object', properties: { ...Object.fromEntries(MONEY_FIGURES.map((figure) => [figure, { type: 'number', description: 'dollars' }])), accounts: { type: 'array', description: 'each account shown, named as on screen without account numbers; debts negative', items: { type: 'object', properties: { name: { type: 'string' }, balance: { type: 'number' } }, required: ['name', 'balance'] } } } } },
]

const textTools: AnthropicTool[] = [
  { name: 'draft_text', description: "Show a text message draft with a button that opens the user's messaging app with it filled in. Only when the user asks for a text to be drafted. Nothing is sent: they send it themselves from there.", input_schema: { type: 'object', properties: { body: { type: 'string', description: 'the message, exactly as it should be sent' }, to: { type: 'string', description: 'who it is for: a name, or a phone number when the user gave one' } }, required: ['body'] } },
]

const issueTools: AnthropicTool[] = [
  { name: 'report_issue', description: 'File a bug or a change request for one of the user\'s own apps as a GitHub issue, which an automated fixer picks up. Only when the user asks to report, fix or change something in the app itself. The issue is public: describe only how the app behaves and what should happen instead, with no names, no personal details, and nothing from their tasks, notes, mail, money or health. The user approves the exact words in the app before it is filed.', input_schema: { type: 'object', properties: { app: { type: 'string', enum: [...issueApps], description: 'my-brain is this app; my-mail is the mail app' }, title: { type: 'string', description: 'one plain line naming the problem or the change' }, body: { type: 'string', description: 'what happens now, what should happen, and where in the app' } }, required: ['app', 'title', 'body'] } },
]

/** The tools a message can do without. Tasks and goals always go along. */
export type ToolGroup = 'notes' | 'trips' | 'calendar' | 'mail'

/** The groups this space has at all, which is what a router may leave out. */
export function toolGroups(options: { hasVault: boolean; hasCalendar?: boolean; hasMail?: boolean }): ToolGroup[] {
  return [...(options.hasVault ? ['notes', 'trips'] as const : []), ...(options.hasCalendar ? ['calendar'] as const : []), ...(options.hasMail ? ['mail'] as const : [])]
}

export function companionTools(options: { hasVault: boolean; hasCalendar?: boolean; hasMail?: boolean; hasIssues?: boolean; skip?: ToolGroup[] }): AnthropicTool[] {
  const has = (group: ToolGroup) => toolGroups(options).includes(group) && !options.skip?.includes(group)
  return [
    ...(has('notes') ? [...noteTools, ...memoryTools] : []),
    ...(has('trips') ? tripTools : []),
    ...taskTools,
    ...(has('calendar') ? calendarTools : []),
    ...moneyTools,
    ...textTools,
    ...(has('mail') ? mailTools : []),
    ...(options.hasIssues ? issueTools : []),
  ]
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

async function run(name: string, input: Args, { actions, vault, memoryFolder = 'memory', mail, issues }: ToolContext): Promise<RunResult> {
  if (isTripTool(name)) return runTripTool(name, input, requireVault(vault), today())
  if (isMailTool(name)) {
    if (!mail) throw new Error('email is not connected')
    return done(await runMailTool(name, input, mail))
  }
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
        projectId: optionalString(input, 'project_id'),
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
    case 'record_money': {
      if (!actions.recordMoney) throw new Error('money is not kept in this space')
      const figures: Partial<Record<MoneyFigure, number>> = {}
      for (const figure of MONEY_FIGURES) {
        const amount = optionalNumber(input, figure)
        if (amount !== undefined) figures[figure] = figure === 'netWorth' ? amount : Math.abs(amount)
      }
      const listed = arg(input, 'accounts')
      const accounts = (Array.isArray(listed) ? listed : [])
        .filter((item): item is MoneyAccount => !!item && typeof (item as MoneyAccount).name === 'string' && typeof (item as MoneyAccount).balance === 'number')
        .map((item) => ({ name: item.name.trim(), balance: item.balance }))
      if (!Object.keys(figures).length && !accounts.length) throw new Error('no numbers to save')
      const { saved, undo } = actions.recordMoney(figures, accounts)
      return done({ ok: true, saved }, async () => undo())
    }
    case 'report_issue': {
      if (!issues) throw new Error('there is no issue token in settings')
      const app = arg(input, 'app')
      if (!isIssueApp(app)) throw new Error(`app must be one of ${issueApps.join(', ')}`)
      const title = requireString(input, 'title')
      const body = requireString(input, 'body')
      // What was approved is what is filed: a report too long to file whole is refused, not cut.
      if (title.length > issueTitleLimit) throw new Error(`title is longer than ${issueTitleLimit} characters`)
      if (body.length > issueBodyLimit) throw new Error(`body is longer than ${issueBodyLimit} characters`)
      const filed = await issues.file(app, title, body)
      return done({ ok: true, app, number: filed.number, url: filed.url, next: 'the fixer on the work pc picks it up and opens a pull request; where it stands shows under settings.' })
    }
    case 'draft_text':
      requireString(input, 'body')
      return done({ ok: true, shown: 'the draft is on screen with a button that opens their messaging app. it has not been sent. do not repeat the draft in words.' })
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
    id, taskId: id, domain, title: input.title, notes: input.notes, dueDate: input.dueDate, projectId: input.projectId, completed: false,
    estimateMin, originalEstimateMin: estimateMin, priority, planDate: today, energy: 'shallow',
    place: domain === 'work' ? ['office'] : undefined,
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
  pickedMin?: number
  freeNow?: FreeNow
  money?: string[]
}): PlanSummary {
  const open = input.tasks.filter((task) => task.domain === input.domain && !task.completed && !task.storeType)
  return {
    today: input.today,
    openCount: open.length,
    dueToday: input.commitments.map(summarizeTask),
    overdue: open.filter((task) => task.dueDate && task.dueDate < input.today).map(summarizeTask),
    thisWeek: input.weeklyCommitments.map(summarizeTask),
    suggested: input.plan.tasks.slice(0, 8).map(summarizeTask),
    availableMin: input.pickedMin,
    freeNow: input.freeNow,
    goals: input.goals.filter((goal) => goal.domain === input.domain && goal.status === 'active').map(summarizeGoal),
    projects: input.projects.filter((project) => project.domain === input.domain && project.status === 'active').map(summarizeProject),
    calendar: (input.calendar ?? []).map(summarizeEvent),
    ...(input.money?.length ? { money: input.money } : {}),
  }
}
