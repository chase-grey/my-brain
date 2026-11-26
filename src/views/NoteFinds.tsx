import { useEffect, useRef, useState } from 'react'
import type { VaultStore } from '../companion/githubVault'
import type { GuessModel } from '../companion/taskGuesses'
import { FIND_AREAS, findInNotes, loadFinds, saveFinds, withFind, withoutFind, type Find, type FindArea, type FindProgress, type KeptFinds } from '../notes/finds'
import { newId, shortDate } from '../format'
import { Icon } from '../navIcons'
import type { ProductState } from '../productState'
import { Done, Empty, Sheet } from '../ui'
import { TimeInput } from './TimeInput'

const day = (value: string) => shortDate(value).replace(/^[a-z]+, /, '')

function FindCard({ find, onChange, onAdd, onDismiss }: { find: Find; onChange: (find: Find) => void; onAdd: () => void; onDismiss: () => void }) {
  const stepsFor = find.kind === 'project' && find.projectId
  return <li className="find">
    <div className="find-head">
      {find.kind === 'thing'
        ? <select aria-label="area" value={find.area} onChange={(event) => onChange({ ...find, area: event.target.value as FindArea })}>{FIND_AREAS.map((area) => <option key={area} value={area}>{area}</option>)}</select>
        : <small>{stepsFor ? 'steps for' : find.kind}</small>}
      {find.days.length > 0 && <small>{find.days.map(day).join(' · ')}</small>}
    </div>
    {stepsFor
      ? <span className="row-title">{find.title}</span>
      : <input aria-label="name" value={find.title} onChange={(event) => onChange({ ...find, title: event.target.value })} />}
    {find.kind === 'project' && find.steps.length > 0 && <ul className="find-steps" aria-label="steps">{find.steps.map((step, index) => <li key={index}>
      <input aria-label="step" value={step.title} onChange={(event) => onChange({ ...find, steps: find.steps.map((item, at) => at === index ? { ...item, title: event.target.value } : item) })} />
      <TimeInput label="time" minutes={step.estimateMin} onMinutes={(minutes) => { if (minutes) onChange({ ...find, steps: find.steps.map((item, at) => at === index ? { ...item, estimateMin: minutes } : item) }) }} />
      <button className="row-remove" type="button" aria-label={`remove ${step.title}`} title="remove" onClick={() => onChange({ ...find, steps: find.steps.filter((_, at) => at !== index) })}><Icon name="close" size={16} /></button>
    </li>)}</ul>}
    <div className="actions">
      <button className="primary small" type="button" disabled={!find.title.trim()} onClick={onAdd}>add</button>
      <button className="secondary small" type="button" onClick={onDismiss}>dismiss</button>
    </div>
  </li>
}

/**
 * What the year's notes show, as offers. It reads on opening, a batch at a time, and each find can be reworded,
 * moved to another area or trimmed before it is added. Nothing reaches progress until `add`.
 */
export function NoteFindsSheet({ product, today, vault, model, onProduct, onClose }: {
  product: ProductState
  today: string
  vault: Pick<VaultStore, 'listNotes' | 'readNote'>
  /** Who reads: where the personal chat goes. Nothing when there is no ai to read with. */
  model: () => Promise<GuessModel | undefined>
  onProduct: React.Dispatch<React.SetStateAction<ProductState>>
  onClose: () => void
}) {
  const [kept, setKept] = useState<KeptFinds>(loadFinds)
  const [progress, setProgress] = useState<FindProgress>()
  const [reading, setReading] = useState(false)
  const [left, setLeft] = useState(0)
  const [error, setError] = useState<string>()
  // Whether anything was added or dismissed here, which is what makes an empty list a finished one.
  const [dealt, setDealt] = useState(false)
  const keptRef = useRef(kept)
  const productRef = useRef(product)
  productRef.current = product
  const stop = useRef(false)

  function keep(next: KeptFinds): void {
    keptRef.current = next
    setKept(next)
    saveFinds(next)
  }

  async function read(): Promise<void> {
    stop.current = false
    setReading(true)
    setError(undefined)
    try {
      const reader = await model()
      if (!reader) throw new Error('there is no ai to read with')
      const result = await findInNotes({
        vault, model: reader, year: today.slice(0, 4), newId: () => newId('find'),
        state: () => productRef.current,
        current: () => keptRef.current,
        keep,
        onProgress: setProgress,
        stopped: () => stop.current,
      })
      setLeft(result.left)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message.toLowerCase() : 'could not read the notes')
    }
    setReading(false)
  }

  useEffect(() => {
    void read()
    return () => { stop.current = true }
  }, [])

  const change = (find: Find) => keep({ ...keptRef.current, finds: keptRef.current.finds.map((item) => item.id === find.id ? find : item) })
  function add(find: Find): void {
    onProduct((current) => withFind(current, find, today, () => newId(find.kind)))
    keep(withoutFind(keptRef.current, find.id, false))
    setDealt(true)
  }
  function dismiss(find: Find): void {
    keep(withoutFind(keptRef.current, find.id, true))
    setDealt(true)
  }
  const ready = kept.finds.filter((find) => find.title.trim())

  return <Sheet title="from my notes" onClose={onClose}>
    <div className="stack note-finds">
      {reading && <p className="note" role="status">{progress?.total ? `reading ${Math.min(progress.read + 1, progress.total)} of ${progress.total}` : 'reading'}</p>}
      {error && <p className="note is-error" role="alert">{error}</p>}
      {kept.finds.length > 0 && <ul className="finds">{kept.finds.map((find) => <FindCard key={find.id} find={find} onChange={change} onAdd={() => add(find)} onDismiss={() => dismiss(find)} />)}</ul>}
      {!reading && !error && !kept.finds.length && (dealt ? <Done label="all sorted" /> : <Empty>nothing new</Empty>)}
      <div className="actions">
        {ready.length > 1 && <button className="primary" type="button" onClick={() => ready.forEach(add)}>add all</button>}
        {reading && <button className="secondary" type="button" onClick={() => { stop.current = true }}>stop</button>}
        {!reading && (left > 0 || error) && <button className="secondary" type="button" onClick={() => { void read() }}>{left > 0 ? `keep reading · ${left} left` : 'try again'}</button>}
        <button className="plain" type="button" onClick={onClose}>close</button>
      </div>
    </div>
  </Sheet>
}
