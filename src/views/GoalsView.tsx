import { useState } from 'react'
import type { CalendarBlock } from '../data/calendarGraphProvider'
import { timeRange } from '../domain/calendar'
import type { RingCommitment } from '../domain/lifeRing'
import type { Commitment, Domain, Goal, GoalShape, LifeDomain, Project, Task } from '../domain/types'
import { duration, newId, shortDate } from '../format'
import type { ProductState } from '../productState'
import { Card, Field, Menu, Segmented, Sheet } from '../ui'

export type GoalEdit = Partial<Pick<Goal, 'title' | 'status' | 'targetDate' | 'hoursCommitted' | 'shape' | 'scheduledOn' | 'calendarEventId'>>

const ringDomains: LifeDomain[] = ['body', 'purpose', 'connection', 'build', 'mind', 'creativity', 'money', 'rest']
const shapeOptions: { value: GoalShape; label: string }[] = [{ value: 'pace', label: 'hours a week' }, { value: 'block', label: 'one block' }]

function describeGoal(goal: Goal, held?: CalendarBlock): string {
  if (goal.shape === 'block') {
    if (!goal.scheduledOn) return 'not scheduled'
    if (held) return `${shortDate(goal.scheduledOn)} · ${timeRange(held)} · held`
    return goal.calendarEventId ? `${shortDate(goal.scheduledOn)} · held` : shortDate(goal.scheduledOn)
  }
  const parts = [goal.hoursCommitted ? `${goal.hoursCommitted}h` : undefined, goal.targetDate ? `by ${shortDate(goal.targetDate)}` : undefined].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'no target'
}

function GoalFields({ shape, title, hoursValue, date, onShape, onTitle, onHours, onDate }: {
  shape: GoalShape; title: string; hoursValue: string; date: string
  onShape: (shape: GoalShape) => void; onTitle: (value: string) => void; onHours: (value: string) => void; onDate: (value: string) => void
}) {
  return <>
    <Field label="goal"><input value={title} onChange={(event) => onTitle(event.target.value)} /></Field>
    <Segmented label="shape" options={shapeOptions} value={shape} onChange={onShape} />
    {shape === 'pace'
      ? <div className="grid-2"><Field label="hours"><input inputMode="decimal" min="0" step="0.5" type="number" value={hoursValue} onChange={(event) => onHours(event.target.value)} /></Field><Field label="by"><input type="date" value={date} onChange={(event) => onDate(event.target.value)} /></Field></div>
      : <Field label="scheduled for"><input type="date" value={date} onChange={(event) => onDate(event.target.value)} /></Field>}
  </>
}

