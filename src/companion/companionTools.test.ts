import { describe, expect, it, vi } from 'vitest'
import type { Task } from '../domain/types'
import { GitHubError, type VaultStore } from './githubVault'
import { buildPlanSummary, companionTask, companionTools, executeTool, type CompanionActions } from './companionTools'

const plumber: Task = { id: 't1', taskId: 't1', domain: 'personal', title: 'call plumber', completed: false, estimateMin: 15, originalEstimateMin: 15, priority: 2, energy: 'shallow', pinned: false, carries: 0 }
const runGoal = { id: 'g1', title: 'run', horizon: 'season' as const, status: 'active' as const, targetDate: '2026-12-01', hoursCommitted: 10 }

export function fakeActions(): CompanionActions {
  return {
    listTasks: vi.fn(() => [{ id: 't1', title: 'call plumber', completed: false, estimateMin: 15, priority: 2 as const }]),
    findTask: vi.fn((id) => id === 't1' ? { id, title: 'call plumber', completed: false, estimateMin: 15, priority: 2 as const } : undefined),
    createTask: vi.fn((input) => ({ id: 'new', title: input.title, dueDate: input.dueDate, completed: false, estimateMin: input.estimateMin ?? 30, priority: input.priority ?? 3 as const })),
    completeTask: vi.fn((id) => id === 't1' ? { id, title: 'call plumber', alreadyDone: false } : undefined),
    reopenTask: vi.fn(),
    removeTask: vi.fn((id) => id === 't1' ? plumber : undefined),
    restoreTask: vi.fn(),
    listGoals: vi.fn(() => []),
    findGoal: vi.fn((id) => id === 'g1' ? runGoal : undefined),
    addGoal: vi.fn((input) => ({ id: 'g1', title: input.title, horizon: input.horizon ?? 'season', status: 'active' as const, targetDate: input.targetDate })),
    updateGoal: vi.fn((id, changes) => id === 'g1' ? { id, title: changes.title ?? 'run', horizon: 'season' as const, status: changes.status ?? 'active' as const, targetDate: changes.targetDate } : undefined),
    removeGoal: vi.fn(),
    listProjects: vi.fn(() => []),
    listCalendar: vi.fn(() => [{ id: 'e1', subject: 'dinner', start: '2026-11-02T18:00:00', end: '2026-11-02T19:30:00', isAllDay: false }]),
    holdGoal: vi.fn(async (id) => ({ id, title: 'paint the bedroom', horizon: 'season' as const, status: 'active' as const, shape: 'block' as const, scheduledOn: '2026-11-07', held: true })),
    releaseGoal: vi.fn(async () => undefined),
    todaySummary: vi.fn(),
  }
}

const missing = () => Promise.reject(new GitHubError(404, 'not found'))

const vault: VaultStore = {
  listNotes: vi.fn(async () => [{ path: '70 Goals/Run.md', sha: 'a' }, { path: '20 Projects/Deck.md', sha: 'b' }]),
  readNote: vi.fn(async () => ({ content: '# Run', sha: 'a' })),
  writeNote: vi.fn(async () => ({ sha: 'c' })),
  appendNote: vi.fn(async () => ({ sha: 'd' })),
  deleteNote: vi.fn(async () => undefined),
}

