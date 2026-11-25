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
  const bodyTracker = { v: 1 as const, asOf: '2026-11-03', streak: 11, freezes: 4, weeksTracked: 16, weeks, goals: { open: 3, onPace: 3, met: 1, list: [{ title: 'bench 200 lbs', state: 'met' as const }] } }
  const html = renderToStaticMarkup(<ProgressView domain="personal" product={{ ...emptyProductState, bodyTracker }} currentDay="2026-11-04" heldEvents={{}} onProduct={() => {}} onGoals={() => {}} />)
  expect(html).toContain('aria-label="body · 100%"')
  expect(html).toContain('<strong>11</strong> week streak')
  expect(html).toContain('<span>weeks missed</span><small>0 of 4</small>')
  expect(html).toContain('<span>goals behind</span><small>0 of 4</small>')
  expect(html).toContain('href="/workout-tracker/?tab=progress"')
  expect(html).not.toContain('of target')
})

it('opens a slice judged by answers on its things, with no 28-day target', () => {
  vi.stubGlobal('location', { hash: '#progress/creativity' })
  const state = {
    ...emptyProductState,
    ringCommitments: [{ domain: 'creativity' as const, commitment28: 4 }],
    areaThings: [{ id: 'guitar', area: 'creativity' as const, title: 'guitar', happy: 'happy' as const, happyOn: '2026-11-01', streak: 12, streakOn: '2026-11-01' }],
    areaChallenges: [{ id: 'c', area: 'creativity' as const, title: 'songs learned', target: 5, counts: 'logs' as const, startOn: '2026-10-01', taps: 2 }],
  }
  const html = renderToStaticMarkup(<ProgressView domain="personal" product={state} currentDay="2026-11-04" heldEvents={{}} onProduct={() => {}} onGoals={() => {}} />)
  expect(html).toContain('<strong>1 of 1</strong> happy')
  expect(html).toContain('could be more')
  expect(html).toContain('streak 12')
  expect(html).toContain('2 of 5')
  expect(html).toContain('aria-label="creativity · 70%"')
  expect(html).not.toContain('of target')
})

it('dims a slice whose answer is more than 35 days old and says the check-in is due', () => {
  vi.stubGlobal('location', { hash: '#progress/purpose' })
  const state = { ...emptyProductState, areaThings: [{ id: 'm', area: 'purpose' as const, title: 'mentoring', happy: 'happy' as const, happyOn: '2026-09-01' }] }
  const html = renderToStaticMarkup(<ProgressView domain="personal" product={state} currentDay="2026-11-04" heldEvents={{}} onProduct={() => {}} onGoals={() => {}} />)
  expect(html).toContain('is-stale')
  expect(html).toContain('purpose · 100% · check-in due')
  expect(html).toContain('>due</span>')
})
