import type { VaultNote, VaultStore } from '../companion/githubVault'
import { journalDay } from '../journal/journal'
import { folderName, inJournal, listFolder, noteTitle } from './notes'

// How the notes list is arranged (AGENTS.md, "arranging notes"). Notes read newest edit first, favorites sit on
// top in the order they were dragged to, and groups are folders that can be made, dragged into an order and
// dropped onto. What was arranged by hand is kept in one file in the vault so every device shows the same.

export type Arrangement = {
  /** Starred notes, in the order they were put. */
  favorites: string[]
  /** Groups made here that hold nothing yet. A folder with a note in it needs no entry. */
  groups: string[]
  /** A folder's groups, by name, in the order they were dragged to. */
  order: Record<string, string[]>
}

export const noArrangement: Arrangement = { favorites: [], groups: [], order: {} }

/** Beside the notes, where Obsidian and the notes list leave a dot file alone. */
export const arrangePath = 'notes/.arrange.json'

const strings = (value: unknown): string[] => Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))] : []

export function parseArrangement(text: string | undefined): Arrangement {
  try {
    const value = JSON.parse(text || '{}') as Partial<Record<keyof Arrangement, unknown>> | null
    if (!value || typeof value !== 'object') return noArrangement
    const order: Record<string, string[]> = {}
    if (value.order && typeof value.order === 'object') for (const [folder, names] of Object.entries(value.order)) if (strings(names).length) order[folder] = strings(names)
    return { favorites: strings(value.favorites), groups: strings(value.groups), order }
  } catch {
    return noArrangement
  }
}

export const arrangementText = (arrangement: Arrangement) => `${JSON.stringify(arrangement, null, 2)}\n`

const parent = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))

/** Stars a note, at the end of the favorites, or takes its star off. */
export function toggleFavorite(arrangement: Arrangement, path: string): Arrangement {
  const favorites = arrangement.favorites.includes(path) ? arrangement.favorites.filter((item) => item !== path) : [...arrangement.favorites, path]
  return { ...arrangement, favorites }
}

/** A renamed or moved note keeps its star and its place among the favorites. */
export function followMove(arrangement: Arrangement, from: string, to: string): Arrangement {
  if (!arrangement.favorites.includes(from)) return arrangement
  return { ...arrangement, favorites: arrangement.favorites.filter((item) => item !== to).map((item) => item === from ? to : item) }
}

/** A deleted note leaves the favorites. */
export function followDelete(arrangement: Arrangement, path: string): Arrangement {
  return arrangement.favorites.includes(path) ? { ...arrangement, favorites: arrangement.favorites.filter((item) => item !== path) } : arrangement
}

/** A new group, empty until a note is put in it. Nothing when there is already a folder by that name. */
export function withGroup(arrangement: Arrangement, notes: VaultNote[], folder: string): Arrangement {
  const taken = (path: string) => path.toLowerCase() === folder.toLowerCase()
  if (arrangement.groups.some(taken) || notes.some((note) => note.path.toLowerCase().startsWith(`${folder.toLowerCase()}/`))) return arrangement
  return { ...arrangement, groups: [...arrangement.groups, folder] }
}

export function withoutGroup(arrangement: Arrangement, folder: string): Arrangement {
  return { ...arrangement, groups: arrangement.groups.filter((item) => item !== folder) }
}

/**
 * A group stays when its last note leaves: it goes only when it is deleted. `notes` is the list without the
 * note that left `from`. The journal's folders are not groups.
 */
export function keepEmptied(arrangement: Arrangement, notes: VaultNote[], from: string): Arrangement {
  const folder = parent(from)
  if (!parent(folder) || inJournal(folder) || arrangement.groups.includes(folder) || notes.some((note) => note.path.startsWith(`${folder}/`))) return arrangement
  return { ...arrangement, groups: [...arrangement.groups, folder] }
}

/** The groups of one folder in the order they were just dragged to. */
export function withOrder(arrangement: Arrangement, folder: string, names: string[]): Arrangement {
  return { ...arrangement, order: { ...arrangement.order, [folder]: names } }
}

