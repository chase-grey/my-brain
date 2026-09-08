import { describe, expect, it } from 'vitest'
import { buildLifeRing } from './lifeRing'

describe('life ring', () => {
  it('keeps dormant and cold-start arcs neutral', () => {
    const ring = buildLifeRing([{ domain: 'creativity', on: '2026-09-01', value: 1 }], [{ domain: 'creativity', commitment28: 4 }], '2026-09-03')
    expect(ring.find((arc) => arc.domain === 'creativity')).toMatchObject({ fill: 0.25, state: 'establishing', focus: false })
    expect(ring.find((arc) => arc.domain === 'build')).toMatchObject({ state: 'dormant', focus: false })
  })
})
