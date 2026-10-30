import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/types'
import type { VaultStore } from './githubVault'
import { buildPlanSummary, companionTask, companionTools, executeTool, type CompanionActions } from './companionTools'

function fakeActions(): CompanionActions {
  return {
    listTasks: vi.fn(() => [{ id: 't1', title: 'call plumber', completed: false, estimateMin: 15, priority: 2 as const }]),
    createTask: vi.fn((input) => ({ id: 'new', title: input.title, dueDate: input.dueDate, completed: false, estimateMin: input.estimateMin ?? 30, priority: input.priority ?? 3 as const })),
    completeTask: vi.fn((id) => id === 't1' ? { id, title: 'call plumber', alreadyDone: false } : undefined),
    listGoals: vi.fn(() => []),
    addGoal: vi.fn((input) => ({ id: 'g1', title: input.title, horizon: input.horizon ?? 'season', status: 'active' as const, targetDate: input.targetDate })),
    updateGoal: vi.fn((id, changes) => id === 'g1' ? { id, title: changes.title ?? 'run', horizon: 'season' as const, status: changes.status ?? 'active' as const, targetDate: changes.targetDate } : undefined),
    listProjects: vi.fn(() => []),
    todaySummary: vi.fn(),
  }
}

const vault: VaultStore = {
  listNotes: vi.fn(async () => [{ path: '70 Goals/Run.md', sha: 'a' }, { path: '20 Projects/Deck.md', sha: 'b' }]),
  readNote: vi.fn(async () => ({ content: '# Run', sha: 'a' })),
  writeNote: vi.fn(async () => ({ sha: 'c' })),
  appendNote: vi.fn(async () => ({ sha: 'd' })),
}

describe('companion tools', () => {
  it('only offers note tools when a vault is configured', () => {
    expect(companionTools({ hasVault: false }).map((tool) => tool.name)).not.toContain('read_note')
    expect(companionTools({ hasVault: true }).map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_notes', 'read_note', 'write_note', 'append_note', 'create_task', 'update_goal']))
  })

  it('maps snake_case arguments onto actions', async () => {
    const actions = fakeActions()
    const created = await executeTool('create_task', { title: ' call plumber ', due_date: '2026-11-06', estimate_min: 15, priority: 2 }, { actions })
    expect(created).toEqual({ ok: true, content: expect.stringContaining('"id":"new"') })
    expect(actions.createTask).toHaveBeenCalledWith({ title: 'call plumber', dueDate: '2026-11-06', estimateMin: 15, priority: 2, notes: undefined })

    await executeTool('update_goal', { id: 'g1', status: 'met', hours_committed: 4 }, { actions })
    expect(actions.updateGoal).toHaveBeenCalledWith('g1', { status: 'met', hoursCommitted: 4 })
    expect(await executeTool('complete_task', { id: 't1' }, { actions })).toMatchObject({ ok: true })
  })

  it('returns errors to the model instead of throwing', async () => {
    const actions = fakeActions()
    expect(await executeTool('create_task', { due_date: 'friday' }, { actions })).toEqual({ ok: false, error: 'title is required' })
    expect(actions.createTask).not.toHaveBeenCalled()
    expect(await executeTool('create_task', { title: 'x', due_date: 'friday' }, { actions })).toEqual({ ok: false, error: 'due_date must be YYYY-MM-DD' })
    expect(await executeTool('complete_task', { id: 'missing' }, { actions })).toEqual({ ok: false, error: 'no task with that id' })
    expect(await executeTool('nope', {}, { actions })).toEqual({ ok: false, error: 'unknown tool nope' })
    expect(await executeTool('read_note', { path: 'a.md' }, { actions })).toEqual({ ok: false, error: 'vault is not configured' })
  })

  it('reads and writes vault notes', async () => {
    const actions = fakeActions()
    expect(await executeTool('list_notes', { folder: '70 Goals/' }, { actions, vault })).toEqual({ ok: true, content: JSON.stringify(['70 Goals/Run.md']) })
    expect(await executeTool('read_note', { path: '70 Goals/Run.md' }, { actions, vault })).toEqual({ ok: true, content: '# Run' })
    await executeTool('append_note', { path: '00 Weekly Plans/2026-W44.md', text: '- [ ] x' }, { actions, vault })
    expect(vault.appendNote).toHaveBeenCalledWith('00 Weekly Plans/2026-W44.md', '- [ ] x')
  })

  it('builds app-shaped tasks and plan summaries', () => {
    const task = companionTask('personal', { title: 'call plumber', dueDate: '2026-11-06' }, '2026-10-30', 'id1')
    expect(task).toMatchObject({ id: 'id1', taskId: 'id1', domain: 'personal', estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', planDate: '2026-10-30', metadataComplete: true, completed: false })
    expect(companionTask('work', { title: 'x', estimateMin: 45, priority: 1 }, '2026-10-30', 'id2')).toMatchObject({ place: ['office'], needs: ['computer'], estimateMin: 45, priority: 1 })

    const overdue: Task = { ...task, id: 'late', dueDate: '2026-10-01' }
    const summary = buildPlanSummary({ today: '2026-10-30', domain: 'personal', tasks: [task, overdue], commitments: [], weeklyCommitments: [task], plan: { tasks: [task], totalMin: 30, availableMin: 60 }, goals: [], projects: [] })
    expect(summary).toMatchObject({ openCount: 2, availableMin: 60 })
    expect(summary.overdue.map((item) => item.id)).toEqual(['late'])
    expect(summary.thisWeek[0]).toMatchObject({ id: 'id1', title: 'call plumber' })
  })
})
