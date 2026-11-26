import { useState } from 'react'
import { blockLabel, blockProblem, type BlockInput, type TimeBlock } from '../domain/timeBlock'
import { Icon } from '../navIcons'
import { Field, Sheet } from '../ui'
import { TimeInput } from './TimeInput'

/** The blocks a task or a project already has, each with the way to take it back out of the calendar. */
export function BlockList({ blocks, onUnblock }: { blocks: TimeBlock[]; onUnblock: (id: string) => void }) {
  if (!blocks.length) return null
  return <ul className="slice-facts blocks" aria-label="blocked time">
    {blocks.map((block) => <li key={block.id}>
      <span>{blockLabel(block)}</span>
      <button className="row-remove" type="button" aria-label={`remove ${blockLabel(block)}`} title="remove" onClick={() => onUnblock(block.id)}><Icon name="close" size={16} /></button>
    </li>)}
  </ul>
}

/**
 * Blocks time in this space's calendar for a task or a project. The day, the hour and the length are all his:
 * nothing starts filled in but the name and, when the thing has one, how long it takes.
 */
export function BlockTimeSheet({ title: startTitle, minutes: startMinutes, taskId, projectId, onBlock, onClose }: {
  title: string
  minutes?: number
  taskId?: string
  projectId?: string
  onBlock: (input: BlockInput) => Promise<unknown>
  onClose: () => void
}) {
  const [title, setTitle] = useState(startTitle)
  const [day, setDay] = useState('')
  const [time, setTime] = useState('')
  const [minutes, setMinutes] = useState(startMinutes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const ready = Boolean(title.trim() && day && time && minutes)

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!ready || busy) return
    const input: BlockInput = { title: title.trim(), start: `${day}T${time.slice(0, 5)}`, minutes: minutes!, ...(taskId ? { taskId } : {}), ...(projectId ? { projectId } : {}) }
    const problem = blockProblem(input)
    if (problem) return setError(problem)
    setBusy(true)
    setError(undefined)
    try {
      await onBlock(input)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message.toLowerCase() : 'could not block the time')
      setBusy(false)
    }
  }

  return <Sheet title="block time" onClose={onClose}>
    <form className="stack" onSubmit={(event) => { void submit(event) }}>
      <Field label="what"><input value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <div className="grid-2">
        <Field label="day"><input type="date" value={day} onChange={(event) => setDay(event.target.value)} /></Field>
        <Field label="start"><input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></Field>
      </div>
      <label className="field"><span>how long</span><TimeInput label="how long" minutes={minutes} onMinutes={setMinutes} optional /></label>
      {error && <p className="note is-error" role="alert">{error}</p>}
      <div className="actions">
        <button className="primary" type="submit" disabled={!ready || busy}>block</button>
        <button className="plain" type="button" onClick={onClose}>cancel</button>
      </div>
    </form>
  </Sheet>
}
