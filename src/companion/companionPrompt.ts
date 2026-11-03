import type { Domain } from '../domain/types'
import type { PlanSummary, TaskSummary } from './companionTools'
import { indexEntries, memoryFolders, memoryIndexPath } from './memory'

export type PromptContext = {
  domain: Domain
  summary: PlanSummary
  vaultAvailable: boolean
  /** Raw contents of the vault's memory index, when the app could read it. */
  memoryIndex?: string
}

export const vaultNames: Record<Domain, string> = { personal: 'HomeBase', work: 'Hivemind' }

function taskLine(task: TaskSummary): string {
  const due = task.dueDate ? ` · due ${task.dueDate}` : ''
  return `- ${task.title} (id ${task.id}${due}, ${task.estimateMin}m, p${task.priority})`
}

function section(title: string, lines: string[]): string {
  return lines.length ? `${title}\n${lines.join('\n')}` : `${title}\n- none`
}

function memorySection(domain: Domain, vaultAvailable: boolean, memoryIndex: string | undefined): string {
  const folder = memoryFolders[domain]
  const index = memoryIndexPath(folder)
  if (!vaultAvailable) return `Memory about the user lives in ${index}, which is not reachable from here.`
  const rules = [
    `Each line of the index points at one file in ${folder}/. Open the file when the detail matters before relying on it.`,
    'Save something when you learn a durable fact about the user: a preference, a fact about their life, a standing decision, a correction to how you work. Include why.',
    'Do not save one-off task details, anything already in the index, or anything already in another note. Update the existing memory instead of adding a near duplicate.',
  ]
  if (domain === 'work') {
    return [
      `Memory about the user: read ${index} at the start of this conversation and keep its entries in mind.`,
      ...rules,
      `To save: write ${folder}/<kebab-slug>.md with frontmatter (name, description, metadata.type one of user|feedback|project|reference) and a body, then add "- [slug words](<slug>.md) — description" to ${index}, or edit the existing line. To forget: delete the file and its index line.`,
    ].join(' ')
  }
  const entries = memoryIndex === undefined ? undefined : indexEntries(memoryIndex)
  const listing = entries === undefined ? '- could not be read this turn' : entries.length ? entries.join('\n') : '- nothing yet'
  return [`What you remember about the user (${index}):\n${listing}`, [...rules, 'Use save_memory and forget_memory; read a memory file with read_note.'].join(' ')].join('\n\n')
}

export function buildSystemPrompt({ domain, summary, vaultAvailable, memoryIndex }: PromptContext): string {
  const vault = vaultNames[domain]
  const parts = [
    `You are the companion inside My Brain, a personal planning app. Space: ${domain}. Today: ${summary.today} (local date).`,
    `${summary.openCount} open tasks. ${summary.availableMin} minutes available right now.`,
    section('Due today:', summary.dueToday.map(taskLine)),
    section('Overdue:', summary.overdue.map(taskLine)),
    section('Rest of this week:', summary.thisWeek.map(taskLine)),
    section('Suggested next:', summary.suggested.map(taskLine)),
    section('Active goals:', summary.goals.map((goal) => `- ${goal.title} (id ${goal.id}, ${goal.horizon}${goal.targetDate ? `, target ${goal.targetDate}` : ''})`)),
    section('Active projects:', summary.projects.map((project) => `- ${project.title} (id ${project.id}, mode ${project.mode})`)),
    vaultAvailable
      ? `The ${vault} Obsidian vault is reachable through the note tools. Folders: 00 Weekly Plans/ (YYYY-WNN.md), 20 Projects/, 50 Someday-Maybe/, 70 Goals/. Task syntax inside notes: "- [ ] text 📅 YYYY-MM-DD". Link notes with [[wikilinks]]. Keep YAML frontmatter when rewriting a note. Prefer append_note for logs and weekly plans. Read a note before replacing it.`
      : `The ${vault} vault is not reachable from here, so say so if asked about notes.`,
    memorySection(domain, vaultAvailable, memoryIndex),
    domain === 'work'
      ? 'You run as Claude Code on the work PC with the vault and office tools. The task list above is a read-only snapshot from the app.'
      : 'Use the task and goal tools to make changes in the app. Ids above are the ones the tools expect.',
    'Answer for a phone screen: short, plain, bullets when listing, no tables, headers only for long answers. Ask before overwriting a whole note. Never say a task, goal, or note change is done unless the tool returned ok. If a tool fails, say what failed.',
  ]
  return parts.join('\n\n')
}
