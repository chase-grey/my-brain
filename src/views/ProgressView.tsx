import { useEffect, useRef, useState } from 'react'
import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { VaultStore } from '../companion/githubVault'
import { areaReadings } from '../domain/areas'
import { bodyReading, TRACKER_GOALS_LINK } from '../domain/bodyTracker'
import { timeRange } from '../domain/calendar'
import { goalProgress } from '../domain/goals'
import { buildLifeRing, RING_DOMAINS, type RingArc } from '../domain/lifeRing'
import { moneyReading } from '../domain/money'
import { buildWeekReceipt } from '../domain/receipt'
import { restReading } from '../domain/rest'
import type { MoneyRead } from '../companion/moneyRead'
import type { Domain, Goal, LifeDomain, Task } from '../domain/types'
import { hours, shortDate, today } from '../format'
import { useJournalDays } from '../journal/days'
import { withRestCheckIn, type ProductState } from '../productState'
import { reviewKinds, type ReviewKind } from '../review/period'
import { Icon } from '../navIcons'
import { Card, Empty, Field, Menu, Sheet } from '../ui'
import { AreaDetail, AreaLogSheet, SawSomeoneSheet } from './AreaSlices'
import { LifeWheel, wheelHue } from './LifeWheel'
import { hasPhoneRest, MoneyDetail, MoneySheet, RestDetail } from './MoneyRest'

type LogKind = 'connection' | 'did' | 'money' | 'rest'

function sliceFromHash(): LifeDomain | undefined {
  if (typeof location === 'undefined') return undefined
  const [name, slice] = location.hash.replace(/^#/, '').split('/')
  return name === 'progress' && RING_DOMAINS.includes(slice as LifeDomain) ? slice as LifeDomain : undefined
}

function weekElapsed(): number {
  const now = new Date()
  const monday = (now.getDay() + 6) % 7
  return (monday + now.getHours() / 24) / 7
}

export function Bar({ fraction, marker, loud }: { fraction: number; marker?: number; loud?: boolean }) {
  return <div className={`bar${loud ? ' is-loud' : ''}`} aria-hidden="true">
    <div style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }} />
    {marker !== undefined && <i style={{ left: `${Math.min(100, Math.max(0, marker * 100))}%` }} />}
  </div>
}

function GoalRow({ goal, product, currentDay, held, onOpen }: { goal: Goal; product: ProductState; currentDay: string; held?: CalendarBlock; onOpen: () => void }) {
  const progress = goalProgress(goal, product.projects, product.activities, currentDay)
  if (progress.shape === 'block') {
    const text = progress.state === 'unscheduled' ? 'pick a date'
      : progress.state === 'missed' ? `missed ${shortDate(progress.scheduledOn!)}`
      : progress.state === 'met' ? 'done'
      : held ? `${shortDate(progress.scheduledOn!)} · ${timeRange(held)}`
      : goal.calendarEventId ? `${shortDate(progress.scheduledOn!)} · held`
      : shortDate(progress.scheduledOn!)
    return <li className={`goal${progress.loud ? ' is-loud' : ''}`}><button type="button" onClick={onOpen}><span className="row-title">{goal.title}</span><small>{text}</small></button></li>
  }
  const committed = progress.hoursCommitted
  const text = progress.state === 'no target'
    ? `${progress.hoursDone}h · no target`
    : `${progress.hoursDone}h of ${committed}h · ${progress.state}${goal.targetDate ? ` · by ${shortDate(goal.targetDate)}` : ''}`
  return <li className={`goal${progress.state === 'behind' ? ' is-loud' : ''}`}>
    <button type="button" onClick={onOpen}><span className="row-title">{goal.title}</span><small>{text}</small></button>
    {committed ? <Bar fraction={progress.hoursDone / committed} marker={progress.elapsed} loud={progress.state === 'behind'} /> : null}
  </li>
}

