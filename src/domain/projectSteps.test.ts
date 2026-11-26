import { describe, expect, it } from 'vitest'
import { doneToday } from './doneToday'
import {
  fitSteps, newStep, openSteps, sessionsOn, settleSteps, stepIdOf, stepTaskId, stepsDoneOn, stepsLeftMin, withMoreSteps, withOpenSteps, withSession,
  withStep, withStepMoved, withStepToggled, withoutOpenSteps, withoutSession, type ProjectStep,
} from './projectSteps'
import { projectWork } from './areas'
import { emptyProductState } from '../productState'
import type { Project } from './types'

const build: Project = { id: 'p1', domain: 'personal', title: 'home build', status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: 'build' }
const step = (id: string, title: string, estimateMin: number, more: Partial<ProjectStep> = {}): ProjectStep => ({ id, projectId: 'p1', title, estimateMin, ...more })
const base = { ...emptyProductState, projects: [build], projectSteps: [step('a', 'pick tile', 60), step('b', 'order windows', 30), step('c', 'meet the electrician', 90)] }
let ids = 0
const id = () => `n${++ids}`

describe('project steps', () => {
  it('keeps steps on the project and off today until they are pulled there', () => {
    expect(sessionsOn(base, '2026-11-25', 'personal')).toEqual([])
    expect(stepsLeftMin(base, 'p1')).toBe(180)
  })

  it('offers the steps that fit a length, in the project\'s order', () => {
    expect(fitSteps(base.projectSteps, 100).map((item) => item.id)).toEqual(['a', 'b'])
    // The one that does not fit is passed over for a later one that does.
    expect(fitSteps(base.projectSteps, 45).map((item) => item.id)).toEqual(['b'])
    expect(fitSteps(base.projectSteps, 600).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('offers the first step alone when even it is longer than the time there is', () => {
    expect(fitSteps(base.projectSteps, 20).map((item) => item.id)).toEqual(['a'])
    expect(fitSteps(base.projectSteps, 0)).toEqual([])
  })

  it('never offers a step that is done', () => {
    const state = withStepToggled(base, 'a', '2026-11-25T10:00:00', id)
    expect(fitSteps(state.projectSteps, 600).map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('puts the picked steps on the day and takes the others off it', () => {
    const first = withSession(base, 'p1', ['a', 'b'], '2026-11-25')
    expect(sessionsOn(first, '2026-11-25', 'personal')[0].open.map((item) => item.id)).toEqual(['a', 'b'])
    const second = withSession(first, 'p1', ['c'], '2026-11-25')
    expect(sessionsOn(second, '2026-11-25', 'personal')[0].open.map((item) => item.id)).toEqual(['c'])
    expect(sessionsOn(second, '2026-11-25', 'work')).toEqual([])
  })

  it('takes a project off the day without losing a step', () => {
    const on = withStepToggled(withSession(base, 'p1', ['a', 'b'], '2026-11-25'), 'a', '2026-11-25T10:00:00', id)
    const off = withoutSession(on, 'p1', '2026-11-25')
    expect(sessionsOn(off, '2026-11-25', 'personal')).toEqual([])
    expect(off.projectSteps).toHaveLength(3)
    expect(off.projectSteps.find((item) => item.id === 'a')?.doneAt).toBeTruthy()
  })

  it('gives unfinished steps back to the project when their day is over', () => {
    const on = withStepToggled(withSession(base, 'p1', ['a', 'b'], '2026-11-25'), 'a', new Date('2026-11-25T10:00:00').toISOString(), id)
    const next = settleSteps(on, '2026-11-26')
    expect(sessionsOn(next, '2026-11-26', 'personal')).toEqual([])
    expect(next.projectSteps.find((item) => item.id === 'b')).toEqual(step('b', 'order windows', 30))
    expect(openSteps(next, 'p1').map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('lets a finished step leave after 400 days, and a step whose project is gone at once', () => {
    const old = { ...base, projectSteps: [step('a', 'pick tile', 60, { doneAt: new Date('2025-01-05T10:00:00').toISOString() }), step('b', 'order windows', 30), { ...step('z', 'stray', 30), projectId: 'gone' }] }
    expect(settleSteps(old, '2026-11-25').projectSteps.map((item) => item.id)).toEqual(['b'])
    expect(settleSteps(base, '2026-11-25')).toBe(base)
  })

  it('counts a ticked step for its project and the week, and takes that back with the tick', () => {
    const at = new Date('2026-11-25T10:00:00').toISOString()
    const ticked = withStepToggled(base, 'a', at, id)
    expect(ticked.activities).toMatchObject([{ kind: 'task-completed', projectId: 'p1', taskId: stepTaskId('a'), estimateDeltaMin: 60, domain: 'personal' }])
    expect(projectWork(build, ticked, ticked.activities, '2026-11-25')).toEqual({ tasks: 1, minutes: 60 })
    const back = withStepToggled(ticked, 'a', at, id)
    expect(back.activities).toEqual([])
    expect(back.projectSteps).toEqual(base.projectSteps)
  })

  it('shows a step ticked today on done today, newest first among the tasks, with its check to take it back', () => {
    const early = new Date('2026-11-25T09:00:00').toISOString()
    const late = new Date('2026-11-25T15:00:00').toISOString()
    const state = withStepToggled(withStepToggled(base, 'a', early, id), 'b', late, id)
    const done = stepsDoneOn(state, '2026-11-25', 'personal')
    expect(done.map((item) => item.task.title)).toEqual(['order windows', 'pick tile'])
    expect(stepsDoneOn(state, '2026-11-26', 'personal')).toEqual([])
    const listed = doneToday([], state.activities, '2026-11-25', 'personal', done)
    expect(listed.map((task) => task.id)).toEqual([stepTaskId('b'), stepTaskId('a')])
    expect(stepIdOf(listed[0].id)).toBe('b')
    expect(stepIdOf('task-1')).toBeUndefined()
  })

  it('reorders, rewords and removes steps', () => {
    expect(withStepMoved(base, 'c', -1).projectSteps.map((item) => item.id)).toEqual(['a', 'c', 'b'])
    expect(withStepMoved(base, 'a', -1)).toBe(base)
    expect(withStep(base, { ...base.projectSteps[0], title: 'pick bathroom tile' }).projectSteps[0].title).toBe('pick bathroom tile')
    expect(newStep('p1', '  pour footings ', undefined, 'x')).toEqual({ id: 'x', projectId: 'p1', title: 'pour footings', estimateMin: 30 })
  })

  it('replaces the open steps with a new list, keeping a step whose words did not change and every finished one', () => {
    const state = withSession(withStepToggled(base, 'b', '2026-11-25T10:00:00', id), 'p1', ['a'], '2026-11-25')
    const next = withOpenSteps(state, 'p1', [{ title: 'meet the electrician', estimateMin: 45 }, { title: 'Pick Tile' }, { title: 'frame the porch', estimateMin: 240 }], id)
    const open = openSteps(next, 'p1')
    expect(open.map((item) => item.title)).toEqual(['meet the electrician', 'Pick Tile', 'frame the porch'])
    expect(open[0]).toMatchObject({ id: 'c', estimateMin: 45 })
    expect(open[1]).toMatchObject({ id: 'a', estimateMin: 60, planDate: '2026-11-25' })
    expect(next.projectSteps.find((item) => item.id === 'b')?.doneAt).toBeTruthy()
  })

  it('adds found steps to a project without repeating one it has', () => {
    const next = withMoreSteps(base, 'p1', [{ title: 'Order Windows' }, { title: 'pick paint', estimateMin: 45 }, { title: 'pick paint' }], id)
    expect(next.projectSteps.map((item) => item.title)).toEqual(['pick tile', 'order windows', 'meet the electrician', 'pick paint'])
    expect(withMoreSteps(base, 'p1', [{ title: 'pick tile' }], id)).toBe(base)
  })

  it('drops the steps a finished project never got to and keeps the ones that were done', () => {
    const state = withStepToggled(base, 'a', '2026-11-25T10:00:00', id)
    expect(withoutOpenSteps(state, 'p1').projectSteps.map((item) => item.id)).toEqual(['a'])
  })
})
