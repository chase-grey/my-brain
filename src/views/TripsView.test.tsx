import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { fakeStorage, fakeVault } from '../trips/fakeVault'
import { tripCacheKey } from '../trips/packingSync'
import { TripsView } from './TripsView'

const packing = '30 Trips/2027-02 Tulum/packing.md'
const cache = {
  notes: {
    [packing]: { content: '## clothes\n- [x] swimsuit\n- [ ] rain jacket\n', base: '' },
    '30 Trips/packing/beach.md': { content: '## clothes\n- [ ] swimsuit\n', base: '' },
  },
  overview: {
    trips: [{ folder: '2027-02 Tulum', destination: 'Tulum', start: '2027-02-12', end: '2027-02-19', types: ['beach'], packed: 0, total: 2 }],
    defaults: [{ name: 'beach', total: 1 }],
  },
}
const render = (hash: string, vault = fakeVault()) => {
  vi.stubGlobal('location', { hash })
  return renderToStaticMarkup(<TripsView vault={vault} storage={fakeStorage({ [tripCacheKey]: JSON.stringify(cache) })} currentDay="2026-11-09" onSettings={() => {}} />)
}

afterEach(() => vi.unstubAllGlobals())

it('lists trips with what is packed and the default lists, from the device before the vault answers', () => {
  const html = render('#trips')
  expect(html).toContain('Tulum')
  expect(html).toContain('1 of 2 packed')
  expect(html).toContain('packing defaults')
  expect(html).toContain('always')
  expect(html).toContain('beach')
})

it('opens a trip on its checklist', () => {
  const html = render('#trips/trip/2027-02%20Tulum')
  expect(html).toContain('<h1>Tulum</h1>')
  expect(html).toContain('7 nights')
  expect(html).toContain('aria-label="unpack swimsuit"')
  expect(html).toContain('aria-label="pack rain jacket"')
  expect(html).toContain('aria-label="add to clothes"')
})

it('opens a default list without check boxes', () => {
  const html = render('#trips/default/beach')
  expect(html).toContain('<h1>beach</h1>')
  expect(html).toContain('swimsuit')
  expect(html).not.toContain('aria-pressed')
})

it('offers the trip types on a new trip', () => {
  const html = render('#trips/new')
  expect(html).toContain('new trip')
  expect(html).toContain('destination')
  expect(html).toContain('>beach</button>')
})

it('points at settings when there is no vault', () => {
  vi.stubGlobal('location', { hash: '#trips' })
  expect(renderToStaticMarkup(<TripsView currentDay="2026-11-09" onSettings={() => {}} />)).toContain('add one in settings')
})
