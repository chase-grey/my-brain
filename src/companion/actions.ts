import type { VaultStore } from './githubVault'
import { GitHubError } from './githubVault'
import { memoryFilePath, readMemoryIndex } from './memory'
import type { CompanionActions } from './companionTools'
import { money, moneyFigureLabels, type MoneyFigure } from '../domain/money'
import { describeTripAction, isTripTool, tripReadTools } from '../trips/tripTools'
import { mailToolNames } from './mailTools'
import { isIssueApp, issueAppNames } from '../issues/issues'
import { blockLabel, blockSpan, validBlockStart } from '../domain/timeBlock'
import { duration } from '../format'
import type { Domain } from '../domain/types'

// How much UI an action gets is set by what it costs to be wrong, not by which tool ran.
//   read:  nothing is shown; lists and reads leave no trace.
//   light: happens on the ask and leaves a receipt line with undo.
//   heavy: waits for approval on an inline card; hard to undo or wide in effect.
export type ActionWeight = 'read' | 'light' | 'heavy'
export type ActionStatus = 'pending' | 'running' | 'done' | 'failed' | 'undone' | 'dismissed' | 'expired'
export type ActionField = { label: string; value: string }

export type CompanionAction = {
  id: string
  tool: string
  weight: 'light' | 'heavy'
  /** Imperative, lowercase: what approving does. */
  title: string
  /** Past tense: what the receipt says once it ran. */
  done: string
  fields?: ActionField[]
  status: ActionStatus
  error?: string
}

export type ActionDescription = Pick<CompanionAction, 'weight' | 'title' | 'done' | 'fields'>

export type DescribeContext = { actions: CompanionActions; vault?: VaultStore; memoryFolder?: string; /** Whose calendar a block goes into. */ domain?: Domain }

const readTools = new Set(['list_notes', 'read_note', 'list_tasks', 'list_goals', 'list_project_steps', 'list_calendar', 'today_summary', ...tripReadTools, ...mailToolNames])

/** A list on a card: each line under its number. */
function numbered(lines: string[]): ActionField[] {
  return lines.map((value, index) => ({ label: String(index + 1), value }))
}

