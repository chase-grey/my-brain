import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { Task } from '../domain/types'
import { TasksView } from './TasksView'

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, taskId: id, domain: 'personal', title: id, completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: true, ...extra })
const html = (tasks: Task[]) => renderToStaticMarkup(<TasksView domain="personal" tasks={tasks} currentDay="2026-11-25" projects={[]} onToggle={() => {}} onOpen={() => {}} />)

it('draws a card for each group that has tasks, with how many', () => {
  const page = html([task('bins', { dueDate: '2026-11-20' }), task('someday'), task('later on')])
  expect(page).toContain('<h2>overdue</h2><span class="count">1</span>')
  expect(page).toContain('<h2>no date</h2><span class="count">2</span>')
  expect(page).not.toContain('<h2>today</h2>')
})

it('shows a routine done today with its check, and says so in plain words when there is nothing', () => {
  expect(html([task('stretch', { recurrence: 'daily', lastCompletedDate: '2026-11-25' })])).toContain('row is-done')
  expect(html([])).toContain('no tasks')
})
