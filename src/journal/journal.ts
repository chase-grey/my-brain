import type { Attachment } from '../companion/attachments'
import type { VaultNote, VaultStore } from '../companion/githubVault'
import type { Domain } from '../domain/types'

/**
 * What the journal needs from wherever it is kept: the notes vault for personal, the bridge for work.
 * The bridge only lists, reads and adds, so a store without `writeNote` is one whose entries cannot be edited.
 */
export type JournalStore = Pick<VaultStore, 'listNotes' | 'readNote' | 'appendNote'> & Partial<Pick<VaultStore, 'writeNote'>>

/** The journal is a folder inside notes, with a folder for each year. */
export const journalFolder = 'notes/journal'

/** One file per day journaled, in its year's folder. */
export const journalPath = (day: string) => `${journalFolder}/${day.slice(0, 4)}/${day}.md`

export function journalDay(path: string): string | undefined {
  const match = /^notes\/journal\/(\d{4})\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path)
  return match && match[2].startsWith(match[1]) ? match[2] : undefined
}

/** The days that have an entry, newest first. */
export function journalDays(notes: VaultNote[]): string[] {
  return notes.flatMap((note) => journalDay(note.path) ?? []).sort().reverse()
}

/** What is added to the day's file: the time as a heading, then the words exactly as they were said or typed. */
export function entryBlock(text: string, at: Date): string {
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  return `## ${time}\n\n${text.trim()}\n`
}

/** "wed, nov 25, 2026", the way a day is named everywhere it shows. The year is always there. */
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).toLowerCase()
}

/** A day's file with a new entry started at the end: the time as a heading, then any words already waiting. */
export function withNewEntry(content: string, at: Date, words = ''): string {
  const before = content.trim() ? `${content.replace(/\s+$/, '')}\n\n` : ''
  return `${before}${entryBlock(words, at).replace(/\n+$/, '\n')}`
}

/** A day's entry as something a chat message can carry. */
export function journalAttachment(day: string, content: string): Attachment {
  return { name: `journal ${dayLabel(day)}`, kind: 'text', mediaType: 'text/markdown', data: content }
}

/** The file as the screen shows it: time headings and paragraphs, no markdown marks, frontmatter left out. */
export function entryParts(content: string): { kind: 'time' | 'words'; text: string }[] {
  const parts: { kind: 'time' | 'words'; text: string }[] = []
  let words: string[] = []
  const flush = () => {
    if (words.length) parts.push({ kind: 'words', text: words.join('\n') })
    words = []
  }
  for (const line of content.replace(/\r\n/g, '\n').replace(/^---\n[\s\S]*?\n---\n?/, '').split('\n')) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      parts.push({ kind: 'time', text: heading[1].trim() })
    } else if (line.trim()) words.push(line.trimEnd())
    else flush()
  }
  flush()
  return parts
}

/** Words said or typed and not saved yet. Kept on the device so a closed tab or a failed save loses nothing, and apart for each space. */
export const draftStorageKey = (domain: Domain) => `my-brain.${domain}.journal.draft.v1`

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function loadDraft(domain: Domain, store: StorageLike | undefined = storage()): string {
  try {
    return store?.getItem(draftStorageKey(domain)) ?? ''
  } catch {
    return ''
  }
}

export function saveDraft(text: string, domain: Domain, store: StorageLike | undefined = storage()): void {
  try {
    if (text) store?.setItem(draftStorageKey(domain), text)
    else store?.removeItem(draftStorageKey(domain))
  } catch {
    // The words still sit on screen.
  }
}
