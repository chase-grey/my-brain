import { useState } from 'react'
import { storeOptions } from '../domain/shopping'
import { taskAttachment, type Attachment } from '../companion/attachments'
import { placeOptions, priorityLabels, type TaskGuess } from '../domain/taskGuess'
import type { Domain, Energy, Place, Priority, Project, StoreType, Task } from '../domain/types'
import { duration, newId, parseDuration, today } from '../format'
import { Icon } from '../navIcons'
import { Chips, Field, Menu, Segmented } from '../ui'
import { energyOptions } from './TodayView'

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function TaskPage({ domain: initialDomain, existingTask, guess, projects, onAdd, onUpdate, onDelete, onDone, onNotMine, onChat, onCancel }: {
  domain: Domain
  existingTask?: Task
  /** What the ai made of a task still to be sorted. It fills the form; saving is what confirms it. */
  guess?: TaskGuess
  projects: Project[]
  onAdd: (task: Task) => void
  onUpdate: (task: Task) => void
  onDelete: (id: string) => void
  onDone: (id: string) => void
  onNotMine: (id: string) => void
  /** Hands the task, as the form shows it, to the chat's next message. */
  onChat?: (attachment: Attachment) => void
  onCancel: () => void
}) {
  const domain = existingTask?.domain ?? initialDomain
  const untriaged = existingTask?.metadataComplete === false
  const doneAlready = existingTask ? (existingTask.recurrence ? existingTask.lastCompletedDate === today() : existingTask.completed) : true
  const start = untriaged ? guess : undefined
  const [title, setTitle] = useState(existingTask?.title ?? '')
  const [notes, setNotes] = useState(existingTask?.notes ?? '')
  const [dueDate, setDueDate] = useState(existingTask?.dueDate ?? '')
  const [hiddenUntil, setHiddenUntil] = useState(existingTask?.hiddenUntil ?? '')
  // Any length can be typed. Words that are not a length keep the last one that was.
  const [timeText, setTimeText] = useState(() => duration(start?.estimateMin ?? existingTask?.estimateMin ?? 30))
  const [estimateMin, setEstimateMin] = useState(start?.estimateMin ?? existingTask?.estimateMin ?? 30)
  const [priority, setPriority] = useState<Priority>(start?.priority ?? existingTask?.priority ?? 3)
  const [energy, setEnergy] = useState<Energy>(start?.energy ?? existingTask?.energy ?? 'shallow')
  const [places, setPlaces] = useState<Place[]>(start?.place ?? existingTask?.place ?? (domain === 'work' ? ['office'] : []))
  const [storeType, setStoreType] = useState<StoreType | ''>(start?.storeType ?? existingTask?.storeType ?? '')
  const [projectId, setProjectId] = useState(start?.projectId ?? existingTask?.projectId ?? '')
  const [showDetails, setShowDetails] = useState(Boolean(existingTask))

  function chooseStore(next: StoreType | '') {
    setStoreType(next)
    if (next === 'amazon') {
      setPlaces((current) => [...current.filter((place) => place !== 'out'), ...(current.includes('home') ? [] : ['home' as const])])
      setEnergy('shallow')
    } else if (next) {
      setPlaces((current) => current.includes('out') ? current : [...current, 'out'])
      setEnergy('errand')
    }
  }

  function typeTime(text: string) {
    setTimeText(text)
    const minutes = parseDuration(text)
    if (minutes) setEstimateMin(minutes)
  }

  function addToChat() {
    if (!existingTask || !onChat) return
    const project = projects.find((item) => item.id === projectId)
    onChat(taskAttachment({ id: existingTask.id, title: title.trim() || existingTask.title, notes, dueDate: dueDate || undefined, time: duration(estimateMin), priority: priorityLabels[priority], project: project && { id: project.id, title: project.title } }))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const id = existingTask?.id ?? newId('task')
    const task: Task = {
      ...existingTask, id, taskId: existingTask?.taskId ?? id, domain, title: cleanTitle, notes: notes || undefined,
      dueDate: dueDate || undefined, hiddenUntil: hiddenUntil || undefined, completed: existingTask?.completed ?? false,
      estimateMin, originalEstimateMin: existingTask?.originalEstimateMin ?? estimateMin, priority, energy,
      planDate: existingTask?.planDate ?? (showDetails ? today() : undefined),
      place: domain === 'personal' ? (places.length ? places : undefined) : ['office'],
      storeType: domain === 'personal' && storeType ? storeType : undefined,
      projectId: projectId || undefined,
      pinned: existingTask?.pinned ?? false, carries: existingTask?.carries ?? 0,
      metadataComplete: existingTask ? true : showDetails,
    }
    if (existingTask) onUpdate(task)
    else onAdd(task)
  }

  return <>
    <header className="view-head">
      <button className="icon-button" type="button" aria-label="back" onClick={onCancel}><Icon name="back" /></button>
      <h1>{existingTask ? (untriaged ? 'sort task' : 'edit task') : 'new task'}</h1>
      {existingTask && <Menu label="task options" items={[
        ...(doneAlready ? [] : [{ label: 'mark done', onSelect: () => onDone(existingTask.id) }]),
        ...(untriaged ? [{ label: 'not mine', onSelect: () => onNotMine(existingTask.id) }] : []),
        { label: 'delete', onSelect: () => onDelete(existingTask.id) },
      ]} />}
    </header>

    <form className="stack task-form" onSubmit={submit}>
      <Field label="task"><input autoFocus={!existingTask} value={title} onChange={(event) => setTitle(event.target.value)} required /></Field>

      {showDetails && <>
        <div className="grid-2">
          <Field label="due"><input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
          <Field label="hide until"><input type="date" value={hiddenUntil} onChange={(event) => setHiddenUntil(event.target.value)} /></Field>
        </div>
        <div className="grid-2">
          <Field label="time"><input value={timeText} onChange={(event) => typeTime(event.target.value)} onFocus={(event) => event.target.select()} onBlur={() => setTimeText(duration(estimateMin))} autoComplete="off" autoCapitalize="off" enterKeyHint="done" /></Field>
          <Field label="priority"><select value={priority} onChange={(event) => setPriority(Number(event.target.value) as Priority)}><option value="1">critical</option><option value="2">high</option><option value="3">normal</option><option value="4">low</option></select></Field>
        </div>
        {domain === 'personal' && <>
          <div className="field"><span>energy</span><Segmented label="energy" options={energyOptions} value={energy} onChange={setEnergy} /></div>
          <div className="field"><span>where</span><Chips label="where" options={placeOptions} values={places} onToggle={(value) => setPlaces((current) => toggleValue(current, value))} /></div>
          <Field label="store"><select value={storeType} onChange={(event) => chooseStore(event.target.value as StoreType | '')}><option value="">none</option>{storeOptions.map((store) => <option key={store.value} value={store.value}>{store.shortLabel.toLowerCase()}</option>)}</select></Field>
        </>}
        {projects.length > 0 && <Field label="project"><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">none</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></Field>}
        <Field label="notes"><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      </>}

      <div className="actions">
        <button className="primary" type="submit" disabled={!title.trim()}>{existingTask ? 'save' : 'add task'}</button>
        {!showDetails && <button className="secondary" type="button" onClick={() => setShowDetails(true)}>add details</button>}
        {existingTask && onChat && <button className="secondary" type="button" onClick={addToChat}>add to chat</button>}
        <button className="plain" type="button" onClick={onCancel}>cancel</button>
      </div>
    </form>
  </>
}
