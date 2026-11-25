import { useEffect, useRef, useState } from 'react'
import { holdUpdates } from '../appUpdate'
import type { MoneyRead } from '../companion/moneyRead'
import type { RingArc } from '../domain/lifeRing'
import { MONEY_FIGURES, goalFigures, latestFigures, money, moneyFigureLabels, newMoneyGoal, standingText, type MoneyAccount, type MoneyFigure, type MoneyGoal, type MoneyGoalKind, type MoneyStanding } from '../domain/money'
import { restReading, type RestGoals, type RestMeasure } from '../domain/rest'
import { duration, newId, shortDate } from '../format'
import { openScreenTimeAccess, phoneRestStatus, requestSleepAccess, syncPhoneRest, type PhoneRestStatus } from '../native/health'
import { isNativeApp } from '../native/platform'
import { withMoneyReading, type ProductState } from '../productState'
import { Card, Field, Segmented, Sheet } from '../ui'
import { wheelHue } from './LifeWheel'
import { Bar } from './ProgressView'

type SetProduct = React.Dispatch<React.SetStateAction<ProductState>>
type Amounts = Partial<Record<MoneyFigure, string>>

const kindOptions: { value: MoneyGoalKind; label: string }[] = [{ value: 'reach', label: 'reach' }, { value: 'payoff', label: 'pay off' }, { value: 'cover', label: 'keep saved' }]

function defaultTitle(kind: MoneyGoalKind, figure: MoneyFigure, amount: number, months: number): string {
  if (kind === 'cover') return `${months} months saved`
  if (kind === 'payoff') return `${moneyFigureLabels[figure].replace(/ left$/, '')} paid off`
  return `${moneyFigureLabels[figure]} ${money(amount)}`
}

/** The day's numbers, typed in or read off screenshots and checked here before they are saved. A blank is not saved. */
export function MoneySheet({ initial, accounts, day, onClose, onProduct }: { initial?: Amounts; accounts?: MoneyAccount[]; day: string; onClose: () => void; onProduct: SetProduct }) {
  const [amounts, setAmounts] = useState<Amounts>(initial ?? {})
  const figures = Object.fromEntries(MONEY_FIGURES.filter((figure) => amounts[figure]?.trim() && Number.isFinite(Number(amounts[figure]))).map((figure) => [figure, Number(amounts[figure])])) as Partial<Record<MoneyFigure, number>>
  return <Sheet title="money numbers" onClose={onClose}>
    <form onSubmit={(event) => {
      event.preventDefault()
      onProduct((current) => withMoneyReading(current, day, figures, accounts))
      onClose()
    }}>
      <div className="grid-2">{MONEY_FIGURES.map((figure) => <Field key={figure} label={moneyFigureLabels[figure]}><input inputMode="decimal" type="number" step="any" value={amounts[figure] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [figure]: event.target.value }))} /></Field>)}</div>
      <div className="actions"><button className="primary" type="submit" disabled={!Object.keys(figures).length && !accounts?.length}>save</button><button className="plain" type="button" onClick={onClose}>cancel</button></div>
    </form>
  </Sheet>
}

