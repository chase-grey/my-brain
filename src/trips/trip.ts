import { GitHubError, type VaultStore } from '../companion/githubVault'
import { combineLists, packingProgress, parsePacking, serializePacking } from './packing'

// Vault layout (docs/trips.md):
//   30 Trips/packing/<type>.md        default packing lists; always.md goes on every trip
//   30 Trips/<YYYY-MM destination>/   one folder per trip: trip.md, packing.md
export const tripsFolder = '30 Trips'
export const defaultsFolder = `${tripsFolder}/packing`
export const alwaysList = 'always'
export const defaultListHead = ['---', 'type: packing-default', '---', '']
export const tripListHead = ['---', 'type: packing', '---', '']

export type Trip = { folder: string; destination: string; start: string; end: string; types: string[] }
export type TripInput = { destination: string; start: string; end: string; types?: string[] }
export type TripOverview = {
  trips: (Trip & { packed: number; total: number })[]
  defaults: { name: string; total: number }[]
}

const datePattern = /^\d{4}-\d{2}-\d{2}$/

/** Characters that cannot sit in a path on Windows or break an Obsidian link. */
export function cleanName(value: string): string {
  return value.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').replace(/^[.\s]+|[.\s]+$/g, '')
}

export function tripFolderName(destination: string, start: string): string {
  return `${start.slice(0, 7)} ${cleanName(destination)}`
}

export function tripPaths(folder: string): { trip: string; packing: string } {
  return { trip: `${tripsFolder}/${folder}/trip.md`, packing: `${tripsFolder}/${folder}/packing.md` }
}

export function defaultListPath(name: string): string {
  return `${defaultsFolder}/${cleanName(name)}.md`
}

/** True for the notes the packing tools and screens may edit: a default list or a trip's packing.md. */
export function isPackingPath(path: string): boolean {
  const parts = path.split('/')
  if (parts[0] !== tripsFolder || parts.length !== 3 || !parts[2].endsWith('.md')) return false
  return parts[1] === 'packing' ? parts[2].length > 3 : parts[2] === 'packing.md'
}

/** What to call a packing list in a receipt: the default's name or the trip's folder. */
export function packingListName(path: string): string {
  const parts = path.split('/')
  return parts[1] === 'packing' ? (parts[2] ?? '').replace(/\.md$/, '') : parts[1] ?? path
}

export function tripFolders(paths: string[]): string[] {
  const folders = paths.flatMap((path) => {
    const parts = path.split('/')
    return parts.length === 3 && parts[0] === tripsFolder && parts[1] !== 'packing' && parts[2] === 'trip.md' ? [parts[1]] : []
  })
  return [...new Set(folders)].sort()
}

export function defaultListNames(paths: string[]): string[] {
  const names = paths.flatMap((path) => path.startsWith(`${defaultsFolder}/`) && path.endsWith('.md') && path.split('/').length === 3 ? [path.slice(defaultsFolder.length + 1, -3)] : [])
  // always first: it is the base every trip starts from.
  return names.sort((a, b) => Number(b === alwaysList) - Number(a === alwaysList) || a.localeCompare(b))
}

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, '$2')
}

function frontmatter(markdown: string): Record<string, string | string[]> {
  const lines = markdown.split(/\r?\n/)
  const fields: Record<string, string | string[]> = {}
  if (lines[0] !== '---') return fields
  let listKey: string | undefined
  for (const line of lines.slice(1)) {
    if (line === '---') break
    const entry = /^\s+-\s+(.*)$/.exec(line)
    if (entry && listKey) { (fields[listKey] as string[]).push(unquote(entry[1])); continue }
    const field = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!field) continue
    const value = field[2].trim()
    listKey = undefined
    if (!value) { fields[field[1]] = []; listKey = field[1] }
    else if (value.startsWith('[') && value.endsWith(']')) fields[field[1]] = value.slice(1, -1).split(',').map(unquote).filter(Boolean)
    else fields[field[1]] = unquote(value)
  }
  return fields
}

export function parseTrip(folder: string, markdown: string): Trip {
  const fields = frontmatter(markdown)
  const text = (key: string) => typeof fields[key] === 'string' ? fields[key] as string : ''
  const types = fields.types
  return {
    folder,
    destination: text('destination') || folder.replace(/^\d{4}-\d{2}\s+/, ''),
    start: text('start'),
    end: text('end'),
    types: Array.isArray(types) ? types : types ? [types] : [],
  }
}

