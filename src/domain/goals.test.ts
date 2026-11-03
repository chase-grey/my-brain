import { describe, expect, it } from 'vitest'
import { goalProgress } from './goals'
import type { Activity, Goal, Project } from './types'

const base: Goal = { id: 'g1', domain: 'personal', horizon: 'season', title: 'finish the basement', funded: true, status: 'active', revisions: [] }
const project: Project = { id: 'p1', domain: 'personal', goalId: 'g1', title: 'framing', status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: 'build' }
const activity = (minutes: number, on: string): Activity => ({ id: on, domain: 'personal', kind: 'task-completed', projectId: 'p1', occurredAt: `${on}T18:00:00.000Z`, estimateDeltaMin: minutes })

describe('pace goals', () => {
  it('sums hours cleared through linked projects since the commitment', () => {
    const goal = { ...base, hoursCommitted: 20, committedOn: '2026-10-01', targetDate: '2026-12-10' }
    const progress = goalProgress(goal, [project], [activity(90, '2026-09-20'), activity(60, '2026-10-05'), activity(30, '2026-10-20')], '2026-11-04')
    expect(progress).toMatchObject({ shape: 'pace', hoursDone: 1.5, state: 'behind' })
  })

  it('is on pace when cleared hours sit near the elapsed share', () => {
    const goal = { ...base, hoursCommitted: 20, committedOn: '2026-10-01', targetDate: '2026-11-10' }
    const progress = goalProgress(goal, [project], [activity(600, '2026-10-20')], '2026-10-21')
    expect(progress).toMatchObject({ shape: 'pace', hoursDone: 10, state: 'on pace' })
  })

  it('reports no target without hours or dates', () => {
    expect(goalProgress(base, [], [], '2026-11-04')).toMatchObject({ shape: 'pace', state: 'no target' })
  })
})

describe('block goals', () => {
  const goal: Goal = { ...base, shape: 'block', title: 'paint the bedroom' }
  it('is loud until a date is picked', () => {
    expect(goalProgress(goal, [], [], '2026-11-04')).toMatchObject({ state: 'unscheduled', loud: true })
  })
  it('goes quiet once scheduled', () => {
    expect(goalProgress({ ...goal, scheduledOn: '2026-11-15' }, [], [], '2026-11-04')).toMatchObject({ state: 'scheduled', loud: false })
  })
  it('is loud again after the date passes undone', () => {
    expect(goalProgress({ ...goal, scheduledOn: '2026-11-01' }, [], [], '2026-11-04')).toMatchObject({ state: 'missed', loud: true })
  })
  it('stays quiet when met', () => {
    expect(goalProgress({ ...goal, scheduledOn: '2026-11-01', status: 'met' }, [], [], '2026-11-04')).toMatchObject({ state: 'met', loud: false })
  })
})
