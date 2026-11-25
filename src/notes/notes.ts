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

const cleanName = (name: string) => name.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^\.+/, '').trim()

/** Where a new note with this name goes. A name already taken in the folder gets a number; no usable name, no path. */
export function newNotePath(notes: VaultNote[], folder: string, name: string): string | undefined {
  const clean = cleanName(name)
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

/** A rename, move or delete made here that the vault does not have yet. */
export type NoteOp = { kind: 'delete'; path: string } | { kind: 'move'; from: string; to: string }

export const opsKey = 'my-brain.personal.notes.ops.v1'

export function loadOps(store: StorageLike | undefined = storage()): NoteOp[] {
  try {
    const value = JSON.parse(store?.getItem(opsKey) ?? '[]') as NoteOp[]
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function keepOps(ops: NoteOp[], store: StorageLike | undefined = storage()): void {
  try {
    if (ops.length) store?.setItem(opsKey, JSON.stringify(ops))
    else store?.removeItem(opsKey)
  } catch {
    // Nothing to keep it in: the change still shows until the app is closed.
  }
}

/** The list as it stands on this device: the vault's, with what was renamed, moved, deleted or newly written here and not yet sent. */
export function withPending(notes: VaultNote[], unsaved: string[], ops: NoteOp[]): VaultNote[] {
  let list = notes
  for (const op of ops) {
    if (op.kind === 'delete') list = list.filter((note) => note.path !== op.path)
    else list = list.some((note) => note.path === op.to) ? list.filter((note) => note.path !== op.from) : list.map((note) => note.path === op.from ? { ...note, path: op.to } : note)
  }
  const have = new Set(list.map((note) => note.path))
  return [...list, ...unsaved.filter((path) => !have.has(path)).map((path) => ({ path, sha: '' }))]
}

const parent = (path: string) => path.slice(0, path.lastIndexOf('/'))

/** The folders a note can be moved to: notes itself and every folder under it, the journal left out. */
export function noteFolders(notes: VaultNote[]): string[] {
  const folders = new Set([notesFolder])
  for (const { path } of notes) {
    if (!inFolder(path, notesFolder) || inJournal(path)) continue
    for (let folder = parent(path); folder.length > notesFolder.length; folder = parent(folder)) folders.add(folder)
  }
  return [...folders].filter((folder) => !folder.split('/').some((part) => part.startsWith('.'))).sort((a, b) => a === notesFolder ? -1 : b === notesFolder ? 1 : byName(a, b))
}

/** What a folder is called where one is picked: `notes`, or its path under notes. */
export const folderLabel = (folder: string) => folder === notesFolder ? notesFolder : folder.slice(notesFolder.length + 1)

/** A typed folder name as a folder under notes. The journal cannot be moved into. */
export function folderPath(name: string): string | undefined {
  const parts = name.split('/').map(cleanName).filter(Boolean)
  if (parts[0]?.toLowerCase() === notesFolder) parts.shift()
  const folder = [notesFolder, ...parts].join('/')
  return inJournal(folder.toLowerCase()) ? undefined : folder
}

/** Where a note goes under a new name, or nothing when the name is not usable or not a change. A journal entry is named by its day and keeps it. */
export function renamedPath(notes: VaultNote[], path: string, name: string): string | undefined {
  if (inJournal(path)) return undefined
  const to = newNotePath(notes.filter((note) => note.path !== path), parent(path), name)
  return to === path ? undefined : to
}

/** Where a note goes in another folder, or nothing when it is already there. A journal entry stays in its year. */
export function movedPath(notes: VaultNote[], path: string, folder: string): string | undefined {
  if (inJournal(path) || inJournal(folder) || parent(path) === folder) return undefined
  return newNotePath(notes, folder, noteTitle(path))
}
