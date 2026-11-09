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

it('opens the slice named in the hash with the wheel shrunk into the header', () => {
  vi.stubGlobal('location', { hash: '#progress/body' })
  const html = render('personal')
  expect(html).toContain('back to the wheel')
  expect(html).toContain('is-compact')
  expect(html).toContain('<h1 class="slice-title">body</h1>')
  expect(html).toContain('75%')
  expect(html).not.toContain('this week')
})
