import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { buildLifeRing } from '../domain/lifeRing'
import { LifeWheel, sliceHealth } from './LifeWheel'

const today = '2026-11-04'
const ring = buildLifeRing(
  [{ domain: 'body', on: '2026-11-01', value: 6 }, { domain: 'mind', on: '2026-10-20', value: 1 }],
  [{ domain: 'body', commitment28: 8 }, { domain: 'mind', commitment28: 4 }, { domain: 'rest', commitment28: 4 }],
  today,
)

it('draws one slice per life domain with its fill in the label', () => {
  const html = renderToStaticMarkup(<LifeWheel arcs={ring} onSelect={() => {}} />)
  expect(html.match(/role="button"/g)).toHaveLength(8)
  expect(html).toContain('aria-label="body · 75%"')
  expect(html).toContain('aria-label="rest · unknown"')
  expect(html).toContain('aria-label="purpose · dormant"')
  expect(html).toContain('is-dormant')
})

it('runs the areas clockwise from 9 o\'clock in their set order', () => {
  const html = renderToStaticMarkup(<LifeWheel arcs={ring} onSelect={() => {}} />)
  const at = (area: string) => {
    const [, x, y] = html.match(new RegExp(`x="(-?[\\d.]+)" y="(-?[\\d.]+)"[^>]*>${area}<`))!
    return { x: Number(x), y: Number(y) }
  }
  const clock = (area: string) => (Math.atan2(at(area).x, -at(area).y) * 6 / Math.PI + 12) % 12
  expect(ring.map((arc) => Math.round(clock(arc.domain) * 10) / 10)).toEqual([9, 10.5, 0, 1.5, 3, 4.5, 6, 7.5])
  expect(ring.map((arc) => arc.domain)).toEqual(['purpose', 'connection', 'body', 'mind', 'creativity', 'projects', 'money', 'rest'])
})

it('reads healthier slices as more of their own hue', () => {
  const body = ring.find((arc) => arc.domain === 'body')!
  const mind = ring.find((arc) => arc.domain === 'mind')!
  const purpose = ring.find((arc) => arc.domain === 'purpose')!
  expect(sliceHealth(body)).toBeGreaterThan(sliceHealth(mind))
  expect(sliceHealth(purpose)).toBe(0)
})

it('dims every other slice while one is selected', () => {
  const html = renderToStaticMarkup(<LifeWheel arcs={ring} selected="body" compact onSelect={() => {}} />)
  expect(html.match(/is-dim/g)).toHaveLength(7)
  expect(html).toContain('is-selected')
  expect(html).toContain('is-compact')
})
