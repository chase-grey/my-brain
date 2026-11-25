import { afterEach, expect, it, vi } from 'vitest'
import { loadProductState, saveProductState } from './productState'
import { defaultPersonalHabits } from './domain/habits'

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  return values
}
afterEach(() => vi.unstubAllGlobals())

it('reads the old build area as projects', () => {
  storage({ 'my-brain.personal.product.v1': JSON.stringify({
    ringCommitments: [{ domain: 'build', commitment28: 4 }, { domain: 'body', commitment28: 8 }],
    ringEvidence: [{ domain: 'build', on: '2026-11-01', value: 1 }],
    projects: [{ id: 'p1', domain: 'personal', title: 'bike', status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: 'general', servesDomain: 'build' }],
  }) })
  const state = loadProductState('personal', false)
  expect(state.ringCommitments.map((item) => item.domain)).toEqual(['projects', 'body'])
  expect(state.ringEvidence[0].domain).toBe('projects')
  expect(state.projects[0].servesDomain).toBe('projects')
})

it('keeps switched-off areas on personal and never on work', () => {
  storage()
  const state = { ...loadProductState('personal', false), ringOff: ['projects' as const] }
  saveProductState(state, 'personal')
  saveProductState(state, 'work')
  expect(loadProductState('personal', false).ringOff).toEqual(['projects'])
  expect(loadProductState('work', false).ringOff).toEqual([])
})

it('drops a retired habit a device still has stored', () => {
  const whitening = { ...defaultPersonalHabits[0], id: 'teeth-whitening', title: 'teeth whitening' }
  storage({ 'my-brain.personal.product.v1': JSON.stringify({ habits: [whitening], habitEntries: [{ habitId: 'teeth-whitening', date: '2026-11-20', completedPartIds: ['strip'] }] }) })
  const state = loadProductState('personal')
  expect(state.habits.map((habit) => habit.id)).toEqual(['vitamins'])
  expect(state.habitEntries).toEqual([])
})
