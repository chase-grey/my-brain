import { describe, expect, it } from 'vitest'
import { buildLifeRing, RING_DOMAINS } from './lifeRing'

describe('life ring', () => {
  it('keeps dormant and cold-start arcs neutral', () => {
    const ring = buildLifeRing([{ domain: 'creativity', on: '2026-09-01', value: 1 }], [{ domain: 'creativity', commitment28: 4 }], '2026-09-03')
    expect(ring.find((arc) => arc.domain === 'creativity')).toMatchObject({ fill: 0.25, state: 'establishing', focus: false })
    expect(ring.find((arc) => arc.domain === 'projects')).toMatchObject({ state: 'dormant', focus: false })
  })

  it('orders areas most important first with related ones side by side', () => {
    expect(RING_DOMAINS).toEqual(['body', 'rest', 'connection', 'purpose', 'mind', 'creativity', 'projects', 'money'])
    expect(buildLifeRing([], [], '2026-09-03').map((arc) => arc.domain)).toEqual(RING_DOMAINS)
  })

  it('leaves switched-off areas out of the ring', () => {
    const ring = buildLifeRing([], [{ domain: 'projects', commitment28: 4 }], '2026-09-03', ['projects'])
    expect(ring).toHaveLength(7)
    expect(ring.some((arc) => arc.domain === 'projects')).toBe(false)
  })
})
