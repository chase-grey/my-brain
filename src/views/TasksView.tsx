import { useState } from 'react'
import { taskGroups, taskLine } from '../domain/allTasks'
import { isDoneToday } from '../domain/personalNow'
import type { Domain, Project, Task } from '../domain/types'
import { Card, Empty, TaskRow } from '../ui'

/** Every task of the space still to do, by when it is due (src/domain/allTasks.ts). */
export function TasksView({ domain, tasks, currentDay, projects, onToggle, onOpen }: {
  domain: Domain
  tasks: Task[]
  currentDay: string
  projects: Pick<Project, 'id' | 'title'>[]
  onToggle: (id: string) => void
  onOpen: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const groups = taskGroups(tasks, currentDay, domain, query)
  return <>
    <header className="view-head"><h1>tasks</h1></header>
    <input className="notes-search" type="search" aria-label="search" placeholder="search" value={query} onChange={(event) => setQuery(event.target.value)} />
    {groups.map((group) => <Card key={group.id} title={group.title} aside={<span className="count">{group.tasks.length}</span>}>
      <ul className="rows">{group.tasks.map((task) => <TaskRow key={task.id} task={task} done={isDoneToday(task, currentDay)} hint={taskLine(task, group.id, currentDay, projects)} onToggle={() => onToggle(task.id)} onOpen={() => onOpen(task.id)} />)}</ul>
    </Card>)}
    {!groups.length && <Empty>{query.trim() ? 'nothing found' : 'no tasks'}</Empty>}
  </>
}