function text(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

function quote(value: string): string {
  return `"${value}"`
}

async function noteExists(vault: VaultStore | undefined, path: string): Promise<boolean> {
  if (!vault || !path) return false
  try {
    await vault.readNote(path)
    return true
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return false
    throw error
  }
}

async function memoryDescription(vault: VaultStore | undefined, folder: string, name: string): Promise<string | undefined> {
  if (!vault) return undefined
  const index = await readMemoryIndex(vault, folder).catch(() => '')
  const line = index.split(/\r?\n/).find((entry) => entry.includes(`](${name}.md)`))
  const dash = line?.indexOf(' — ') ?? -1
  return dash >= 0 ? line!.slice(dash + 3).trim() : undefined
}

function firstLine(value: string): string {
  const line = value.split(/\r?\n/).find((part) => part.trim()) ?? ''
  return line.length > 80 ? `${line.slice(0, 77)}…` : line
}

/** Classify a tool call and write its copy. `undefined` means a read: nothing to show. */
export async function describeAction(name: string, input: Record<string, unknown>, { actions, vault, memoryFolder = 'memory', domain = 'personal' }: DescribeContext): Promise<ActionDescription | undefined> {
  if (readTools.has(name)) return undefined
  if (isTripTool(name)) return describeTripAction(name, input)
  switch (name) {
    case 'create_task': {
      const title = text(input, 'title')
      return { weight: 'light', title: `add task ${quote(title)}`, done: `added task ${quote(title)}` }
    }
    case 'complete_task': {
      const title = actions.findTask(text(input, 'id'))?.title ?? text(input, 'id')
      return { weight: 'light', title: `complete task ${quote(title)}`, done: `completed task ${quote(title)}` }
    }
    case 'delete_task': {
      const task = actions.findTask(text(input, 'id'))
      const title = task?.title ?? text(input, 'id')
      const fields: ActionField[] = [{ label: 'task', value: title }]
      if (task?.dueDate) fields.push({ label: 'due', value: task.dueDate })
      if (task?.notes) fields.push({ label: 'notes', value: firstLine(task.notes) })
      return { weight: 'heavy', title: `delete task ${quote(title)}`, done: `deleted task ${quote(title)}`, fields }
    }
    case 'add_goal': {
      const title = text(input, 'title')
      return { weight: 'light', title: `add goal ${quote(title)}`, done: `added goal ${quote(title)}` }
    }
    case 'update_goal': {
      const goal = actions.findGoal(text(input, 'id'))
      const title = goal?.title ?? text(input, 'id')
      const status = text(input, 'status')
      if (status === 'abandoned') return { weight: 'heavy', title: `abandon goal ${quote(title)}`, done: `abandoned goal ${quote(title)}`, fields: [{ label: 'goal', value: title }, { label: 'status', value: 'abandoned' }, ...(goal?.held ? [{ label: 'calendar', value: 'the hold is removed' }] : [])] }
      if (status === 'met') return { weight: 'heavy', title: `mark goal ${quote(title)} met`, done: `marked goal ${quote(title)} met`, fields: [{ label: 'goal', value: title }, { label: 'status', value: 'met' }] }
      const changes = Object.entries(input).filter(([key, value]) => key !== 'id' && value !== undefined && value !== null && value !== '')
      const fields = changes.map(([key, value]) => ({ label: key.replace(/_/g, ' '), value: String(value) }))
      return { weight: 'light', title: `change goal ${quote(title)}`, done: `changed goal ${quote(title)}`, fields }
    }
    case 'hold_in_calendar': {
      // Heavy, like every write to a calendar: it lands outside the app, where other people plan around it.
      const goal = actions.findGoal(text(input, 'id'))
      const title = goal?.title ?? text(input, 'id')
      return { weight: 'heavy', title: `hold ${quote(title)} in the calendar`, done: `held ${quote(title)} in the calendar`, fields: [{ label: 'goal', value: title }, ...(goal?.scheduledOn ? [{ label: 'day', value: goal.scheduledOn }] : []), { label: 'calendar', value: 'personal' }] }
    }
    case 'block_time': {
      const title = text(input, 'title')
      const start = validBlockStart(text(input, 'start'))
      const minutes = typeof input.minutes === 'number' && input.minutes > 0 ? Math.round(input.minutes) : undefined
      const task = actions.findTask(text(input, 'task_id'))
      const project = actions.listProjects().find((item) => item.id === text(input, 'project_id'))
      return {
        weight: 'heavy', title: `block time for ${quote(title)}`, done: `blocked time for ${quote(title)}`,
        fields: [
          { label: 'when', value: start && minutes ? blockLabel(blockSpan(start, minutes)) : text(input, 'start') },
          ...(minutes ? [{ label: 'how long', value: duration(minutes) }] : []),
          ...(task ? [{ label: 'task', value: task.title }] : project ? [{ label: 'project', value: project.title }] : []),
          { label: 'calendar', value: domain },
        ],
      }
    }
    case 'set_project_steps': {
      const title = actions.listProjects().find((item) => item.id === text(input, 'project_id'))?.title ?? text(input, 'project_id')
      const steps = (Array.isArray(input.steps) ? input.steps as Record<string, unknown>[] : []).flatMap((step) => {
        const name = step && typeof step === 'object' && typeof step.title === 'string' ? step.title.trim() : ''
        return name ? [typeof step.minutes === 'number' && step.minutes > 0 ? `${name} · ${duration(Math.round(step.minutes))}` : name] : []
      })
      return { weight: 'heavy', title: `set the steps of ${quote(title)}`, done: `set the steps of ${quote(title)}`, fields: numbered(steps) }
    }
    case 'plan_project_session': {
      const projectId = text(input, 'project_id')
      const title = actions.listProjects().find((item) => item.id === projectId)?.title ?? projectId
      const ids = Array.isArray(input.step_ids) ? input.step_ids : []
      const steps = (actions.listProjectSteps(projectId) ?? []).filter((step) => ids.includes(step.id) && !step.done)
      const total = steps.reduce((sum, step) => sum + step.estimateMin, 0)
      return { weight: 'heavy', title: `work on ${quote(title)} today`, done: `put ${quote(title)} on today`, fields: [...numbered(steps.map((step) => `${step.title} · ${duration(step.estimateMin)}`)), ...(total ? [{ label: 'in all', value: duration(total) }] : [])] }
    }
    case 'record_money': {
      const fields = Object.entries(input).filter(([key, value]) => key !== 'accounts' && typeof value === 'number').map(([key, value]) => ({ label: moneyFigureLabels[key as MoneyFigure] ?? key, value: money(value as number) }))
      return { weight: 'light', title: 'save money numbers', done: 'saved money numbers', fields }
    }
    case 'draft_text': {
      const to = text(input, 'to')
      return { weight: 'light', title: 'draft a text', done: to ? `text for ${to}` : 'text', fields: [...(to ? [{ label: 'to', value: to }] : []), { label: 'text', value: text(input, 'body') }] }
    }
    case 'report_issue': {
      // Heavy: it is published where anyone can read it, so every word that goes is on the card first.
      const title = text(input, 'title')
      const app = input.app
      return { weight: 'heavy', title: `file issue ${quote(title)}`, done: `filed issue ${quote(title)}`, fields: [{ label: 'app', value: isIssueApp(app) ? issueAppNames[app] : String(app ?? '') }, { label: 'issue', value: text(input, 'body') }, { label: 'seen by', value: 'anyone on github' }] }
    }
    case 'save_memory': {
      const name = text(input, 'name')
      const description = text(input, 'description')
      return { weight: 'light', title: `remember ${quote(name)}`, done: `remembered ${quote(name)}`, fields: description ? [{ label: 'about', value: description }] : undefined }
    }
    case 'forget_memory': {
      const name = text(input, 'name')
      const about = await memoryDescription(vault, memoryFolder, name)
      return { weight: 'heavy', title: `forget memory ${quote(name)}`, done: `forgot memory ${quote(name)}`, fields: [{ label: 'memory', value: memoryFilePath(memoryFolder, name) }, ...(about ? [{ label: 'about', value: about }] : [])] }
    }
    case 'write_note': {
      const path = text(input, 'path')
      const content = text(input, 'content')
      const lines = content ? content.split(/\r?\n/).length : 0
      if (await noteExists(vault, path)) {
        return { weight: 'heavy', title: `replace note ${quote(path)}`, done: `replaced note ${quote(path)}`, fields: [{ label: 'note', value: path }, { label: 'new content', value: `${lines} lines, starting ${quote(firstLine(content))}` }] }
      }
      return { weight: 'light', title: `create note ${quote(path)}`, done: `created note ${quote(path)}` }
    }
    case 'append_note': {
      const path = text(input, 'path')
      return { weight: 'light', title: `add to note ${quote(path)}`, done: `added to note ${quote(path)}`, fields: [{ label: 'text', value: firstLine(text(input, 'text')) }] }
    }
    case 'move_note': {
      const from = text(input, 'from')
      const to = text(input, 'to')
      return { weight: 'heavy', title: `move note ${quote(from)}`, done: `moved note ${quote(from)} to ${quote(to)}`, fields: [{ label: 'from', value: from }, { label: 'to', value: to }] }
    }
    default:
      return { weight: 'light', title: name.replace(/_/g, ' '), done: name.replace(/_/g, ' ') }
  }
}

/** How a settled action reads back to the model in later turns, so it knows what the user let through. */
export function actionLine(action: CompanionAction): string {
  switch (action.status) {
    case 'done': return `[${action.done}]`
    case 'undone': return `[${action.done}, then the user undid it]`
    case 'dismissed': return `[${action.title}: the user dismissed it, not done]`
    case 'expired': return `[${action.title}: never approved, not done]`
    case 'failed': return `[${action.title}: failed${action.error ? ` (${action.error})` : ''}]`
    default: return `[${action.title}: waiting for approval]`
  }
}

