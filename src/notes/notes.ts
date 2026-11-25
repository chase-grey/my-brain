import type { Attachment } from '../companion/attachments'
import type { VaultNote } from '../companion/githubVault'
import { dayLabel, journalDay, journalFolder } from '../journal/journal'

// The notes screen: what is in the vault's `notes/` folder, with the journal as a folder inside it and a folder
// for each year inside that. Everything here is worked out from file paths; a note is only opened when it is tapped.

export const notesFolder = 'notes'

const inFolder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)
export const inJournal = (path: string) => inFolder(path, journalFolder)

export const folderName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** What a note is called on screen: a journal entry by its day, year included, anything else by its file name. */
export function noteTitle(path: string): string {
  const day = journalDay(path)
  return day ? dayLabel(day) : folderName(path).replace(/\.md$/i, '')
}

export type Listing = { folders: { path: string; name: string; count: number }[]; notes: { path: string; title: string }[] }

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/** What one folder holds: its folders, each with how many notes are under it, then its own notes. */
export function listFolder(notes: VaultNote[], folder: string): Listing {
  const counts = new Map<string, number>()
  const here: string[] = []
  for (const { path } of notes) {
    if (!path.startsWith(`${folder}/`)) continue
    const rest = path.slice(folder.length + 1)
    const slash = rest.indexOf('/')
    if (slash < 0) here.push(path)
    else if (!rest.startsWith('.')) counts.set(rest.slice(0, slash), (counts.get(rest.slice(0, slash)) ?? 0) + 1)
  }
  // The journal reads newest first, years and days alike. Everything else is by name, with the journal on top.
  const newestFirst = inJournal(folder)
  const names = [...counts.keys()].sort((a, b) => newestFirst ? byName(b, a) : `${folder}/${a}` === journalFolder ? -1 : `${folder}/${b}` === journalFolder ? 1 : byName(a, b))
  here.sort((a, b) => newestFirst ? byName(b, a) : byName(noteTitle(a), noteTitle(b)))
  return {
    folders: names.map((name) => ({ path: `${folder}/${name}`, name, count: counts.get(name)! })),
    notes: here.map((path) => ({ path, title: noteTitle(path) })),
  }
}

export const maxFound = 50

/** Notes under `root` whose name, day or folder has every word of the search in it. Names only: nothing is opened. */
export function findNotes(notes: VaultNote[], root: string, query: string): { path: string; title: string; folder: string }[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return notes
    .filter(({ path }) => inFolder(path, root))
    .map(({ path }) => ({ path, title: noteTitle(path), folder: path.slice(root.length + 1, Math.max(root.length + 1, path.lastIndexOf('/'))) }))
    .filter((note) => words.every((word) => `${note.title} ${note.folder} ${folderName(note.path)}`.toLowerCase().includes(word)))
    .sort((a, b) => inJournal(a.path) && inJournal(b.path) ? byName(b.path, a.path) : byName(a.title, b.title))
    .slice(0, maxFound)
}

/** Where a new note with this name goes. A name already taken in the folder gets a number; no usable name, no path. */
export function newNotePath(notes: VaultNote[], folder: string, name: string): string | undefined {
  const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim()
  if (!clean) return undefined
  const taken = new Set(notes.map((note) => note.path.toLowerCase()))
  for (let count = 1; ; count += 1) {
    const path = `${folder}/${count > 1 ? `${clean} ${count}` : clean}.md`
    if (!taken.has(path.toLowerCase())) return path
  }
}

/** A note as something a chat message can carry. */
export function noteAttachment(path: string, content: string): Attachment {
  return { name: `${inJournal(path) ? 'journal ' : ''}${noteTitle(path)}`, kind: 'text', mediaType: 'text/markdown', data: content }
}

/**
 * My text and someone else's (the ai, the pc) for the same note, both started from `base`. Nothing either side
 * wrote is dropped and nothing is asked: the lines both sides left alone at the top and bottom are kept once, and
 * where both changed the middle, mine goes first and theirs after it.
 */
export function mergeNote(base: string, mine: string, theirs: string): string {
  if (theirs === base || theirs === mine) return mine
  if (mine === base) return theirs
  const [b, m, t] = [base, mine, theirs].map((text) => text.replace(/\r\n/g, '\n').split('\n'))
  let top = 0
  while (top < b.length && top < m.length && top < t.length && b[top] === m[top] && b[top] === t[top]) top += 1
  let end = 0
  while (end < b.length - top && end < m.length - top && end < t.length - top && b[b.length - 1 - end] === m[m.length - 1 - end] && b[b.length - 1 - end] === t[t.length - 1 - end]) end += 1
  const middle = (lines: string[]) => lines.slice(top, lines.length - end)
  const [baseMid, mineMid, theirsMid] = [middle(b), middle(m), middle(t)]
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((line, index) => line === y[index])
  const blanksAtEnd = (lines: string[]) => {
    let count = 0
    while (count < lines.length && !lines[lines.length - 1 - count].trim()) count += 1
    return count
  }
  const words = (lines: string[]) => {
    const start = lines.findIndex((line) => line.trim())
    return start < 0 ? [] : lines.slice(start, lines.length - blanksAtEnd(lines))
  }
  const mineEnd = mineMid.length - blanksAtEnd(mineMid)
  const merged = same(mineMid, baseMid) || !words(mineMid).length ? theirsMid
    : same(theirsMid, baseMid) || same(mineMid, theirsMid) || !words(theirsMid).length ? mineMid
    // Both changed it: all of mine, a blank line, all of theirs.
    : [...mineMid.slice(0, mineEnd), '', ...words(theirsMid), ...mineMid.slice(mineEnd)]
  return [...b.slice(0, top), ...merged, ...b.slice(b.length - end)].join('\n')
}

/** A note changed here and not yet in the vault, with the text the change started from. Kept on the device so nothing typed or said is lost. */
export type Unsaved = Record<string, { content: string; base: string }>

export const unsavedKey = 'my-brain.personal.notes.unsaved.v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function loadUnsaved(store: StorageLike | undefined = storage()): Unsaved {
  try {
    const value = JSON.parse(store?.getItem(unsavedKey) ?? '{}') as Unsaved
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

/** Keeps a note's unsaved text, or with no entry forgets it once the vault has it. */
export function keepUnsaved(path: string, entry: Unsaved[string] | undefined, store: StorageLike | undefined = storage()): void {
  try {
    const all = loadUnsaved(store)
    if (entry) all[path] = entry
    else delete all[path]
    if (Object.keys(all).length) store?.setItem(unsavedKey, JSON.stringify(all))
    else store?.removeItem(unsavedKey)
  } catch {
    // The words still sit on screen.
  }
}
