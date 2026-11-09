import { expect, it } from 'vitest'
import type { Task } from '../domain/types'
import { widgetSnapshot } from './widget'

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, taskId: id, title: `task ${id}`, domain: 'personal', completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 2, energy: 'shallow', pinned: false, carries: 0, ...extra } as Task)

it('lists open commitments with the today card hints, capped', () => {
  const tasks = [task('a', { dueDate: '2026-11-03' }), task('b', { completed: true }), task('c'), task('d'), task('e'), task('f'), task('g')]
  const snapshot = widgetSnapshot('personal', tasks, '2026-11-04', 'home')
  expect(snapshot.title).toBe('today · personal')
  expect(snapshot.lines.map((line) => line.id)).toEqual(['a', 'c', 'd', 'e', 'f'])
  expect(snapshot.lines[0]).toEqual({ id: 'a', text: 'task a', hint: 'overdue' })
  expect(snapshot.lines[1]).toEqual({ id: 'c', text: 'task c' })
})

it('is empty when nothing is planned', () => {
  expect(widgetSnapshot('work', [], '2026-11-04', 'office').lines).toEqual([])
})
