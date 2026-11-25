import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Task } from '../domain/types'
import { today } from '../format'
import { TaskPage } from './TaskPage'

const task: Task = { id: 'a', taskId: 'a', domain: 'personal', title: 'call the dentist', completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: false }
const page = (existingTask?: Task) => renderToStaticMarkup(<TaskPage domain="personal" existingTask={existingTask} projects={[]} onAdd={() => {}} onUpdate={() => {}} onDelete={() => {}} onDone={() => {}} onNotMine={() => {}} onCancel={() => {}} />)

it('offers mark done on a task still to be sorted, and on a sorted one', () => {
  expect(page(task)).toContain('>mark done<')
  expect(page({ ...task, metadataComplete: true })).toContain('>mark done<')
})

it('does not offer it on a task already done, or on a new one', () => {
  expect(page({ ...task, completed: true })).not.toContain('mark done')
  expect(page({ ...task, recurrence: 'daily', lastCompletedDate: today() } as Task)).not.toContain('mark done')
  expect(page()).not.toContain('mark done')
})
