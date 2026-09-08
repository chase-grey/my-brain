import { describe, expect, it } from 'vitest'
import { capacityBand, projectedDone, reviseGoal, writeCommitment } from './planning'
import type { Goal, Project, Task } from './types'

describe('planning', () => {
  it('distinguishes wide, fragmented, and thin days', () => {
    expect(capacityBand(240, 180)).toBe('wide')
    expect(capacityBand(240, 45)).toBe('fragmented')
    expect(capacityBand(45, 45)).toBe('thin')
  })

  it('enforces ceilings and the floor cap', () => {
    const base = { weekStart: '2026-09-07', domain: 'personal' as const, targetMin: 300, strategicMin: 60, habitDaysRequired: 3, maintenance: [], ceilingMin: 300 }
    expect(writeCommitment(base).halfTargetMin).toBe(150)
    expect(() => writeCommitment({ ...base, targetMin: 301 })).toThrow('ceiling')
    expect(() => writeCommitment({ ...base, maintenance: Array.from({ length: 5 }, (_, i) => ({ lane: `${i}`, minMin: 10 })) })).toThrow('four')
  })

  it('projects from estimate-units cleared without moving the commitment', () => {
    const project: Project = { id: 'p', domain: 'personal', title: 'room', status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: 'tools' }
    const task = { id: 't', taskId: 't', projectId: 'p', domain: 'personal', title: 'wall', completed: false, estimateMin: 60, originalEstimateMin: 120, priority: 2, energy: 'deep', pinned: false, carries: 0 } satisfies Task
    expect(projectedDone(project, [task], [{ id: 'a', domain: 'personal', kind: 'task-progress', projectId: 'p', occurredAt: '2026-08-20T10:00:00Z', estimateDeltaMin: 60 }], '2026-09-01')).toBe('2026-10-13')
  })

  it('records commitment revisions', () => {
    const goal: Goal = { id: 'g', domain: 'personal', horizon: 'season', title: 'finish room', funded: true, status: 'active', targetDate: '2026-10-01', revisions: [] }
    const revised = reviseGoal(goal, 'date', '2026-11-01', '2026-09-01', 'scope grew')
    expect(revised.targetDate).toBe('2026-11-01')
    expect(revised.revisions[0]).toMatchObject({ from: '2026-10-01', to: '2026-11-01' })
  })
})
