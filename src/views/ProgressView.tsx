import { useState } from 'react'
import type { CalendarBlock } from '../data/calendarGraphProvider'
import { timeRange } from '../domain/calendar'
import { goalProgress } from '../domain/goals'
import { buildLifeRing } from '../domain/lifeRing'
import { buildWeekReceipt } from '../domain/receipt'
import type { Domain, Goal, RestCheckIn } from '../domain/types'
import { hours, newId, shortDate, today } from '../format'
import type { ProductState } from '../productState'
import { Card, Empty, Field, Menu, Sheet } from '../ui'

type LogKind = 'connection' | 'money' | 'rest'

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

export function ProgressView({ domain, product, currentDay, heldEvents, onProduct, onGoals }: {
  domain: Domain
  product: ProductState
  currentDay: string
  heldEvents: Record<string, CalendarBlock>
  onProduct: React.Dispatch<React.SetStateAction<ProductState>>
  onGoals: () => void
}) {
  const [log, setLog] = useState<LogKind>()
  const goals = product.goals.filter((goal) => goal.domain === domain && goal.status === 'active')
  const commitment = [...product.commitments].reverse().find((item) => item.domain === domain)
  const receipt = commitment ? buildWeekReceipt(commitment, product.activities.filter((item) => item.domain === domain), product.dayOverrides) : undefined
  const waiting = product.delegations.filter((item) => item.domain === domain && item.status !== 'delivered')
  const ring = domain === 'personal' ? buildLifeRing(product.ringEvidence, product.ringCommitments, currentDay) : []

  return <>
    <header className="view-head">
      <h1>progress</h1>
      {domain === 'personal' && <Menu items={[
        { label: 'saw someone', onSelect: () => setLog('connection') },
        { label: 'this month’s money', onSelect: () => setLog('money') },
        { label: 'rest check-in', onSelect: () => setLog('rest') },
      ]} />}
    </header>

    <Card title="this week" aside={receipt && <span className="count">{receipt.paid ? 'paid' : `${hours(receipt.remainingMin)} left`}</span>}>
      {receipt
        ? <><Bar fraction={receipt.plannedMin ? receipt.clearedMin / receipt.plannedMin : 0} marker={weekElapsed()} /><p className="fit">{hours(receipt.clearedMin)} of {hours(receipt.plannedMin)} cleared</p></>
        : <Empty>no weekly target · <button className="link" type="button" onClick={onGoals}>set one</button></Empty>}
    </Card>

    <Card title="goals">
      {goals.length
        ? <ul className="goals">{goals.map((goal) => <GoalRow key={goal.id} goal={goal} product={product} currentDay={currentDay} held={heldEvents[goal.id]} onOpen={onGoals} />)}</ul>
        : <Empty>no goals yet · <button className="link" type="button" onClick={onGoals}>add one</button></Empty>}
    </Card>

    {domain === 'personal' && <Card title="life ring">
      <ul className="ring">{ring.map((arc) => <li key={arc.domain}><span>{arc.domain}</span><Bar fraction={arc.fill ?? 0} /><small>{arc.fill === undefined ? arc.state : `${Math.round(arc.fill * 100)}%`}</small></li>)}</ul>
    </Card>}

    {waiting.length > 0 && <Card title="waiting" aside={<span className="count">{waiting.length}</span>}>
      <ul className="rows">{waiting.map((item) => <li className="row" key={item.id}><div className="row-main"><span className="row-title">{item.title}</span>{item.assignee && <small>{item.assignee}</small>}</div><button className="link" type="button" onClick={() => onProduct((current) => ({ ...current, delegations: current.delegations.map((entry) => entry.id === item.id ? { ...entry, status: 'delivered' } : entry) }))}>delivered</button></li>)}</ul>
    </Card>}

    {log && <LogSheet kind={log} onClose={() => setLog(undefined)} onProduct={onProduct} />}
  </>
}

function LogSheet({ kind, onClose, onProduct }: { kind: LogKind; onClose: () => void; onProduct: React.Dispatch<React.SetStateAction<ProductState>> }) {
  const [person, setPerson] = useState('')
  const [rating, setRating] = useState(5)
  const [money, setMoney] = useState({ netWorth: '', homeRemaining: '', carRemaining: '', incomeMonthly: '', spendingMonthly: '' })
  const moneyLabels: Record<keyof typeof money, string> = { netWorth: 'net worth', homeRemaining: 'home loan left', carRemaining: 'car loan left', incomeMonthly: 'monthly income', spendingMonthly: 'monthly spending' }
  const day = today()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (kind === 'connection') {
      const name = person.trim()
      if (!name) return
      onProduct((current) => ({ ...current,
        people: [...current.people.filter((item) => item.displayName !== name), { id: newId('person'), displayName: name, lastSeenOn: day }],
        ringEvidence: [...current.ringEvidence, { domain: 'connection', on: day, value: 1 }],
        activities: [...current.activities, { id: newId('activity'), domain: 'personal', kind: 'connection', occurredAt: new Date().toISOString(), withPeople: [name] }],
      }))
    } else if (kind === 'money') {
      const month = day.slice(0, 7)
      const snapshot = Object.fromEntries(Object.entries(money).map(([key, value]) => [key, Number(value) || 0])) as Record<keyof typeof money, number>
      onProduct((current) => ({ ...current,
        moneySnapshots: [...current.moneySnapshots.filter((item) => item.month !== month), { month, ...snapshot }],
        ringEvidence: [...current.ringEvidence, { domain: 'money', on: day, value: 1 }],
      }))
    } else {
      const start = new Date(`${day}T00:00:00`)
      start.setDate(start.getDate() - 27)
      const checkIn: RestCheckIn = { id: newId('rest'), periodStart: start.toLocaleDateString('en-CA'), periodEnd: day, rating: rating as RestCheckIn['rating'], createdAt: new Date().toISOString() }
      onProduct((current) => ({ ...current, restCheckIns: [...current.restCheckIns, checkIn], ringEvidence: [...current.ringEvidence, { domain: 'rest', on: day, value: rating }] }))
    }
    onClose()
  }

  const title = kind === 'connection' ? 'saw someone' : kind === 'money' ? 'this month’s money' : 'rest check-in'
  return <Sheet title={title} onClose={onClose}>
    <form onSubmit={submit}>
      {kind === 'connection' && <Field label="who"><input autoFocus value={person} onChange={(event) => setPerson(event.target.value)} /></Field>}
      {kind === 'money' && <div className="grid-2">{(Object.keys(money) as (keyof typeof money)[]).map((key) => <Field key={key} label={moneyLabels[key]}><input inputMode="decimal" type="number" value={money[key]} onChange={(event) => setMoney((current) => ({ ...current, [key]: event.target.value }))} /></Field>)}</div>}
      {kind === 'rest' && <Field label={`rested enough this month · ${rating} of 10`}><input min="1" max="10" type="range" value={rating} onChange={(event) => setRating(Number(event.target.value))} /></Field>}
      <div className="actions"><button className="primary" type="submit" disabled={kind === 'connection' && !person.trim()}>save</button><button className="plain" type="button" onClick={onClose}>cancel</button></div>
    </form>
  </Sheet>
}
