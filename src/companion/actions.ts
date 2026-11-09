import type { VaultStore } from './githubVault'
import { GitHubError } from './githubVault'
import { memoryFilePath, readMemoryIndex } from './memory'
import type { CompanionActions } from './companionTools'

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

export type DescribeContext = { actions: CompanionActions; vault?: VaultStore; memoryFolder?: string }

const readTools = new Set(['list_notes', 'read_note', 'list_tasks', 'list_goals', 'list_calendar', 'today_summary'])

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
export async function describeAction(name: string, input: Record<string, unknown>, { actions, vault, memoryFolder = 'memory' }: DescribeContext): Promise<ActionDescription | undefined> {
  if (readTools.has(name)) return undefined
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
      const goal = actions.findGoal(text(input, 'id'))
      const title = goal?.title ?? text(input, 'id')
      return { weight: 'light', title: `hold ${quote(title)} in the calendar`, done: `held ${quote(title)} in the calendar`, fields: goal?.scheduledOn ? [{ label: 'day', value: goal.scheduledOn }] : undefined }
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