/** One item of a list dragged to another place in it. */
export function dragged<T>(list: T[], item: T, to: number): T[] {
  const rest = list.filter((entry) => entry !== item)
  if (rest.length === list.length) return list
  rest.splice(Math.max(0, Math.min(to, rest.length)), 0, item)
  return rest
}

/**
 * What no longer points at anything is dropped, so the file does not grow: stars on notes that are gone, groups
 * that now hold a note (the folder is there on its own) and the order of folders that are gone. Only against a
 * list read from the vault just now, never the device's copy.
 */
export function tidied(arrangement: Arrangement, notes: VaultNote[]): Arrangement {
  const paths = new Set(notes.map((note) => note.path))
  const folders = new Set<string>(arrangement.groups)
  for (const path of paths) for (let folder = parent(path); folder; folder = parent(folder)) folders.add(folder)
  const holds = (folder: string) => notes.some((note) => note.path.startsWith(`${folder}/`))
  const order: Record<string, string[]> = {}
  for (const [folder, names] of Object.entries(arrangement.order)) {
    const left = names.filter((name) => folders.has(`${folder}/${name}`))
    if (left.length) order[folder] = left
  }
  return { favorites: arrangement.favorites.filter((path) => paths.has(path)), groups: arrangement.groups.filter((folder) => !holds(folder)), order }
}

export const sameArrangement = (a: Arrangement, b: Arrangement) => JSON.stringify(a) === JSON.stringify(b)

/** When each note was last edited, by the note's sha: an ISO moment. */
export type Edited = Record<string, string>

/** Sorts above every date: what was just written here and is not in the vault yet, and a group just made. */
const newest = '~'

export type ArrangedGroup = { path: string; name: string; count: number }
export type ArrangedNote = { path: string; title: string }
export type Arranged = { favorites: ArrangedNote[]; groups: ArrangedGroup[]; notes: ArrangedNote[] }

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/**
 * One folder as it is shown. Its notes read last edited first. Its groups keep the order they were dragged to,
 * and until one is dragged they read last edited first too, as does any group newer than that order. Favorites
 * are every starred note that is still there, in the order they were put. Inside the journal nothing changes:
 * years and days read newest first.
 */
export function arrange(notes: VaultNote[], folder: string, arrangement: Arrangement, edited: Edited, unsaved: string[] = []): Arranged {
  const listing = listFolder(notes, folder)
  const titles = new Map(notes.map((note) => [note.path, noteTitle(note.path)]))
  const favorites = arrangement.favorites.filter((path) => titles.has(path)).map((path) => ({ path, title: titles.get(path)! }))
  if (inJournal(folder)) return { favorites, groups: listing.folders, notes: listing.notes }

  const waiting = new Set(unsaved)
  // A journal entry is as new as its day; nothing has to be asked for it.
  const at = (note: VaultNote) => waiting.has(note.path) || !note.sha ? newest : note.edited ?? edited[note.sha] ?? journalDay(note.path) ?? ''
  const when = new Map(notes.map((note) => [note.path, at(note)]))
  const newestFirst = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0)

  const made = arrangement.groups.filter((path) => parent(path) === folder && !listing.folders.some((item) => item.path === path))
  const groups: ArrangedGroup[] = [...listing.folders, ...made.map((path) => ({ path, name: folderName(path), count: 0 }))]
  const groupAt = new Map(groups.map((group) => [group.path, group.count ? notes.reduce((latest, note) => note.path.startsWith(`${group.path}/`) && when.get(note.path)! > latest ? when.get(note.path)! : latest, '') : newest]))
  const placed = arrangement.order[folder] ?? []
  const place = (group: ArrangedGroup) => placed.indexOf(group.name)
  groups.sort((a, b) => {
    const [pa, pb] = [place(a), place(b)]
    if (pa >= 0 && pb >= 0) return pa - pb
    if (pa >= 0 || pb >= 0) return pa >= 0 ? 1 : -1
    return newestFirst(groupAt.get(a.path)!, groupAt.get(b.path)!) || byName(a.name, b.name)
  })

  const sorted = [...listing.notes].sort((a, b) => newestFirst(when.get(a.path) ?? '', when.get(b.path) ?? '') || byName(a.title, b.title))
  return { favorites, groups, notes: sorted }
}

