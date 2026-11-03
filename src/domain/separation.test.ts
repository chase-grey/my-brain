import { afterEach, describe, expect, it, vi } from 'vitest'
import { bumpTask } from './bump'
import { task } from './fixtures'
import { buildWeekReceipt } from './receipt'
import { projectRemainingMin } from './planning'
import { travelFactor } from './streaks'
import { mergePersonalTasks } from '../data/personalTaskSync'
import { emptyProductState, loadProductState, saveProductState } from '../productState'
import { defaultSettings, loadSettings, saveSettings } from '../settings'
import { TodoGraphProvider } from '../data/todoGraphProvider'
import { WorkBridgeProvider } from '../data/workBridgeProvider'
import type { GraphClient } from '../data/graphClient'
import type { Commitment } from './types'

function storage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  return values
}
afterEach(() => vi.unstubAllGlobals())

describe('work and personal ownership', () => {
  it('isolates persisted product data and personal-only evidence', () => {
    const values = storage()
    const state = { ...structuredClone(emptyProductState), activities: [
      { id: 'same', domain: 'personal' as const, kind: 'strategic' as const, occurredAt: '2026-09-08', minutes: 30 },
      { id: 'same', domain: 'work' as const, kind: 'strategic' as const, occurredAt: '2026-09-08', minutes: 60 },
    ], people: [{ id: 'friend', displayName: 'Personal friend' }] }
    saveProductState(state, 'personal')
    saveProductState(state, 'work')
    expect(loadProductState('work').activities.map((item) => item.minutes)).toEqual([60])
    expect(loadProductState('work').habits).toEqual([])
    expect(loadProductState('work').people).toEqual([])
    expect(values.get('my-brain.work.product.v1')).not.toContain('Personal friend')
    expect(loadProductState('personal').people).toEqual(state.people)
    expect(loadProductState('personal').activities.map((item) => item.minutes)).toEqual([30])
  })

  it('keeps each space?s settings independent', () => {
    const values = storage()
    saveSettings({ ...defaultSettings, floors: ['email'] }, 'work')
    saveSettings({ ...defaultSettings, floors: ['chores'] }, 'personal')
    expect(loadSettings('work').floors).toEqual(['email'])
    expect(loadSettings('personal').floors).toEqual(['chores'])
    expect(values.get('my-brain.personal.settings.v1')).not.toContain('workdayCapacityMin')
    expect(values.get('my-brain.work.settings.v1')).not.toContain('personalWeeklyCeilingMin')
  })

  it('credits only the commitment?s space and week', () => {
    const commitment: Commitment = { domain: 'work', weekStart: '2026-09-07', targetMin: 60, halfTargetMin: 30, ceilingMin: 120, strategicMin: 0, habitDaysRequired: 0, maintenance: [] }
    const receipt = buildWeekReceipt(commitment, [
      { id: 'p', domain: 'personal', kind: 'task-completed', occurredAt: '2026-09-08', estimateDeltaMin: 100, mode: 'personal' },
      { id: 'w', domain: 'work', kind: 'task-completed', occurredAt: '2026-09-08', estimateDeltaMin: 30, mode: 'email' },
      { id: 'next', domain: 'work', kind: 'task-completed', occurredAt: '2026-09-14', estimateDeltaMin: 100 },
    ], [{ domain: 'personal', date: '2026-09-08', kind: 'held' }])
    expect(receipt).toMatchObject({ clearedMin: 30, paid: false, byMode: { email: 30 }, blocksHeld: 0 })
  })

  it('keeps matching project IDs and travel in their own space', () => {
    expect(projectRemainingMin({ id: 'same', domain: 'work', title: 'Work', status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: 'email' }, [task({ projectId: 'same' }), task({ domain: 'work', projectId: 'same', estimateMin: 10 })])).toBe(10)
    expect(travelFactor([{ id: 'p', domain: 'personal', start: '2026-09-07', end: '2026-09-12', capacityFactor: 0, label: 'away' }], '2026-09-07', 'work')).toBe(1)
  })

  it('never displaces a task from the other space', () => {
    const result = bumpTask(task({ domain: 'work' }), '2026-09-08', [task({ id: 'personal', planDate: '2026-09-08' })], 30)
    expect(result.displaced).toEqual([])
  })

  it('rejects foreign tasks before contacting either provider', async () => {
    const graph = { request: vi.fn() } as unknown as GraphClient
    const fetcher = vi.fn()
    await expect(new TodoGraphProvider(graph).updateTask(task({ domain: 'work', providerListId: 'list' }), { completed: true })).rejects.toThrow('another space')
    await expect(new WorkBridgeProvider(undefined, fetcher).updateTask(task(), { completed: true })).rejects.toThrow('another space')
    expect(graph.request).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(mergePersonalTasks([task(), task({ domain: 'work' })], [])).toHaveLength(1)
  })
})
