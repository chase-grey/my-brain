import { useState } from 'react'
import { storeOptions } from '../domain/shopping'
import type { Domain, Energy, Need, Place, Priority, Project, StoreType, Task } from '../domain/types'
import { duration, newId, today } from '../format'
import { Icon } from '../navIcons'
import { Chips, Field, Menu, Segmented } from '../ui'
import { energyOptions } from './TodayView'

const placeOptions: { value: Place; label: string }[] = [
  { value: 'home', label: 'at home' },
  { value: 'office', label: 'at work' },
  { value: 'out', label: 'out' },
]
const needOptions: { value: Need; label: string }[] = [
  { value: 'computer', label: 'laptop' },
  { value: 'phone', label: 'phone' },
  { value: 'tools', label: 'tools' },
  { value: 'car', label: 'car' },
]
const estimateOptions = [5, 15, 30, 45, 60, 90, 120]

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function TaskPage({ domain: initialDomain, existingTask, projects, onAdd, onUpdate, onDelete, onNotMine, onCancel }: {
  domain: Domain
  existingTask?: Task
  projects: Project[]
  onAdd: (task: Task) => void
  onUpdate: (task: Task) => void
  onDelete: (id: string) => void
  onNotMine: (id: string) => void
  onCancel: () => void
}) {
  const domain = existingTask?.domain ?? initialDomain
  const [title, setTitle] = useState(existingTask?.title ?? '')
  const [notes, setNotes] = useState(existingTask?.notes ?? '')
  const [dueDate, setDueDate] = useState(existingTask?.dueDate ?? '')
  const [hiddenUntil, setHiddenUntil] = useState(existingTask?.hiddenUntil ?? '')
  const [estimateMin, setEstimateMin] = useState(existingTask?.estimateMin ?? 30)
  const [priority, setPriority] = useState<Priority>(existingTask?.priority ?? 3)
  const [energy, setEnergy] = useState<Energy>(existingTask?.energy ?? 'shallow')
  const [places, setPlaces] = useState<Place[]>(existingTask?.place ?? (domain === 'work' ? ['office'] : []))
  const [needs, setNeeds] = useState<Need[]>(existingTask?.needs ?? (domain === 'work' ? ['computer'] : []))
  const [storeType, setStoreType] = useState<StoreType | ''>(existingTask?.storeType ?? '')
  const [projectId, setProjectId] = useState(existingTask?.projectId ?? '')
  const [showDetails, setShowDetails] = useState(Boolean(existingTask))
  const untriaged = existingTask?.metadataComplete === false

  function chooseStore(next: StoreType | '') {
    setStoreType(next)
    if (next === 'amazon') {
      setPlaces((current) => [...current.filter((place) => place !== 'out'), ...(current.includes('home') ? [] : ['home' as const])])
      setNeeds((current) => [...current.filter((need) => need !== 'store'), ...(current.includes('computer') ? [] : ['computer' as const])])
      setEnergy('shallow')
    } else if (next) {
      setPlaces((current) => current.includes('out') ? current : [...current, 'out'])
      setNeeds((current) => current.includes('store') ? current : [...current, 'store'])
      setEnergy('errand')
    } else {
      setNeeds((current) => current.filter((need) => need !== 'store'))
    }
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
      needs: domain === 'personal' ? (needs.length ? needs : undefined) : ['computer'],
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
          <Field label="time"><select value={estimateMin} onChange={(event) => setEstimateMin(Number(event.target.value))}>{estimateOptions.map((minutes) => <option key={minutes} value={minutes}>{duration(minutes)}</option>)}</select></Field>
          <Field label="priority"><select value={priority} onChange={(event) => setPriority(Number(event.target.value) as Priority)}><option value="1">critical</option><option value="2">high</option><option value="3">normal</option><option value="4">low</option></select></Field>
        </div>
        {domain === 'personal' && <>
          <div className="field"><span>energy</span><Segmented label="energy" options={energyOptions} value={energy} onChange={setEnergy} /></div>
          <div className="field"><span>where</span><Chips label="where" options={placeOptions} values={places} onToggle={(value) => setPlaces((current) => toggleValue(current, value))} /></div>
          <div className="field"><span>needs</span><Chips label="needs" options={needOptions} values={needs} onToggle={(value) => setNeeds((current) => toggleValue(current, value))} /></div>
          <Field label="store"><select value={storeType} onChange={(event) => chooseStore(event.target.value as StoreType | '')}><option value="">none</option>{storeOptions.map((store) => <option key={store.value} value={store.value}>{store.shortLabel.toLowerCase()}</option>)}</select></Field>
        </>}
        {projects.length > 0 && <Field label="project"><select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">none</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}</select></Field>}
        <Field label="notes"><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
      </>}

      <div className="actions">
        <button className="primary" type="submit" disabled={!title.trim()}>{existingTask ? 'save' : 'add task'}</button>
        {!showDetails && <button className="secondary" type="button" onClick={() => setShowDetails(true)}>add details</button>}
        <button className="plain" type="button" onClick={onCancel}>cancel</button>
      </div>
    </form>
  </>
}
