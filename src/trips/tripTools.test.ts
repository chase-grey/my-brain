import { describe, expect, it, vi } from 'vitest'
import { describeAction } from '../companion/actions'
import { companionTools, executeTool, type CompanionActions } from '../companion/companionTools'
import { fakeVault } from './fakeVault'

const actions = {} as CompanionActions
const always = '30 Trips/packing/always.md'
const seed = () => fakeVault({ [always]: '## clothes\n- [ ] socks\n', '30 Trips/packing/beach.md': '## clothes\n- [ ] swimsuit\n' })

async function call(vault: ReturnType<typeof fakeVault>, name: string, input: unknown) {
  const outcome = await executeTool(name, input, { actions, vault })
  if (!outcome.ok) throw new Error(outcome.error)
  return { result: JSON.parse(outcome.content), undo: outcome.undo }
}

describe('trip tools', () => {
  it('are offered only when the vault is reachable', () => {
    const names = (hasVault: boolean) => companionTools({ hasVault }).map((tool) => tool.name)
    expect(names(true)).toEqual(expect.arrayContaining(['list_trips', 'create_trip', 'edit_packing_list']))
    expect(names(false)).not.toContain('list_trips')
  })

  it('creates a trip from the default lists and undoes it', async () => {
    const vault = seed()
    const { result, undo } = await call(vault, 'create_trip', { destination: 'Tulum', start: '2027-02-12', end: '2027-02-19', types: ['beach', 'flight'] })
    expect(result).toMatchObject({ folder: '2027-02 Tulum', packing_items: 2, types_without_a_default_list: ['flight'] })
    expect(vault.notes['30 Trips/2027-02 Tulum/packing.md']).toContain('- [ ] swimsuit')
    await undo!()
    expect(Object.keys(vault.notes)).toHaveLength(2)
  })

  it('lists trips and default lists with their note paths', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-09T12:00:00') })
    const vault = seed()
    await call(vault, 'create_trip', { destination: 'Tulum', start: '2027-02-12', end: '2027-02-19' })
    const { result } = await call(vault, 'list_trips', {})
    vi.useRealTimers()
    expect(result.trips).toEqual([expect.objectContaining({ destination: 'Tulum', packed: 0, total: 1, notes: { trip: '30 Trips/2027-02 Tulum/trip.md', packing: '30 Trips/2027-02 Tulum/packing.md' } })])
    expect(result.packing_defaults).toEqual([{ type: 'always', items: 1, path: always }, { type: 'beach', items: 1, path: '30 Trips/packing/beach.md' }])
  })

  it('edits a list item by item, reports what was not on it, and undoes', async () => {
    const vault = seed()
    const { result, undo } = await call(vault, 'edit_packing_list', { path: always, changes: [
      { op: 'add', item: 'charger', section: 'electronics' },
      { op: 'rename', item: 'socks', to: 'socks ×7' },
      { op: 'check', item: 'charger' },
      { op: 'remove', item: 'umbrella' },
    ] })
    expect(result).toEqual({ ok: true, path: always, items: 2, packed: 1, not_on_the_list: ['umbrella'] })
    expect(vault.notes[always]).toBe('## clothes\n- [ ] socks ×7\n\n## electronics\n- [x] charger\n')
    await undo!()
    expect(vault.notes[always]).toBe('## clothes\n- [ ] socks\n')
  })

  it('creates a new default list with frontmatter, and undo removes it', async () => {
    const vault = seed()
    const path = '30 Trips/packing/ski.md'
    const { undo } = await call(vault, 'edit_packing_list', { path, changes: [{ op: 'add', item: 'goggles', section: 'gear' }] })
    expect(vault.notes[path]).toBe('---\ntype: packing-default\n---\n\n## gear\n- [ ] goggles\n')
    await undo!()
    expect(path in vault.notes).toBe(false)
  })

  it('refuses notes that are not packing lists and malformed changes', async () => {
    const vault = seed()
    expect(await executeTool('edit_packing_list', { path: '70 Goals/run.md', changes: [{ op: 'add', item: 'x' }] }, { actions, vault })).toMatchObject({ ok: false })
    expect(await executeTool('edit_packing_list', { path: always, changes: [{ op: 'rename', item: 'socks' }] }, { actions, vault })).toEqual({ ok: false, error: 'rename needs to' })
    expect(await executeTool('edit_packing_list', { path: always, changes: [] }, { actions, vault })).toMatchObject({ ok: false })
    expect(await executeTool('list_trips', {}, { actions })).toEqual({ ok: false, error: 'vault is not configured' })
  })

  it('run at once with a receipt: light actions, and no trace for the read', async () => {
    expect(await describeAction('list_trips', {}, { actions })).toBeUndefined()
    expect(await describeAction('create_trip', { destination: 'Tulum', start: '2027-02-12', end: '2027-02-19' }, { actions })).toEqual({ weight: 'light', title: 'create trip "Tulum"', done: 'created trip "Tulum"', fields: [{ label: 'dates', value: '2027-02-12 to 2027-02-19' }] })
    expect(await describeAction('edit_packing_list', { path: '30 Trips/2027-02 Tulum/packing.md', changes: [{ op: 'add', item: 'hat' }, { op: 'add', item: 'gloves' }, { op: 'rename', item: 'socks', to: 'socks ×7' }] }, { actions })).toEqual({
      weight: 'light', title: 'change packing list "2027-02 Tulum"', done: 'changed packing list "2027-02 Tulum"',
      fields: [{ label: 'add', value: 'hat, gloves' }, { label: 'rename', value: 'socks → socks ×7' }],
    })
  })
})