// The device's copy. It is what the list is drawn from, so an arrangement made with no connection shows at once
// and goes to the vault when it can.

export const arrangeKey = 'my-brain.personal.notes.arrange.v1'
export const editedKey = 'my-brain.personal.notes.edited.v1'

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function loadArrangement(store: StorageLike | undefined = storage()): { value: Arrangement; unsent: boolean } {
  try {
    const kept = JSON.parse(store?.getItem(arrangeKey) ?? 'null') as { value?: unknown; unsent?: unknown } | null
    return { value: parseArrangement(JSON.stringify(kept?.value ?? {})), unsent: kept?.unsent === true }
  } catch {
    return { value: noArrangement, unsent: false }
  }
}

export function keepArrangement(value: Arrangement, unsent: boolean, store: StorageLike | undefined = storage()): void {
  try {
    store?.setItem(arrangeKey, JSON.stringify({ value, unsent }))
  } catch {
    // It still shows until the app is closed.
  }
}

type ArrangeStore = Pick<VaultStore, 'readNote'> & Partial<Pick<VaultStore, 'writeNote'>>

const missing = (error: unknown) => (error as { status?: number } | undefined)?.status === 404

/**
 * Settles the device's arrangement with the vault's. One changed here and not yet sent goes up and stands;
 * otherwise the vault's is taken. A vault that cannot be reached, or has none yet, leaves the device's as it is.
 */
export async function syncArrangement(vault: ArrangeStore, store: StorageLike | undefined = storage()): Promise<Arrangement> {
  const kept = loadArrangement(store)
  try {
    if (kept.unsent) {
      await vault.writeNote?.(arrangePath, arrangementText(kept.value))
      const now = loadArrangement(store)
      if (sameArrangement(now.value, kept.value)) keepArrangement(kept.value, false, store)
      return now.value
    }
    const text = await vault.readNote(arrangePath).then(({ content }) => content, (error: unknown) => { if (missing(error)) return undefined; throw error })
    const now = loadArrangement(store)
    if (text === undefined || now.unsent) return now.value
    const value = parseArrangement(text)
    keepArrangement(value, false, store)
    return value
  } catch {
    return loadArrangement(store).value
  }
}

export function loadEdited(store: StorageLike | undefined = storage()): Edited {
  try {
    const value = JSON.parse(store?.getItem(editedKey) ?? '{}') as Edited
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

type DatedStore = { editedDates?: (paths: string[]) => Promise<Record<string, string>> }

/** How many notes one request asks about. */
export const datesAtOnce = 25

/**
 * When each note was last edited. A note's date is asked for once and kept on the device against its sha, so
 * only notes new or changed since are asked about, and a renamed or moved note keeps its date. Journal entries
 * are never asked about. What the vault cannot say stays unknown, and those notes read by name under the rest.
 */
export async function readEdited(from: object, notes: VaultNote[], store: StorageLike | undefined = storage()): Promise<Edited> {
  const vault = from as DatedStore
  const known = loadEdited(store)
  // Only the notes still there are kept.
  const edited: Edited = {}
  for (const note of notes) if (note.sha && known[note.sha]) edited[note.sha] = known[note.sha]
  const unknown = notes.filter((note) => note.sha && !note.edited && !edited[note.sha] && !inJournal(note.path))
  try {
    for (let start = 0; vault.editedDates && start < unknown.length; start += datesAtOnce) {
      const batch = unknown.slice(start, start + datesAtOnce)
      const dates = await vault.editedDates(batch.map((note) => note.path))
      for (const note of batch) if (dates[note.path]) edited[note.sha] = dates[note.path]
    }
  } catch {
    // What was learned so far is kept; the rest is asked for next time.
  }
  try {
    store?.setItem(editedKey, JSON.stringify(edited))
  } catch {
    // Asked again next time.
  }
  return edited
}