export function ProgressView({ domain, product, tasks, currentDay, heldEvents, onProduct, onGoals, onReview, readMoney, journalVault }: {
  domain: Domain
  product: ProductState
  /** For what is left on each project in the projects slice. */
  tasks?: Task[]
  currentDay: string
  heldEvents: Record<string, CalendarBlock>
  onProduct: React.Dispatch<React.SetStateAction<ProductState>>
  onGoals: () => void
  onReview?: (kind: ReviewKind) => void
  /** Reads money screenshots with the person's own key; left out when the chat has none. */
  readMoney?: (files: File[]) => Promise<MoneyRead>
  /** Where the journal is kept; the mind slice counts its days and never opens one. */
  journalVault?: Pick<VaultStore, 'listNotes'>
}) {
  const journalDays = useJournalDays(domain === 'personal' ? journalVault : undefined)
  const [log, setLog] = useState<LogKind>()
  const [slice, setSlice] = useState<LifeDomain | undefined>(sliceFromHash)
  const pushed = useRef(false)
  useEffect(() => {
    const onPop = () => { pushed.current = false; setSlice(sliceFromHash()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function openSlice(next: LifeDomain): void {
    setSlice(next)
    if (pushed.current) history.replaceState(null, '', `#progress/${next}`)
    else { history.pushState(null, '', `#progress/${next}`); pushed.current = true }
  }

  function closeSlice(): void {
    if (pushed.current) { history.back(); return }
    setSlice(undefined)
    history.replaceState(null, '', '#progress')
  }

  const goals = product.goals.filter((goal) => goal.domain === domain && goal.status === 'active')
  const commitment = [...product.commitments].reverse().find((item) => item.domain === domain)
  const receipt = commitment ? buildWeekReceipt(commitment, product.activities.filter((item) => item.domain === domain), product.dayOverrides) : undefined
  const waiting = product.delegations.filter((item) => item.domain === domain && item.status !== 'delivered')
  const ring = domain === 'personal' ? buildLifeRing(product.ringEvidence, product.ringCommitments, currentDay, product.ringOff, product.bodyTracker && bodyReading(product.bodyTracker, currentDay), { money: moneyReading(product.moneyGoals, product.moneySnapshots, currentDay), rest: restReading(product.restDays, product.restGoals, currentDay), areas: areaReadings(product, currentDay, { projects: product.projects, activities: product.activities, journalDays }) }) : []
  const open = domain === 'personal' ? ring.find((arc) => arc.domain === slice) : undefined

  return <>
    <header className={`view-head${domain === 'personal' ? ' wheel-head' : ''}${open ? ' is-open' : ''}`} style={open ? { '--hue': wheelHue[open.domain] } as React.CSSProperties : undefined}>
      {open
        ? <button className="icon-button" type="button" aria-label="back to the wheel" onClick={closeSlice}><Icon name="back" /></button>
        : <h1>progress</h1>}
      {domain === 'personal' && <LifeWheel arcs={ring} selected={open?.domain} compact={!!open} onSelect={openSlice} />}
      {open && <h1 className="slice-title">{open.domain}</h1>}
      {(domain === 'personal' || onReview) && <Menu items={[
        ...(domain === 'personal' ? [
          { label: 'saw someone', onSelect: () => setLog('connection') },
          { label: 'did something', onSelect: () => setLog('did') },
          { label: 'money numbers', onSelect: () => setLog('money') },
          { label: 'rest check-in', onSelect: () => setLog('rest') },
        ] : []),
        ...(onReview ? reviewKinds.map((kind) => ({ label: `${kind} in review`, onSelect: () => onReview(kind) })) : []),
      ]} />}
    </header>

    {open?.domain === 'money' && <MoneyDetail arc={open} product={product} day={currentDay} onProduct={onProduct} readMoney={readMoney} />}
    {open?.domain === 'rest' && hasPhoneRest(product) && <RestDetail arc={open} product={product} day={currentDay} onProduct={onProduct} onCheckIn={() => setLog('rest')} />}
    {open?.area && <AreaDetail key={open.domain} arc={open} product={product} tasks={tasks} today={currentDay} journalDays={journalDays} onProduct={onProduct} onGoals={onGoals} />}
    {open && !open.money && !open.rest && !open.area && <SliceDetail key={open.domain} arc={open} onGoals={onGoals} />}

    {!open && <Card title="this week" aside={receipt && <span className="count">{receipt.paid ? 'paid' : `${hours(receipt.remainingMin)} left`}</span>}>
      {receipt
        ? <><Bar fraction={receipt.plannedMin ? receipt.clearedMin / receipt.plannedMin : 0} marker={weekElapsed()} /><p className="fit">{hours(receipt.clearedMin)} of {hours(receipt.plannedMin)} cleared</p></>
        : <Empty>no weekly target · <button className="link" type="button" onClick={onGoals}>set one</button></Empty>}
    </Card>}

    {!open && <Card title="goals">
      {goals.length
        ? <ul className="goals">{goals.map((goal) => <GoalRow key={goal.id} goal={goal} product={product} currentDay={currentDay} held={heldEvents[goal.id]} onOpen={onGoals} />)}</ul>
        : <Empty>no goals yet · <button className="link" type="button" onClick={onGoals}>add one</button></Empty>}
    </Card>}

    {!open && waiting.length > 0 && <Card title="waiting" aside={<span className="count">{waiting.length}</span>}>
      <ul className="rows">{waiting.map((item) => <li className="row" key={item.id}><div className="row-main"><span className="row-title">{item.title}</span>{item.assignee && <small>{item.assignee}</small>}</div><button className="link" type="button" onClick={() => onProduct((current) => ({ ...current, delegations: current.delegations.map((entry) => entry.id === item.id ? { ...entry, status: 'delivered' } : entry) }))}>delivered</button></li>)}</ul>
    </Card>}

    {log === 'money' && <MoneySheet day={currentDay} onClose={() => setLog(undefined)} onProduct={onProduct} />}
    {log === 'connection' && <SawSomeoneSheet product={product} today={currentDay} onClose={() => setLog(undefined)} onProduct={onProduct} />}
    {log === 'did' && <AreaLogSheet product={product} today={currentDay} journalDays={journalDays} onClose={() => setLog(undefined)} onProduct={onProduct} />}
    {log === 'rest' && <RestSheet onClose={() => setLog(undefined)} onProduct={onProduct} />}
  </>
}

function stateLabel(state: RingArc['state']): string {
  return state === 'early-signal' ? 'early signal' : state
}

const goalState = { met: 'met', onPace: 'on pace', behind: 'behind' } as const

/** What a part takes off the slice, or nothing when it takes nothing. */
const cost = (share: number) => share > 0 ? ` · −${Math.max(1, Math.round(share * 100))}%` : ''

function TrackerDetail({ arc }: { arc: RingArc }) {
  const body = arc.tracker!
  const [listed, setListed] = useState(false)
  const weeks = `${body.weeksMissed} of ${body.weeksJudged}${cost(body.weeksCost)}`
  const goals = `${body.goalsBehind} of ${body.goalsCounted}${cost(body.goalsCost)}`
  return <Card className="slice-detail" title="last 8 weeks" aside={<span className="count">{Math.round(body.fill * 100)}%</span>}>
    <p className="slice-stat">{body.streak
      ? <><strong>{body.streak}</strong> week streak</>
      : <><strong>{body.weeksJudged - body.weeksMissed} of {body.weeksJudged}</strong> weeks kept</>}</p>
    <div className="slice-bar" style={{ '--hue': wheelHue[arc.domain] } as React.CSSProperties}><Bar fraction={body.fill} /></div>
    <ul className="slice-facts">
      <li><span>weeks missed</span><small>{weeks}</small></li>
      {body.goalsCounted > 0 && <li>{body.goals.length
        ? <button className="slice-fact-button" type="button" aria-expanded={listed} onClick={() => setListed(!listed)}><span>goals behind</span><small>{goals}</small></button>
        : <><span>goals behind</span><small>{goals}</small></>}</li>}
      {listed && body.goals.map((goal) => <li className="slice-goal" key={goal.title}><span>{goal.title}</span><small className={goal.state === 'behind' ? 'is-loud' : ''}>{goalState[goal.state]}</small></li>)}
      <li><a className="link" href={TRACKER_GOALS_LINK}>open workout tracker</a></li>
    </ul>
  </Card>
}

function SliceDetail({ arc, onGoals }: { arc: RingArc; onGoals: () => void }) {
  if (arc.tracker) return <TrackerDetail arc={arc} />
  const drift = arc.drift === undefined ? undefined : Math.round(arc.drift * 100)
  return <Card className="slice-detail" title="last 28 days">
    {arc.fill === undefined
      ? <Empty>{arc.state === 'dormant' ? <>no 28-day target · <button className="link" type="button" onClick={onGoals}>set one</button></> : 'nothing logged yet'}</Empty>
      : <>
        <p className="slice-stat"><strong>{Math.round(arc.fill * 100)}%</strong> of target</p>
        <div className="slice-bar" style={{ '--hue': wheelHue[arc.domain] } as React.CSSProperties}><Bar fraction={arc.fill} loud={arc.focus} /></div>
        <ul className="slice-facts">
          <li><span>signal</span><small>{stateLabel(arc.state)}</small></li>
          {drift !== undefined && <li><span>vs usual</span><small className={arc.focus ? 'is-loud' : ''}>{drift > 0 ? '+' : ''}{drift}%{arc.focus ? ' · drifting' : ''}</small></li>}
        </ul>
      </>}
  </Card>
}

function RestSheet({ onClose, onProduct }: { onClose: () => void; onProduct: React.Dispatch<React.SetStateAction<ProductState>> }) {
  const [rating, setRating] = useState(5)
  return <Sheet title="rest check-in" onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); onProduct((current) => withRestCheckIn(current, rating, today())); onClose() }}>
      <Field label={`rested enough this month · ${rating} of 10`}><input min="1" max="10" type="range" value={rating} onChange={(event) => setRating(Number(event.target.value))} /></Field>
      <div className="actions"><button className="primary" type="submit">save</button><button className="plain" type="button" onClick={onClose}>cancel</button></div>
    </form>
  </Sheet>
}