function MoneyGoalSheet({ goal, day, onClose, onProduct }: { goal?: MoneyGoal; day: string; onClose: () => void; onProduct: SetProduct }) {
  const [kind, setKind] = useState<MoneyGoalKind>(goal?.kind ?? 'reach')
  const [figure, setFigure] = useState<MoneyFigure>(goal?.figure ?? 'netWorth')
  const [title, setTitle] = useState(goal?.title ?? '')
  const [amount, setAmount] = useState(goal?.amount ? String(goal.amount) : '')
  const [months, setMonths] = useState(goal?.months ? String(goal.months) : '6')
  const [by, setBy] = useState(goal?.by ?? '')
  const options = goalFigures[kind]
  const picked = options.includes(figure) ? figure : options[0]
  const ready = kind === 'reach' ? Number(amount) > 0 : kind === 'cover' ? Number(months) > 0 : true

  function save(event: React.FormEvent): void {
    event.preventDefault()
    if (!ready) return
    const fields = {
      title: title.trim() || defaultTitle(kind, picked, Number(amount), Number(months)),
      kind,
      figure: picked,
      ...(kind === 'reach' ? { amount: Number(amount) } : {}),
      ...(kind === 'cover' ? { months: Number(months) } : {}),
      ...(kind !== 'cover' && by ? { by } : {}),
    }
    onProduct((current) => {
      // Changing what a goal measures starts its line over; a new title or date keeps where it started.
      const same = goal && goal.kind === kind && goal.figure === picked
      const next: MoneyGoal = same ? { id: goal.id, startOn: goal.startOn, ...(goal.startValue !== undefined ? { startValue: goal.startValue } : {}), ...fields } : newMoneyGoal({ id: goal?.id ?? newId('money'), ...fields }, current.moneySnapshots, day)
      return { ...current, moneyGoals: goal ? current.moneyGoals.map((item) => item.id === goal.id ? next : item) : [...current.moneyGoals, next] }
    })
    onClose()
  }

  return <Sheet title={goal ? 'edit money goal' : 'money goal'} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <Segmented label="kind" options={kindOptions} value={kind} onChange={setKind} />
      {options.length > 1 && <Field label="what"><select value={picked} onChange={(event) => setFigure(event.target.value as MoneyFigure)}>{options.map((item) => <option key={item} value={item}>{moneyFigureLabels[item].replace(/ left$/, '')}</option>)}</select></Field>}
      {kind === 'reach' && <Field label="amount"><input inputMode="decimal" min="0" step="any" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>}
      {kind === 'cover' && <Field label="months of spending"><input inputMode="decimal" min="0" step="any" type="number" value={months} onChange={(event) => setMonths(event.target.value)} /></Field>}
      {kind !== 'cover' && <Field label="by"><input type="date" value={by} onChange={(event) => setBy(event.target.value)} /></Field>}
      <Field label="name"><input value={title} placeholder={ready ? defaultTitle(kind, picked, Number(amount), Number(months)) : ''} onChange={(event) => setTitle(event.target.value)} /></Field>
      <div className="actions">
        <button className="primary" type="submit" disabled={!ready}>save</button>
        {goal && <button className="plain" type="button" onClick={() => { onProduct((current) => ({ ...current, moneyGoals: current.moneyGoals.filter((item) => item.id !== goal.id) })); onClose() }}>remove</button>}
        <button className="plain" type="button" onClick={onClose}>cancel</button>
      </div>
    </form>
  </Sheet>
}

function MoneyGoalRow({ standing, onOpen }: { standing: MoneyStanding; onOpen: () => void }) {
  const { goal, state, progress, current, expected } = standing
  const loud = state === 'behind' || state === 'short'
  // The marker is where the figure should be today, on the same scale as the bar.
  const start = goal.startValue
  const target = goal.kind === 'payoff' ? 0 : goal.amount
  const marker = expected !== undefined && start !== undefined && target !== undefined && target !== start ? (expected - start) / (target - start) : undefined
  return <li className={`goal${loud ? ' is-loud' : ''}`}>
    <button type="button" onClick={onOpen}><span className="row-title">{goal.title}</span><small>{standingText(standing)}{goal.by ? ` · by ${shortDate(goal.by)}` : ''}</small></button>
    {current !== undefined && <Bar fraction={progress} marker={marker} loud={loud} />}
  </li>
}

export function MoneyDetail({ arc, product, day, onProduct, readMoney }: { arc: RingArc; product: ProductState; day: string; onProduct: SetProduct; readMoney?: (files: File[]) => Promise<MoneyRead> }) {
  const [editing, setEditing] = useState<MoneyGoal | 'new'>()
  const [entry, setEntry] = useState<{ initial?: Amounts; accounts?: MoneyAccount[] }>()
  const [reading, setReading] = useState(false)
  const [problem, setProblem] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  // A reload while the screenshots are being read would lose the reading.
  useEffect(() => (reading ? holdUpdates() : undefined), [reading])

  async function read(files: File[]): Promise<void> {
    if (!files.length || !readMoney) return
    setProblem('')
    setReading(true)
    try {
      const result = await readMoney(files)
      setEntry({ initial: Object.fromEntries(Object.entries(result.figures).map(([figure, value]) => [figure, String(value)])), accounts: result.accounts })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'could not read those screenshots')
    } finally {
      setReading(false)
    }
  }

  const reading28 = arc.money
  const latest = latestFigures(product.moneySnapshots)
  const shown = MONEY_FIGURES.filter((figure) => latest[figure])
  const onPace = reading28?.standings.filter((item) => item.state === 'on pace' || item.state === 'met').length ?? 0

  return <>
    <Card className="slice-detail" title="goals">
      {reading28
        ? <>
          <p className="slice-stat"><strong>{onPace} of {reading28.standings.length}</strong> on pace</p>
          <div className="slice-bar" style={{ '--hue': wheelHue[arc.domain] } as React.CSSProperties}><Bar fraction={reading28.fill} /></div>
          <ul className="goals">{reading28.standings.map((standing) => <MoneyGoalRow key={standing.goal.id} standing={standing} onOpen={() => setEditing(standing.goal)} />)}</ul>
        </>
        : null}
      <div className="actions"><button className="secondary" type="button" onClick={() => setEditing('new')}>add goal</button></div>
    </Card>

    <Card className="slice-detail" title="numbers" aside={reading28?.asOf || shown.length ? <span className="count">{shortDate(reading28?.asOf ?? latest[shown[0]]!.on)}</span> : undefined}>
      {shown.length
        ? <ul className="slice-facts">{shown.map((figure) => <li key={figure}><span>{moneyFigureLabels[figure]}</span><small>{money(latest[figure]!.value)}</small></li>)}</ul>
        : null}
      {problem && <p className="note is-error" role="alert">{problem}</p>}
      <div className="actions">
        {readMoney && <button className="primary" type="button" disabled={reading} onClick={() => picker.current?.click()}>{reading ? 'reading' : 'add screenshots'}</button>}
        <button className={readMoney ? 'plain' : 'primary'} type="button" onClick={() => setEntry({})}>type them in</button>
      </div>
      <input ref={picker} type="file" hidden multiple accept="image/*" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void read(files) }} />
    </Card>

    {editing && <MoneyGoalSheet goal={editing === 'new' ? undefined : editing} day={day} onClose={() => setEditing(undefined)} onProduct={onProduct} />}
    {entry && <MoneySheet initial={entry.initial} accounts={entry.accounts} day={day} onClose={() => setEntry(undefined)} onProduct={onProduct} />}
  </>
}