export function GoalsView({ domain, product, tasks, currentDay, heldEvents, canHold, holdError, onProduct, onEditGoal, onHold, onRelease }: {
  domain: Domain
  product: ProductState
  tasks: Task[]
  currentDay: string
  heldEvents: Record<string, CalendarBlock>
  canHold: boolean
  holdError?: string
  onProduct: React.Dispatch<React.SetStateAction<ProductState>>
  onEditGoal: (id: string, changes: GoalEdit) => void
  onHold: (id: string) => void
  onRelease: (id: string) => void
}) {
  const goals = product.goals.filter((goal) => goal.domain === domain && goal.status === 'active')
  const projects = product.projects.filter((project) => project.domain === domain && project.status === 'active')
  const commitment = [...product.commitments].reverse().find((item) => item.domain === domain)
  const [targetHours, setTargetHours] = useState(commitment ? String(commitment.targetMin / 60) : '4')
  const [ceilingHours, setCeilingHours] = useState(commitment ? String(commitment.ceilingMin / 60) : '6')
  const [goalTitle, setGoalTitle] = useState('')
  const [goalShape, setGoalShape] = useState<GoalShape>('pace')
  const [goalHours, setGoalHours] = useState('')
  const [goalDate, setGoalDate] = useState('')
  const [editing, setEditing] = useState<Goal>()
  const [projectTitle, setProjectTitle] = useState('')
  const [projectMode, setProjectMode] = useState('')
  const [projectGoal, setProjectGoal] = useState('')

  function setWeek(event: React.FormEvent): void {
    event.preventDefault()
    const ceilingMin = Math.round(Number(ceilingHours) * 60)
    const targetMin = Math.min(Math.round(Number(targetHours) * 60), ceilingMin)
    if (!Number.isFinite(targetMin) || !Number.isFinite(ceilingMin) || ceilingMin <= 0) return
    const start = new Date()
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const item: Commitment = { weekStart: start.toLocaleDateString('en-CA'), domain, targetMin, ceilingMin, strategicMin: 0, habitDaysRequired: 0, maintenance: [], halfTargetMin: Math.ceil(targetMin / 2) }
    onProduct((current) => ({ ...current, commitments: [...current.commitments.filter((existing) => existing.weekStart !== item.weekStart || existing.domain !== domain), item] }))
  }

  function addGoal(event: React.FormEvent): void {
    event.preventDefault()
    const title = goalTitle.trim()
    if (!title) return
    const hoursCommitted = goalShape === 'pace' && goalHours ? Number(goalHours) : undefined
    const goal: Goal = {
      id: newId('goal'), domain, horizon: 'season', title, funded: true, status: 'active', revisions: [], shape: goalShape, committedOn: currentDay,
      hoursCommitted, targetDate: goalShape === 'pace' && goalDate ? goalDate : undefined, scheduledOn: goalShape === 'block' && goalDate ? goalDate : undefined,
    }
    onProduct((current) => ({ ...current, goals: [...current.goals, goal] }))
    setGoalTitle(''); setGoalHours(''); setGoalDate('')
  }

  function addProject(event: React.FormEvent): void {
    event.preventDefault()
    const title = projectTitle.trim()
    if (!title) return
    const project: Project = { id: newId('project'), domain, title, status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: projectMode.trim() || 'general', goalId: projectGoal || undefined }
    onProduct((current) => ({ ...current, projects: [...current.projects, project] }))
    setProjectTitle(''); setProjectMode(''); setProjectGoal('')
  }

  function setRing(ringDomain: LifeDomain, value: number): void {
    const item: RingCommitment = { domain: ringDomain, commitment28: value }
    onProduct((current) => ({ ...current, ringCommitments: [...current.ringCommitments.filter((entry) => entry.domain !== ringDomain), item] }))
  }

  return <>
    <header className="view-head"><h1>goals</h1></header>

    <Card title="this week" aside={commitment && <span className="count">{duration(commitment.targetMin)} of {duration(commitment.ceilingMin)}</span>}>
      <form className="inline-form" onSubmit={setWeek}>
        <Field label="target hours"><input inputMode="decimal" min="0" step="0.5" type="number" value={targetHours} onChange={(event) => setTargetHours(event.target.value)} /></Field>
        <Field label="ceiling hours"><input inputMode="decimal" min="0" step="0.5" type="number" value={ceilingHours} onChange={(event) => setCeilingHours(event.target.value)} /></Field>
        <button className="primary" type="submit">set week</button>
      </form>
    </Card>

    <Card title="goals">
      {goals.length > 0 && <ul className="rows">{goals.map((goal) => <li className="row" key={goal.id}>
        <button className="row-main" type="button" onClick={() => setEditing(goal)}><span className="row-title">{goal.title}</span><small>{describeGoal(goal, heldEvents[goal.id])}</small></button>
        <Menu label={`options for ${goal.title}`} items={[
          { label: 'edit', onSelect: () => setEditing(goal) },
          ...(goal.shape === 'block' && canHold && goal.scheduledOn && !goal.calendarEventId ? [{ label: 'hold in calendar', onSelect: () => onHold(goal.id) }] : []),
          ...(goal.calendarEventId && heldEvents[goal.id]?.webLink ? [{ label: 'open in calendar', onSelect: () => window.open(heldEvents[goal.id].webLink, '_blank', 'noreferrer') }] : []),
          ...(goal.calendarEventId ? [{ label: 'release the hold', onSelect: () => onRelease(goal.id) }] : []),
          { label: 'mark done', onSelect: () => onEditGoal(goal.id, { status: 'met' }) },
          { label: 'drop', onSelect: () => onEditGoal(goal.id, { status: 'abandoned' }) },
        ]} />
      </li>)}</ul>}
      {holdError && <p className="note is-error" role="alert">{holdError}</p>}
      <form className="stack" onSubmit={addGoal}>
        <GoalFields shape={goalShape} title={goalTitle} hoursValue={goalHours} date={goalDate} onShape={setGoalShape} onTitle={setGoalTitle} onHours={setGoalHours} onDate={setGoalDate} />
        <button className="primary" type="submit" disabled={!goalTitle.trim()}>add goal</button>
      </form>
    </Card>

    <Card title="projects">
      {projects.length > 0 && <ul className="rows">{projects.map((project) => {
        const remaining = tasks.filter((task) => task.projectId === project.id && !task.completed).reduce((sum, task) => sum + task.estimateMin, 0)
        const goal = product.goals.find((item) => item.id === project.goalId)
        return <li className="row" key={project.id}>
          <div className="row-main"><span className="row-title">{project.title}</span><small>{[project.mode, goal?.title].filter(Boolean).join(' · ')}</small></div>
          <span className="row-meta">{duration(remaining)}</span>
          <Menu label={`options for ${project.title}`} items={[{ label: 'mark done', onSelect: () => onProduct((current) => ({ ...current, projects: current.projects.map((item) => item.id === project.id ? { ...item, status: 'done' } : item) })) }]} />
        </li>
      })}</ul>}
      <form className="stack" onSubmit={addProject}>
        <div className="grid-2">
          <Field label="project"><input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} /></Field>
          <Field label="mode"><input value={projectMode} placeholder="code, calls, build" onChange={(event) => setProjectMode(event.target.value)} /></Field>
        </div>
        {goals.length > 0 && <Field label="goal"><select value={projectGoal} onChange={(event) => setProjectGoal(event.target.value)}><option value="">none</option>{goals.map((goal) => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></Field>}
        <button className="primary" type="submit" disabled={!projectTitle.trim()}>add project</button>
      </form>
    </Card>

    {domain === 'personal' && <Card title="life ring · per 28 days">
      <div className="grid-2">{ringDomains.map((ringDomain) => <Field key={ringDomain} label={ringDomain}><input inputMode="numeric" min="0" type="number" value={product.ringCommitments.find((item) => item.domain === ringDomain)?.commitment28 ?? 0} onChange={(event) => setRing(ringDomain, Number(event.target.value))} /></Field>)}</div>
    </Card>}

    {editing && <EditGoalSheet goal={editing} onClose={() => setEditing(undefined)} onSave={(changes) => { onEditGoal(editing.id, changes); setEditing(undefined) }} />}
  </>
}

function EditGoalSheet({ goal, onClose, onSave }: { goal: Goal; onClose: () => void; onSave: (changes: GoalEdit) => void }) {
  const [title, setTitle] = useState(goal.title)
  const [shape, setShape] = useState<GoalShape>(goal.shape ?? 'pace')
  const [hoursValue, setHours] = useState(goal.hoursCommitted ? String(goal.hoursCommitted) : '')
  const [date, setDate] = useState((goal.shape === 'block' ? goal.scheduledOn : goal.targetDate) ?? '')
  return <Sheet title="edit goal" onClose={onClose}>
    <form className="stack" onSubmit={(event) => {
      event.preventDefault()
      if (!title.trim()) return
      onSave(shape === 'block'
        ? { title: title.trim(), shape, scheduledOn: date || undefined }
        : { title: title.trim(), shape, hoursCommitted: hoursValue ? Number(hoursValue) : undefined, targetDate: date || undefined })
    }}>
      <GoalFields shape={shape} title={title} hoursValue={hoursValue} date={date} onShape={setShape} onTitle={setTitle} onHours={setHours} onDate={setDate} />
      <div className="actions"><button className="primary" type="submit" disabled={!title.trim()}>save</button><button className="plain" type="button" onClick={onClose}>cancel</button></div>
    </form>
  </Sheet>
}
