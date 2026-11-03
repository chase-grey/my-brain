import type { Domain } from '../domain/types'
import { GitHubError, type VaultStore } from './githubVault'

// One durable fact per file under the memory folder, plus MEMORY.md as the index the prompt loads.
// Same shape Claude Code uses for its own memory, so the work side (Claude Code on the bridge) reads it natively.
export const memoryFolders: Record<Domain, string> = { personal: 'memory', work: '99 System/Memory' }
export const memoryTypes = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof memoryTypes)[number]

export type MemoryInput = { name: string; description: string; content: string; type?: MemoryType }

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function memoryIndexPath(folder: string): string {
  return `${folder}/MEMORY.md`
}

export function memoryFilePath(folder: string, name: string): string {
  return `${folder}/${name}.md`
}

export function validateMemoryName(name: string): string {
  const slug = name.trim()
  if (!slugPattern.test(slug) || slug.length > 64) throw new Error('name must be a short kebab-case slug like morning-routine')
  return slug
}

export function renderMemoryFile({ name, description, content, type = 'user' }: MemoryInput): string {
  const lines = ['---', `name: ${name}`, `description: ${yamlString(description)}`, 'metadata:', `  type: ${type}`, '---', '', content.trim(), '']
  return lines.join('\n')
}

function yamlString(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return /[:#\[\]{}&*!|>'"%@`,]|^\s|\s$/.test(flat) ? JSON.stringify(flat) : flat
}

function indexLine(name: string, description: string): string {
  return `- [${name.replace(/-/g, ' ')}](${name}.md) — ${description.replace(/\s+/g, ' ').trim()}`
}

function isEntryFor(line: string, name: string): boolean {
  return line.includes(`](${name}.md)`)
}

export function upsertIndexLine(index: string, name: string, description: string): string {
  const lines = index.split(/\r?\n/)
  const line = indexLine(name, description)
  const at = lines.findIndex((existing) => isEntryFor(existing, name))
  if (at >= 0) lines[at] = line
  else {
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    lines.push(line)
  }
  return `${lines.join('\n')}\n`
}

export function removeIndexLine(index: string, name: string): string {
  const kept = index.split(/\r?\n/).filter((line) => !isEntryFor(line, name))
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop()
  return kept.length ? `${kept.join('\n')}\n` : ''
}

/** The index as the prompt should see it: entry lines only, comments and headings stripped. */
export function indexEntries(index: string): string[] {
  return index
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
}

export async function readMemoryIndex(vault: VaultStore, folder: string): Promise<string> {
  try {
    return (await vault.readNote(memoryIndexPath(folder))).content
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return ''
    throw error
  }
}

export async function saveMemory(vault: VaultStore, folder: string, input: MemoryInput): Promise<{ path: string }> {
  const name = validateMemoryName(input.name)
  const path = memoryFilePath(folder, name)
  await vault.writeNote(path, renderMemoryFile({ ...input, name }))
  const index = await readMemoryIndex(vault, folder)
  await vault.writeNote(memoryIndexPath(folder), upsertIndexLine(index, name, input.description))
  return { path }
}

export async function forgetMemory(vault: VaultStore, folder: string, rawName: string): Promise<{ path: string }> {
  const name = validateMemoryName(rawName)
  const path = memoryFilePath(folder, name)
  await vault.deleteNote(path)
  const index = await readMemoryIndex(vault, folder)
  await vault.writeNote(memoryIndexPath(folder), removeIndexLine(index, name))
  return { path }
}
