import { useState } from 'react'
import {
  defaultStepMin, fitSteps, newStep, openSteps, stepTask, stepsOf, withSession, withStep, withStepMoved, withStepToggled, withoutStep,
  type ProjectStep,
} from '../domain/projectSteps'
import { blocksFor, type BlockInput } from '../domain/timeBlock'
import type { Project } from '../domain/types'
import { duration, newId } from '../format'
import type { ProductState } from '../productState'
import { Sheet, TaskRow, Toggle } from '../ui'
import { BlockList, BlockTimeSheet } from './BlockTimeSheet'
import { TimeInput } from './TimeInput'

type SetProduct = React.Dispatch<React.SetStateAction<ProductState>>

function StepEditor({ step, first, last, onProduct, onClose }: { step: ProjectStep; first: boolean; last: boolean; onProduct: SetProduct; onClose: () => void }) {
  const [title, setTitle] = useState(step.title)
  const [minutes, setMinutes] = useState<number | undefined>(step.estimateMin)
  const save = () => {
    if (title.trim()) onProduct((current) => withStep(current, { ...step, title: title.trim(), estimateMin: minutes ?? step.estimateMin }))
    onClose()
  }
  return <li className="step-edit">
    <form className="add-line step-add" onSubmit={(event) => { event.preventDefault(); save() }}>
      <input aria-label="step" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
      <TimeInput label="time" minutes={minutes} onMinutes={setMinutes} />
      <button className="secondary" type="submit" disabled={!title.trim()}>save</button>
    </form>
    <div className="actions">
      <button className="plain" type="button" disabled={first} onClick={() => onProduct((current) => withStepMoved(current, step.id, -1))}>earlier</button>
      <button className="plain" type="button" disabled={last} onClick={() => onProduct((current) => withStepMoved(current, step.id, 1))}>later</button>
      <button className="plain" type="button" onClick={() => { onProduct((current) => withoutStep(current, step.id)); onClose() }}>remove</button>
    </div>
  </li>
}

/**
 * A project: its steps, kept in the order they would be done, and the two ways time is given to it. `today`
 * takes a length and offers the steps that fit it; `block time` sets a later day aside in the calendar.
 */
