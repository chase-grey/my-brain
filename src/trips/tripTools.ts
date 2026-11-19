import type { AnthropicTool } from '../companion/anthropicClient'
import type { VaultStore } from '../companion/githubVault'
import { addItem, hasItem, packingProgress, parsePacking, removeItem, renameItem, serializePacking, setItemDone, type PackingList } from './packing'
import { createTrip, defaultListHead, defaultsFolder, isPackingPath, loadOverview, packingListName, readIfExists, tripListHead, tripPaths, tripsFolder } from './trip'

// The companion's side of trips. Packing edits are item-level so they run at once with an undo
// instead of waiting on the replace-note approval card.

const changeOps = ['add', 'remove', 'check', 'uncheck', 'rename'] as const
type ChangeOp = (typeof changeOps)[number]
export type PackingChange = { op: ChangeOp; item: string; section?: string; to?: string }
type Args = Record<string, unknown>
type RunResult = { result: unknown; undo?: () => Promise<void> }
type Description = { weight: 'light'; title: string; done: string; fields?: { label: string; value: string }[] }

const dateSchema = { type: 'string', description: 'YYYY-MM-DD' }

export const tripTools: AnthropicTool[] = [
  { name: 'list_trips', description: 'List trips (folder, dates, trip types, packing progress, note paths) and the default packing lists by trip type.', input_schema: { type: 'object', properties: {} } },
  { name: 'create_trip', description: `Create a trip: writes trip.md and a packing.md stacked from ${defaultsFolder}/always.md plus the default list of each trip type. Types with no default list yet are reported back.`, input_schema: { type: 'object', properties: { destination: { type: 'string' }, start: dateSchema, end: dateSchema, types: { type: 'array', items: { type: 'string' }, description: 'trip types, each the name of a default packing list such as beach or flight' } }, required: ['destination', 'start', 'end'] } },
  {
    name: 'edit_packing_list',
    description: `Change a packing list item by item: a default list (${defaultsFolder}/<type>.md, created when missing) or a trip's packing.md. Read the list with read_note first unless it is new. Scale counts to the trip when it helps, written as "socks ×7".`,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: `${defaultsFolder}/<type>.md or ${tripsFolder}/<trip folder>/packing.md` },
        changes: { type: 'array', items: { type: 'object', properties: { op: { type: 'string', enum: [...changeOps] }, item: { type: 'string', description: 'the item as written on the list; for add, the new item' }, section: { type: 'string', description: 'add only: the heading it goes under, e.g. clothes' }, to: { type: 'string', description: 'rename only: the new text' } }, required: ['op', 'item'] } },
      },
      required: ['path', 'changes'],
    },
  },
]

const tripToolNames = new Set(tripTools.map((tool) => tool.name))
export const tripReadTools = ['list_trips']

export function isTripTool(name: string): boolean {
  return tripToolNames.has(name)
}

