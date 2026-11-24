import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { emptyProductState } from '../productState'
import { ProgressView } from './ProgressView'

const product = { ...emptyProductState, ringCommitments: [{ domain: 'body' as const, commitment28: 8 }], ringEvidence: [{ domain: 'body' as const, on: '2026-11-01', value: 6 }] }
const render = (domain: 'personal' | 'work') => renderToStaticMarkup(<ProgressView domain={domain} product={product} currentDay="2026-11-04" heldEvents={{}} onProduct={() => {}} onGoals={() => {}} />)

afterEach(() => vi.unstubAllGlobals())

it('shows the wheel above the week and goals on personal, and bars only on work', () => {
  vi.stubGlobal('location', { hash: '#progress' })
  const personal = render('personal')
  expect(personal).toContain('life wheel')
  expect(personal).toContain('this week')
  expect(personal).toContain('goals')
  expect(render('work')).not.toContain('life wheel')
})

it('drops a switched-off area from the wheel and will not open it', () => {
  vi.stubGlobal('location', { hash: '#progress/projects' })
  const html = renderToStaticMarkup(<ProgressView domain="personal" product={{ ...product, ringOff: ['projects'] }} currentDay="2026-11-04" heldEvents={{}} onProduct={() => {}} onGoals={() => {}} />)
  expect(html.match(/class="slice-hit"/g)).toHaveLength(7)
  expect(html).not.toContain('projects')
  expect(html).toContain('this week')
})

it('opens the slice named in the hash with the wheel shrunk into the header', () => {
  vi.stubGlobal('location', { hash: '#progress/body' })
  const html = render('personal')
  expect(html).toContain('back to the wheel')
  expect(html).toContain('is-compact')
  expect(html).toContain('<h1 class="slice-title">body</h1>')
  expect(html).toContain('75%')
  expect(html).not.toContain('this week')
})

it('reads the body slice from workout-tracker when it has left a summary', () => {
  vi.stubGlobal('location', { hash: '#progress/body' })
  const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((week) => ({ week, result: 'hit' as const }))
  const bodyTracker = { v: 1 as const, asOf: '2026-11-03', streak: 11, freezes: 4, weeksTracked: 16, weeks, goals: { open: 3, onPace: 3, met: 1 } }
  const html = renderToStaticMarkup(<ProgressView domain="personal" product={{ ...emptyProductState, bodyTracker }} currentDay="2026-11-04" heldEvents={{}} onProduct={() => {}} onGoals={() => {}} />)
  expect(html).toContain('aria-label="body · 100%"')
  expect(html).toContain('<strong>11</strong> week streak')
  expect(html).toContain('<span>weeks hit</span><small>4 of 4</small>')
  expect(html).toContain('<span>goals on pace</span><small>3 of 3</small>')
  expect(html).toContain('<span>goals met</span><small>1</small>')
  expect(html).not.toContain('of target')
})