export function ProjectSheet({ project, product, today, planning = false, canBlock, onProduct, onBlock, onUnblock, onDone, onClose }: {
  project: Project
  product: ProductState
  today: string
  /** Opened to work on it today: the length is asked for first. */
  planning?: boolean
  canBlock: boolean
  onProduct: SetProduct
  onBlock: (input: BlockInput) => Promise<unknown>
  onUnblock: (id: string) => void
  onDone: () => void
  onClose: () => void
}) {
  const steps = stepsOf(product, project.id)
  const open = openSteps(product, project.id)
  const done = steps.length - open.length
  const [editing, setEditing] = useState<string>()
  const [title, setTitle] = useState('')
  const [minutes, setMinutes] = useState<number>()
  const [addKey, setAddKey] = useState(0)
  const [length, setLength] = useState<number>()
  // What he ticked or unticked himself. Until then the steps that fit the length are the pick.
  const [picked, setPicked] = useState<string[]>()
  const [blocking, setBlocking] = useState(false)
  const fit = length ? fitSteps(open, length).map((step) => step.id) : []
  const chosen = (picked ?? fit).filter((id) => open.some((step) => step.id === id))
  const chosenMin = open.filter((step) => chosen.includes(step.id)).reduce((sum, step) => sum + step.estimateMin, 0)
  const left = open.reduce((sum, step) => sum + step.estimateMin, 0)
  const blocks = blocksFor(product.timeBlocks, { projectId: project.id })

  function add(event: React.FormEvent): void {
    event.preventDefault()
    if (!title.trim()) return
    onProduct((current) => withStep(current, newStep(project.id, title, minutes ?? defaultStepMin, newId('step'))))
    setTitle('')
    setMinutes(undefined)
    setAddKey((value) => value + 1)
  }

  function plan(): void {
    onProduct((current) => withSession(current, project.id, chosen, today))
    onClose()
  }

  return <><Sheet title={project.title} onClose={onClose}>
    <div className="stack project-sheet">
      {open.length > 0 && <ul className="rows steps" aria-label="steps">{open.map((step, index) => editing === step.id
        ? <StepEditor key={step.id} step={step} first={index === 0} last={index === open.length - 1} onProduct={onProduct} onClose={() => setEditing(undefined)} />
        : <TaskRow key={step.id} task={stepTask(step, project)} done={false} hint={step.planDate === today ? 'today' : undefined} onOpen={() => setEditing(step.id)}
          onToggle={() => onProduct((current) => withStepToggled(current, step.id, new Date().toISOString(), () => newId('activity')))} />)}</ul>}
      <form className="add-line step-add" onSubmit={add}>
        <input aria-label="step" placeholder="step" value={title} onChange={(event) => setTitle(event.target.value)} />
        <TimeInput key={addKey} label="time" placeholder={duration(defaultStepMin)} minutes={minutes} onMinutes={setMinutes} optional />
        <button className="secondary" type="submit" disabled={!title.trim()}>add</button>
      </form>
      {(left > 0 || done > 0) && <p className="fit">{[left > 0 && `${duration(left)} left`, done > 0 && `${done} done`].filter(Boolean).join(' · ')}</p>}

      {open.length > 0 && <section className="project-today" aria-label="today">
        <label className="field"><span>time today</span><TimeInput label="time today" autoFocus={planning} minutes={length} onMinutes={(value) => { setLength(value); setPicked(undefined) }} optional /></label>
        {length !== undefined && <>
          <ul className="rows">{open.map((step) => <li className="row" key={step.id}>
            <Toggle done={chosen.includes(step.id)} label={`${chosen.includes(step.id) ? 'leave out' : 'pick'} ${step.title}`} onToggle={() => setPicked(chosen.includes(step.id) ? chosen.filter((id) => id !== step.id) : [...chosen, step.id])} />
            <div className="row-main"><span className="row-title">{step.title}</span></div>
            <span className="row-meta">{duration(step.estimateMin)}</span>
          </li>)}</ul>
          <p className={`fit${chosenMin > length ? ' is-loud' : ''}`}>{duration(chosenMin)} of {duration(length)}</p>
          <div className="actions"><button className="primary" type="button" disabled={!chosen.length} onClick={plan}>add to today</button></div>
        </>}
      </section>}

      <BlockList blocks={blocks} onUnblock={onUnblock} />
      <div className="actions">
        {canBlock && <button className="secondary" type="button" onClick={() => setBlocking(true)}>block time</button>}
        <button className="plain" type="button" onClick={() => { onDone(); onClose() }}>mark done</button>
        <button className="plain" type="button" onClick={onClose}>close</button>
      </div>
    </div>
  </Sheet>
    {blocking && <BlockTimeSheet title={project.title} minutes={length ?? (left || undefined)} projectId={project.id} onBlock={onBlock} onClose={() => setBlocking(false)} />}
  </>
}

/** Which project to work on, when there is more than one with steps left. */
export function ProjectPicker({ projects, product, onPick, onClose }: { projects: Project[]; product: ProductState; onPick: (id: string) => void; onClose: () => void }) {
  return <Sheet title="work on a project" onClose={onClose}>
    <ul className="rows">{projects.map((project) => {
      const left = openSteps(product, project.id).reduce((sum, step) => sum + step.estimateMin, 0)
      return <li className="row" key={project.id}>
        <button className="row-main" type="button" onClick={() => onPick(project.id)}><span className="row-title">{project.title}</span></button>
        <span className="row-meta">{duration(left)}</span>
      </li>
    })}</ul>
    <div className="actions"><button className="plain" type="button" onClick={onClose}>cancel</button></div>
  </Sheet>
}
