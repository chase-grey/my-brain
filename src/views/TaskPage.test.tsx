import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Task } from '../domain/types'
import { today } from '../format'
import { TaskPage } from './TaskPage'

const task: Task = { id: 'a', taskId: 'a', domain: 'personal', title: 'call the dentist', completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: false }
const page = (existingTask?: Task) => renderToStaticMarkup(<TaskPage domain="personal" existingTask={existingTask} projects={[]} onAdd={() => {}} onUpdate={() => {}} onDelete={() => {}} onDone={() => {}} onNotMine={() => {}} onChat={() => {}} onCancel={() => {}} />)

it('offers mark done on a task still to be sorted, and on a sorted one', () => {
  expect(page(task)).toContain('>mark done<')
  expect(page({ ...task, metadataComplete: true })).toContain('>mark done<')
})

it('does not offer it on a task already done, or on a new one', () => {
  expect(page({ ...task, completed: true })).not.toContain('mark done')
  expect(page({ ...task, recurrence: 'daily', lastCompletedDate: today() } as Task)).not.toContain('mark done')
  expect(page()).not.toContain('mark done')
})

it('takes any length of time, typed, and shows the one the task has', () => {
  const html = page({ ...task, estimateMin: 200, metadataComplete: true })
  expect(html).toContain('value="3h 20m"')
  expect(html).not.toMatch(/<option[^>]*>45m</)
})

it('offers add to chat on a task that exists, not on a new one', () => {
  expect(page(task)).toContain('>add to chat<')
  expect(page()).not.toContain('add to chat')
})
