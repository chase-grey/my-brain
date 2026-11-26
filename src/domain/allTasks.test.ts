import { describe, expect, it } from 'vitest'
import { groupOf, taskGroups, taskLine } from './allTasks'
import type { Task } from './types'

// A wednesday: the week ends sunday the 29th.
const today = '2026-11-25'
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, taskId: id, domain: 'personal', title: id, completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: true, ...extra })
const shape = (tasks: Task[], query = '', domain: 'personal' | 'work' = 'personal') => taskGroups(tasks, today, domain, query).map((group) => [group.title, group.tasks.map((item) => item.id)])

describe('all tasks', () => {
  it('shows every task still to do, by when it is due', () => {
    const tasks = [
      task('someday'), task('next month', { dueDate: '2026-12-20' }), task('friday', { dueDate: '2026-11-27' }),
      task('due', { dueDate: today }), task('late', { dueDate: '2026-11-20' }), task('fresh', { metadataComplete: false }),
      task('stretch', { recurrence: 'daily' }),
    ]
    expect(shape(tasks)).toEqual([
      ['overdue', ['late']], ['today', ['due']], ['this week', ['friday']], ['later', ['next month']],
      ['no date', ['someday']], ['new to sort', ['fresh']], ['routines', ['stretch']],
    ])
  })

  it('leaves out a group with nothing in it', () => {
    expect(shape([task('someday')])).toEqual([['no date', ['someday']]])
    expect(shape([])).toEqual([])
  })

  it('leaves out what is done, what is on a store list and what was handed to someone else', () => {
    const tasks = [task('done', { completed: true }), task('milk', { storeType: 'grocery' }), task('theirs', { kind: 'delegated' })]
    expect(shape(tasks)).toEqual([])
  })

  it('keeps a routine after it is done today, and a task hidden until later', () => {
    expect(groupOf(task('stretch', { recurrence: 'daily', lastCompletedDate: today }), today, 'personal')).toBe('routines')
    expect(groupOf(task('taxes', { hiddenUntil: '2027-01-01' }), today, 'personal')).toBe('undated')
  })

  it('puts a task with a reminder today under today, and never dates an unsorted one', () => {
    expect(groupOf(task('call', { remindAt: `${today}T15:00` }), today, 'personal')).toBe('today')
    expect(groupOf(task('fresh', { metadataComplete: false, dueDate: '2026-11-20' }), today, 'personal')).toBe('sort')
  })

  it('keeps the two spaces apart', () => {
    const tasks = [task('review', { domain: 'work' }), task('bins')]
    expect(shape(tasks, '', 'work')).toEqual([['no date', ['review']]])
    expect(shape(tasks)).toEqual([['no date', ['bins']]])
  })

  it('reads dated tasks soonest first and the rest by what matters most', () => {
    const tasks = [task('b', { dueDate: '2026-12-20' }), task('a', { dueDate: '2026-12-02' }), task('low', { priority: 4 }), task('high', { priority: 2 })]
    expect(shape(tasks)).toEqual([['later', ['a', 'b']], ['no date', ['high', 'low']]])
  })

  it('search keeps the titles that hold the words, in any case', () => {
    const tasks = [task('Renew passport'), task('bins', { dueDate: today })]
    expect(shape(tasks, ' PASS ')).toEqual([['no date', ['Renew passport']]])
    expect(shape(tasks, 'zzz')).toEqual([])
  })

  it('says under a task when it is due, what it matters and its project, the way a person would', () => {
    const projects = [{ id: 'p1', title: 'Garage' }]
    expect(taskLine(task('a', { dueDate: '2026-11-27' }), 'week', today, projects)).toBe('fri')
    expect(taskLine(task('a', { dueDate: '2026-12-20', priority: 2, projectId: 'p1' }), 'later', today, projects)).toBe('sun, dec 20 · high · Garage')
    expect(taskLine(task('a', { dueDate: today }), 'today', today, projects)).toBeUndefined()
    expect(taskLine(task('a', { hiddenUntil: '2026-12-01' }), 'undated', today, projects)).toBe('hidden until tue, dec 1')
    expect(taskLine(task('a', { recurrence: 'daily' }), 'routines', today, projects)).toBe('every day')
    expect(taskLine(task('a'), 'undated', today, projects)).toBeUndefined()
  })
})