function measureText(measure: RestMeasure, unit: string): string {
  return `${duration(measure.averageMin)} average · ${measure.met} of ${measure.judged} ${unit}`
}

/** Whether the rest slice has anything of the phone's to show: in the shell, or with days already kept. */
export function hasPhoneRest(product: ProductState): boolean {
  return isNativeApp() || product.restDays.length > 0
}

export function RestDetail({ arc, product, day, onProduct }: { arc: RingArc; product: ProductState; day: string; onProduct: SetProduct }) {
  const [status, setStatus] = useState<PhoneRestStatus>()
  const check = () => void phoneRestStatus().then(setStatus)
  useEffect(() => {
    check()
    // Screen time is allowed on a settings screen outside the app; look again on the way back.
    const onVisible = () => { if (document.visibilityState === 'visible') { check(); void syncPhoneRest(onProduct, day) } }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  const goals = product.restGoals
  const reading = arc.rest ?? restReading(product.restDays, goals, day)
  const setGoal = (key: keyof RestGoals) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const minutes = Math.round(Number(event.target.value) * 60)
    onProduct((current) => ({ ...current, restGoals: { ...current.restGoals, [key]: minutes > 0 ? minutes : undefined } }))
  }
  const hoursOf = (minutes?: number) => minutes ? String(Math.round(minutes / 6) / 10) : ''

  return <Card className="slice-detail" title="last 28 days">
    {reading && <>
      <p className="slice-stat"><strong>{Math.round(reading.fill * 100)}%</strong> of days on goal</p>
      <div className="slice-bar" style={{ '--hue': wheelHue[arc.domain] } as React.CSSProperties}><Bar fraction={reading.fill} /></div>
      <ul className="slice-facts">
        {reading.sleep && <li><span>sleep</span><small>{measureText(reading.sleep, 'nights')}</small></li>}
        {reading.screen && <li><span>screen time</span><small>{measureText(reading.screen, 'days')}</small></li>}
      </ul>
    </>}
    <div className="grid-2 rest-goals">
      <Field label="sleep goal · hours"><input inputMode="decimal" min="0" step="0.5" type="number" value={hoursOf(goals.sleepMin)} onChange={setGoal('sleepMin')} /></Field>
      <Field label="screen limit · hours"><input inputMode="decimal" min="0" step="0.5" type="number" value={hoursOf(goals.screenMaxMin)} onChange={setGoal('screenMaxMin')} /></Field>
    </div>
    {(status?.sleep === 'denied' || status?.screen === 'denied') && <div className="actions">
      {status.sleep === 'denied' && <button className="secondary" type="button" onClick={() => void requestSleepAccess().then(() => { check(); void syncPhoneRest(onProduct, day) })}>connect sleep</button>}
      {status.screen === 'denied' && <button className="secondary" type="button" onClick={() => void openScreenTimeAccess()}>allow screen time</button>}
    </div>}
  </Card>
}