describe('companion tools', () => {
  it('only offers note tools when a vault is configured', () => {
    expect(companionTools({ hasVault: false }).map((tool) => tool.name)).not.toContain('read_note')
    expect(companionTools({ hasVault: true }).map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_notes', 'read_note', 'write_note', 'append_note', 'save_memory', 'forget_memory', 'create_task', 'update_goal']))
    expect(companionTools({ hasVault: false }).map((tool) => tool.name)).not.toContain('save_memory')
    expect(companionTools({ hasVault: false }).map((tool) => tool.name)).not.toContain('list_calendar')
    expect(companionTools({ hasVault: false, hasCalendar: true }).map((tool) => tool.name)).toEqual(expect.arrayContaining(['list_calendar', 'hold_in_calendar']))
  })

  it('saves memories under the configured folder', async () => {
    const actions = fakeActions()
    vi.mocked(vault.readNote).mockImplementation((path) => path.endsWith('MEMORY.md') ? Promise.resolve({ content: '', sha: 'i' }) : missing())
    expect(await executeTool('save_memory', { name: 'coffee-order', description: 'black', content: 'No milk.' }, { actions, vault, memoryFolder: '99 System/Memory' })).toMatchObject({ ok: true, content: JSON.stringify({ path: '99 System/Memory/coffee-order.md' }) })
    expect(vault.writeNote).toHaveBeenCalledWith('99 System/Memory/coffee-order.md', expect.stringContaining('name: coffee-order'))
    expect(vault.writeNote).toHaveBeenCalledWith('99 System/Memory/MEMORY.md', '- [coffee order](coffee-order.md) — black\n')
    expect(await executeTool('save_memory', { name: 'Bad Name', description: 'x', content: 'y' }, { actions, vault })).toMatchObject({ ok: false, error: expect.stringContaining('kebab-case') })
    expect(await executeTool('save_memory', { name: 'x', description: 'y', content: 'z' }, { actions })).toEqual({ ok: false, error: 'vault is not configured' })
  })

  it('maps snake_case arguments onto actions', async () => {
    const actions = fakeActions()
    const created = await executeTool('create_task', { title: ' call plumber ', due_date: '2026-11-06', estimate_min: 15, priority: 2 }, { actions })
    expect(created).toMatchObject({ ok: true, content: expect.stringContaining('"id":"new"') })
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
    vi.mocked(vault.readNote).mockImplementation(async () => ({ content: '# Run', sha: 'a' }))
    expect(await executeTool('list_notes', { folder: '70 Goals/' }, { actions, vault })).toEqual({ ok: true, content: JSON.stringify(['70 Goals/Run.md']) })
    expect(await executeTool('read_note', { path: '70 Goals/Run.md' }, { actions, vault })).toEqual({ ok: true, content: '# Run' })
    await executeTool('append_note', { path: '00 Weekly Plans/2026-W44.md', text: '- [ ] x' }, { actions, vault })
    expect(vault.appendNote).toHaveBeenCalledWith('00 Weekly Plans/2026-W44.md', '- [ ] x')
  })

  it('hands back an undo that reverses each task and goal change', async () => {
    const actions = fakeActions()
    const created = await executeTool('create_task', { title: 'x' }, { actions })
    if (!created.ok) throw new Error(created.error)
    await created.undo!()
    expect(actions.removeTask).toHaveBeenCalledWith('new')

    const completed = await executeTool('complete_task', { id: 't1' }, { actions })
    if (!completed.ok) throw new Error(completed.error)
    await completed.undo!()
    expect(actions.reopenTask).toHaveBeenCalledWith('t1')

    const deleted = await executeTool('delete_task', { id: 't1' }, { actions })
    expect(deleted).toMatchObject({ ok: true, content: JSON.stringify({ id: 't1', title: 'call plumber' }) })
    if (!deleted.ok) throw new Error(deleted.error)
    await deleted.undo!()
    expect(actions.restoreTask).toHaveBeenCalledWith(plumber)
    expect(await executeTool('delete_task', { id: 'nope' }, { actions })).toEqual({ ok: false, error: 'no task with that id' })

    const changed = await executeTool('update_goal', { id: 'g1', target_date: '2027-01-01', hours_committed: 20 }, { actions })
    if (!changed.ok) throw new Error(changed.error)
    await changed.undo!()
    expect(actions.updateGoal).toHaveBeenLastCalledWith('g1', { targetDate: '2026-12-01', hoursCommitted: 10 })

    const held = await executeTool('hold_in_calendar', { id: 'g1' }, { actions })
    if (!held.ok) throw new Error(held.error)
    await held.undo!()
    expect(actions.releaseGoal).toHaveBeenCalledWith('g1')
    expect(await executeTool('list_tasks', {}, { actions })).not.toHaveProperty('undo')
  })

  it('puts notes and memories back the way they were', async () => {
    const actions = fakeActions()
    const files = new Map<string, string>([['70 Goals/Run.md', '# Run'], ['memory/MEMORY.md', '- [gym](gym.md) — mornings\n'], ['memory/gym.md', 'old']])
    const store: VaultStore = {
      listNotes: async () => [...files.keys()].map((path) => ({ path, sha: 'x' })),
      readNote: async (path) => files.has(path) ? { content: files.get(path)!, sha: 'x' } : missing(),
      writeNote: async (path, content) => { files.set(path, content); return { sha: 'y' } },
      appendNote: async (path, text) => { files.set(path, `${files.get(path) ?? ''}${text}`); return { sha: 'z' } },
      deleteNote: async (path) => { files.delete(path) },
    }

    const replaced = await executeTool('write_note', { path: '70 Goals/Run.md', content: '# Walk' }, { actions, vault: store })
    expect(files.get('70 Goals/Run.md')).toBe('# Walk')
    if (!replaced.ok) throw new Error(replaced.error)
    await replaced.undo!()
    expect(files.get('70 Goals/Run.md')).toBe('# Run')

    const fresh = await executeTool('write_note', { path: 'new.md', content: 'hi' }, { actions, vault: store })
    if (!fresh.ok) throw new Error(fresh.error)
    await fresh.undo!()
    expect(files.has('new.md')).toBe(false)

    const moved = await executeTool('move_note', { from: '70 Goals/Run.md', to: '50 Someday-Maybe/Run.md' }, { actions, vault: store })
    expect([files.has('70 Goals/Run.md'), files.get('50 Someday-Maybe/Run.md')]).toEqual([false, '# Run'])
    if (!moved.ok) throw new Error(moved.error)
    await moved.undo!()
    expect([files.get('70 Goals/Run.md'), files.has('50 Someday-Maybe/Run.md')]).toEqual(['# Run', false])
    expect(await executeTool('move_note', { from: '70 Goals/Run.md', to: 'memory/gym.md' }, { actions, vault: store })).toEqual({ ok: false, error: 'a note already exists at memory/gym.md' })

    const forgotten = await executeTool('forget_memory', { name: 'gym' }, { actions, vault: store })
    expect([files.has('memory/gym.md'), files.get('memory/MEMORY.md')]).toEqual([false, ''])
    if (!forgotten.ok) throw new Error(forgotten.error)
    await forgotten.undo!()
    expect([files.get('memory/gym.md'), files.get('memory/MEMORY.md')]).toEqual(['old', '- [gym](gym.md) — mornings\n'])

    const remembered = await executeTool('save_memory', { name: 'gym', description: 'evenings', content: 'new' }, { actions, vault: store })
    expect(files.get('memory/MEMORY.md')).toBe('- [gym](gym.md) — evenings\n')
    if (!remembered.ok) throw new Error(remembered.error)
    await remembered.undo!()
    expect([files.get('memory/gym.md'), files.get('memory/MEMORY.md')]).toEqual(['old', '- [gym](gym.md) — mornings\n'])
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