function text(input: Args, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

function requireText(input: Args, key: string): string {
  const value = text(input, key)
  if (!value) throw new Error(`${key} is required`)
  return value
}

function packingPath(input: Args): string {
  const path = requireText(input, 'path').replace(/^\/+/, '')
  if (!isPackingPath(path)) throw new Error(`path must be ${defaultsFolder}/<type>.md or ${tripsFolder}/<trip folder>/packing.md`)
  return path
}

export function parseChanges(value: unknown): PackingChange[] {
  if (!Array.isArray(value) || !value.length) throw new Error('changes must be a list with at least one change')
  return value.map((entry) => {
    const change = entry && typeof entry === 'object' ? entry as Args : {}
    const op = text(change, 'op') as ChangeOp
    if (!changeOps.includes(op)) throw new Error(`op must be one of ${changeOps.join(', ')}`)
    const item = requireText(change, 'item')
    if (op === 'rename' && !text(change, 'to')) throw new Error('rename needs to')
    return { op, item, ...(text(change, 'section') ? { section: text(change, 'section') } : {}), ...(text(change, 'to') ? { to: text(change, 'to') } : {}) }
  })
}

/** Apply each change in order. Items a change named that are not on the list come back in `notFound`. */
export function applyChanges(list: PackingList, changes: PackingChange[]): { list: PackingList; notFound: string[] } {
  const notFound: string[] = []
  let current = list
  for (const change of changes) {
    const next = change.op === 'add' ? addItem(current, change.item, change.section)
      : change.op === 'remove' ? removeItem(current, change.item)
      : change.op === 'rename' ? renameItem(current, change.item, change.to ?? '')
      : setItemDone(current, change.item, change.op === 'check')
    const missing = change.op !== 'add' && !hasItem(current, change.item)
    if (missing) notFound.push(change.item)
    current = next
  }
  return { list: current, notFound }
}

export async function runTripTool(name: string, input: Args, vault: VaultStore, today: string): Promise<RunResult> {
  switch (name) {
    case 'list_trips': {
      const overview = await loadOverview(vault, today)
      return {
        result: {
          trips: overview.trips.map((trip) => ({ ...trip, notes: tripPaths(trip.folder) })),
          packing_defaults: overview.defaults.map((list) => ({ type: list.name, items: list.total, path: `${defaultsFolder}/${list.name}.md` })),
        },
      }
    }
    case 'create_trip': {
      const types = Array.isArray(input.types) ? input.types.filter((type): type is string => typeof type === 'string') : []
      const created = await createTrip(vault, { destination: requireText(input, 'destination'), start: requireText(input, 'start'), end: requireText(input, 'end'), types })
      const paths = tripPaths(created.trip.folder)
      return {
        result: { ok: true, ...created.trip, notes: paths, packing_items: created.total, types_without_a_default_list: created.missingTypes },
        undo: async () => { await vault.deleteNote(paths.packing); await vault.deleteNote(paths.trip) },
      }
    }
    case 'edit_packing_list': {
      const path = packingPath(input)
      const changes = parseChanges(input.changes)
      const previous = await readIfExists(vault, path)
      const start = previous === undefined ? { head: path.startsWith(`${defaultsFolder}/`) ? defaultListHead : tripListHead, sections: [] } : parsePacking(previous)
      const { list, notFound } = applyChanges(start, changes)
      const content = serializePacking(list)
      if (content !== previous) await vault.writeNote(path, content)
      const progress = packingProgress(list)
      return {
        result: { ok: true, path, items: progress.total, packed: progress.done, ...(notFound.length ? { not_on_the_list: notFound } : {}) },
        undo: content === previous ? undefined : async () => { if (previous === undefined) await vault.deleteNote(path); else await vault.writeNote(path, previous) },
      }
    }
    default:
      throw new Error(`unknown tool ${name}`)
  }
}

function listed(items: string[]): string {
  const shown = items.slice(0, 6).join(', ')
  return items.length > 6 ? `${shown} and ${items.length - 6} more` : shown
}

/** Receipt copy for a trip tool; undefined for reads. */
export function describeTripAction(name: string, input: Args): Description | undefined {
  if (name === 'create_trip') {
    const destination = text(input, 'destination')
    return { weight: 'light', title: `create trip "${destination}"`, done: `created trip "${destination}"`, fields: [{ label: 'dates', value: `${text(input, 'start')} to ${text(input, 'end')}` }] }
  }
  if (name === 'edit_packing_list') {
    const list = packingListName(text(input, 'path'))
    const changes = Array.isArray(input.changes) ? input.changes.filter((change): change is Args => Boolean(change) && typeof change === 'object') : []
    const fields = changeOps.flatMap((op) => {
      const items = changes.filter((change) => change.op === op).map((change) => op === 'rename' ? `${text(change, 'item')} → ${text(change, 'to')}` : text(change, 'item'))
      return items.length ? [{ label: op, value: listed(items) }] : []
    })
    return { weight: 'light', title: `change packing list "${list}"`, done: `changed packing list "${list}"`, fields }
  }
  return undefined
}
