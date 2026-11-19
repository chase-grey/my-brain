import { describe, expect, it } from 'vitest'
import { fakeVault } from './fakeVault'
import { createTrip, defaultListNames, deleteTrip, isPackingPath, loadOverview, packingListName, parseTrip, serializeTrip, sortTrips, tripFolderName, tripFolders, tripNights } from './trip'

const defaults = {
  '30 Trips/packing/always.md': '## clothes\n- [ ] socks\n\n## documents\n- [ ] id\n',
  '30 Trips/packing/beach.md': '## clothes\n- [ ] swimsuit\n- [ ] socks ×2\n',
}

describe('trip notes', () => {
  it('names the folder by month and destination, without characters a path cannot hold', () => {
    expect(tripFolderName('Tulum', '2027-02-12')).toBe('2027-02 Tulum')
    expect(tripFolderName(' Lake: Tahoe/Reno? ', '2027-07-01')).toBe('2027-07 Lake Tahoe Reno')
  })

  it('round-trips trip.md frontmatter', () => {
    const note = serializeTrip({ destination: 'St. John: USVI', start: '2027-02-12', end: '2027-02-19', types: ['beach', 'flight'] })
    expect(note).toBe('---\ntype: trip\ndestination: "St. John: USVI"\nstart: 2027-02-12\nend: 2027-02-19\ntypes: [beach, flight]\n---\n')
    expect(parseTrip('2027-02 St. John USVI', note)).toEqual({ folder: '2027-02 St. John USVI', destination: 'St. John: USVI', start: '2027-02-12', end: '2027-02-19', types: ['beach', 'flight'] })
  })

  it('reads types written as a yaml list and falls back to the folder for the destination', () => {
    expect(parseTrip('2027-02 Tulum', '---\nstart: 2027-02-12\ntypes:\n  - beach\n  - flight\n---\n')).toMatchObject({ destination: 'Tulum', types: ['beach', 'flight'], end: '' })
  })

  it('finds trips and default lists in the vault listing', () => {
    const paths = ['30 Trips/packing/ski.md', '30 Trips/packing/always.md', '30 Trips/2027-02 Tulum/trip.md', '30 Trips/2027-02 Tulum/packing.md', '30 Trips/trip profile.md', '20 Projects/x/trip.md']
    expect(tripFolders(paths)).toEqual(['2027-02 Tulum'])
    expect(defaultListNames(paths)).toEqual(['always', 'ski'])
  })

  it('recognizes the notes packing edits may touch', () => {
    expect(isPackingPath('30 Trips/packing/ski.md')).toBe(true)
    expect(isPackingPath('30 Trips/2027-02 Tulum/packing.md')).toBe(true)
    expect(isPackingPath('30 Trips/2027-02 Tulum/trip.md')).toBe(false)
    expect(isPackingPath('70 Goals/packing.md')).toBe(false)
    expect(packingListName('30 Trips/packing/ski.md')).toBe('ski')
    expect(packingListName('30 Trips/2027-02 Tulum/packing.md')).toBe('2027-02 Tulum')
  })

  it('counts nights and sorts upcoming trips first', () => {
    expect(tripNights({ start: '2027-02-12', end: '2027-02-19' })).toBe(7)
    const trips = [{ start: '2026-08-01', end: '2026-08-05' }, { start: '2027-05-01', end: '2027-05-03' }, { start: '2027-02-12', end: '2027-02-19' }, { start: '2026-03-01', end: '2026-03-02' }]
    expect(sortTrips(trips, '2026-11-09').map((trip) => trip.start)).toEqual(['2027-02-12', '2027-05-01', '2026-08-01', '2026-03-01'])
  })
})

describe('creating a trip', () => {
  it('writes trip.md and a packing list stacked from always and each type', async () => {
    const vault = fakeVault({ ...defaults })
    const created = await createTrip(vault, { destination: 'Tulum', start: '2027-02-12', end: '2027-02-19', types: ['beach', 'flight', 'always'] })
    expect(created.trip).toEqual({ folder: '2027-02 Tulum', destination: 'Tulum', start: '2027-02-12', end: '2027-02-19', types: ['beach', 'flight'] })
    expect(created.missingTypes).toEqual(['flight'])
    expect(vault.notes['30 Trips/2027-02 Tulum/packing.md']).toBe('---\ntype: packing\n---\n\n## clothes\n- [ ] socks\n- [ ] swimsuit\n\n## documents\n- [ ] id\n')
    expect(vault.notes['30 Trips/packing/beach.md']).toBe(defaults['30 Trips/packing/beach.md'])
  })

  it('refuses bad dates and a trip that already exists', async () => {
    const vault = fakeVault({ ...defaults })
    await expect(createTrip(vault, { destination: 'Tulum', start: '2027-02-12', end: '2027-02-10' })).rejects.toThrow('end is before start')
    await expect(createTrip(vault, { destination: '  ', start: '2027-02-12', end: '2027-02-12' })).rejects.toThrow('destination is required')
    await createTrip(vault, { destination: 'Tulum', start: '2027-02-12', end: '2027-02-19' })
    await expect(createTrip(vault, { destination: 'Tulum', start: '2027-02-20', end: '2027-02-21' })).rejects.toThrow('already exists')
  })

  it('lists trips with packing counts and defaults with sizes, then deletes a trip whole', async () => {
    const vault = fakeVault({ ...defaults })
    await createTrip(vault, { destination: 'Tulum', start: '2027-02-12', end: '2027-02-19', types: ['beach'] })
    vault.notes['30 Trips/2027-02 Tulum/packing.md'] = vault.notes['30 Trips/2027-02 Tulum/packing.md'].replace('[ ] socks', '[x] socks')
    const overview = await loadOverview(vault, '2026-11-09')
    expect(overview.trips).toEqual([{ folder: '2027-02 Tulum', destination: 'Tulum', start: '2027-02-12', end: '2027-02-19', types: ['beach'], packed: 1, total: 3 }])
    expect(overview.defaults).toEqual([{ name: 'always', total: 2 }, { name: 'beach', total: 2 }])
    await deleteTrip(vault, '2027-02 Tulum')
    expect(Object.keys(vault.notes).sort()).toEqual(Object.keys(defaults).sort())
  })
})