export function serializeTrip(trip: Omit<Trip, 'folder'>, body = ''): string {
  const quoted = JSON.stringify(trip.destination)
  return ['---', 'type: trip', `destination: ${quoted}`, `start: ${trip.start}`, `end: ${trip.end}`, `types: [${trip.types.join(', ')}]`, '---', body].join('\n').replace(/\n*$/, '\n')
}

export function tripNights(trip: Pick<Trip, 'start' | 'end'>): number {
  if (!datePattern.test(trip.start) || !datePattern.test(trip.end)) return 0
  return Math.max(0, Math.round((Date.parse(`${trip.end}T12:00:00`) - Date.parse(`${trip.start}T12:00:00`)) / 86_400_000))
}

/** Upcoming and current trips soonest first, then past trips most recent first. */
export function sortTrips<T extends Pick<Trip, 'start' | 'end'>>(trips: T[], today: string): T[] {
  const past = (trip: T) => Boolean(trip.end && trip.end < today)
  return [...trips].sort((a, b) => Number(past(a)) - Number(past(b)) || (past(a) ? b.start.localeCompare(a.start) : a.start.localeCompare(b.start)))
}

export async function readIfExists(vault: VaultStore, path: string): Promise<string | undefined> {
  try {
    return (await vault.readNote(path)).content
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return undefined
    throw error
  }
}

export function validateTripInput(input: TripInput): Omit<Trip, 'folder'> {
  const destination = input.destination.trim()
  if (!cleanName(destination)) throw new Error('destination is required')
  if (!datePattern.test(input.start)) throw new Error('start must be YYYY-MM-DD')
  if (!datePattern.test(input.end)) throw new Error('end must be YYYY-MM-DD')
  if (input.end < input.start) throw new Error('end is before start')
  const types = [...new Set((input.types ?? []).map((type) => cleanName(type)).filter((type) => type && type !== alwaysList))]
  return { destination, start: input.start, end: input.end, types }
}

/** Create the trip's folder: trip.md, and packing.md stacked from always plus each trip type's default list. */
export async function createTrip(vault: VaultStore, input: TripInput): Promise<{ trip: Trip; missingTypes: string[]; total: number }> {
  const fields = validateTripInput(input)
  const trip: Trip = { folder: tripFolderName(fields.destination, fields.start), ...fields }
  const paths = tripPaths(trip.folder)
  if (await readIfExists(vault, paths.trip) !== undefined) throw new Error(`a trip already exists at ${tripsFolder}/${trip.folder}`)
  const sources = await Promise.all([alwaysList, ...trip.types].map(async (name) => ({ name, content: await readIfExists(vault, defaultListPath(name)) })))
  const packing = combineLists(sources.flatMap((source) => source.content === undefined ? [] : [parsePacking(source.content)]), tripListHead)
  // One after the other: each write commits to the same branch.
  await vault.writeNote(paths.trip, serializeTrip(trip))
  await vault.writeNote(paths.packing, serializePacking(packing))
  return { trip, missingTypes: sources.filter((source) => source.content === undefined && source.name !== alwaysList).map((source) => source.name), total: packingProgress(packing).total }
}

export async function deleteTrip(vault: VaultStore, folder: string): Promise<void> {
  const prefix = `${tripsFolder}/${folder}/`
  const notes = (await vault.listNotes()).filter((note) => note.path.startsWith(prefix))
  for (const note of notes) await vault.deleteNote(note.path)
}

/** Every trip with its packing count, and every default list with its size. `read` lets a caller serve from a cache. */
export async function loadOverview(vault: VaultStore, today: string, read: (path: string) => Promise<string | undefined> = (path) => readIfExists(vault, path)): Promise<TripOverview> {
  const paths = (await vault.listNotes()).map((note) => note.path)
  const trips = await Promise.all(tripFolders(paths).map(async (folder) => {
    const files = tripPaths(folder)
    const [tripNote, packingNote] = await Promise.all([read(files.trip), paths.includes(files.packing) ? read(files.packing) : undefined])
    const progress = packingProgress(parsePacking(packingNote ?? ''))
    return { ...parseTrip(folder, tripNote ?? ''), packed: progress.done, total: progress.total }
  }))
  const defaults = await Promise.all(defaultListNames(paths).map(async (name) => ({ name, total: packingProgress(parsePacking(await read(defaultListPath(name)) ?? '')).total })))
  return { trips: sortTrips(trips, today), defaults }
}
