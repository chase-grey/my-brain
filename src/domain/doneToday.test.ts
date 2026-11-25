import { describe, expect, it } from 'vitest'
import { doneToday } from './doneToday'
import type { Activity, Task } from './types'

const today = '2026-11-25'
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, taskId: id, domain: 'personal', title: id, completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, ...extra })
const ticked = (taskId: string, time: string, day = today): Activity => ({ id: `${taskId}-${time}`, domain: 'personal', kind: 'task-completed', taskId, occurredAt: new Date(`${day}T${time}:00`).toISOString() })
const titles = (tasks: Task[], activities: Activity[], domain: 'personal' | 'work' = 'personal') => doneToday(tasks, activities, today, domain).map((item) => item.title)

describe('done today', () => {
  it('lists what was ticked off today, newest first', () => {
    const tasks = [task('bins', { completed: true }), task('dentist', { completed: true }), task('passport')]
    expect(titles(tasks, [ticked('bins', '09:10'), ticked('dentist', '14:30')])).toEqual(['dentist', 'bins'])
  })

  it('counts a late evening as today, by this clock and not the utc day', () => {
    expect(titles([task('late', { completed: true })], [ticked('late', '23:30')])).toEqual(['late'])
    expect(titles([task('early', { completed: true })], [ticked('early', '00:20')])).toEqual(['early'])
  })

  it('leaves out what was done on another day', () => {
    expect(titles([task('old', { completed: true })], [ticked('old', '10:00', '2026-11-24')])).toEqual([])
  })

  it('leaves out a task that was reopened', () => {
    expect(titles([task('again')], [ticked('again', '10:00')])).toEqual([])
  })

  it('lists a routine done today after the tasks, and not one done yesterday', () => {
    const tasks = [task('stretch', { recurrence: 'daily', lastCompletedDate: today }), task('vitamins', { recurrence: 'daily', lastCompletedDate: '2026-11-24' }), task('bins', { completed: true })]
    expect(titles(tasks, [ticked('bins', '09:10')])).toEqual(['bins', 'stretch'])
  })

  it('lists something bought', () => {
    expect(titles([task('milk', { completed: true, storeType: 'grocery' })], [ticked('milk', '12:00')])).toEqual(['milk'])
  })

  it('keeps the two spaces apart', () => {
    const tasks = [task('review', { completed: true, domain: 'work' }), task('bins', { completed: true })]
    const activities = [ticked('review', '10:00'), ticked('bins', '11:00')]
    expect(titles(tasks, activities, 'work')).toEqual(['review'])
    expect(titles(tasks, activities)).toEqual(['bins'])
  })
})
