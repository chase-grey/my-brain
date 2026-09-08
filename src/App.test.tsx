import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Workspace } from './App'

afterEach(() => vi.unstubAllGlobals())
it('renders each space using only its own stored tasks', () => {
  const task = { id: 'same', taskId: 'same', completed: false, dueDate: '2000-01-01', estimateMin: 30, originalEstimateMin: 30, priority: 2, energy: 'shallow', pinned: false, carries: 0 }
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'my-brain.tasks.v1' ? JSON.stringify([{ ...task, domain: 'personal', title: 'Private dentist appointment' }, { ...task, domain: 'work', title: 'Work release review' }]) : null })
  const work = renderToStaticMarkup(<Workspace activeDomain="work" onDomain={() => {}} />)
  const personal = renderToStaticMarkup(<Workspace activeDomain="personal" onDomain={() => {}} />)
  expect(work).toContain('Work release review')
  expect(work).not.toContain('Private dentist appointment')
  expect(work).not.toContain('personal care')
  expect(personal).toContain('Private dentist appointment')
  expect(personal).not.toContain('Work release review')
})
