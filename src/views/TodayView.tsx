import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { InboxCounts } from '../data/mailGraphProvider'
import { timeRange } from '../domain/calendar'
import { isDoneToday } from '../domain/personalNow'
import type { buildNowPlan } from '../domain/personalNow'
import { completedParts, dueParts } from '../domain/habits'
import type { Domain, Energy, Habit, HabitEntry, Place, Task } from '../domain/types'
import { duration, weekday } from '../format'
import { Card, Empty, Menu, Segmented, TaskRow } from '../ui'

export const minuteOptions = [30, 60, 120] as const
export const energyOptions: { value: Energy; label: string }[] = [
  { value: 'shallow', label: 'light' },
  { value: 'deep', label: 'focused' },
  { value: 'errand', label: 'out' },
]

export function commitmentHint(task: Task, currentDay: string, place: Place): string | undefined {
  if (isDoneToday(task, currentDay)) return undefined
  if (task.place?.length && !task.place.includes(place)) return task.place.includes('home') ? 'when you’re home' : 'when you’re at work'
  if (task.dueDate && task.dueDate < currentDay) return 'overdue'
  if (task.timeWindow === 'morning') return new Date().getHours() >= 17 ? 'missed this morning' : 'this morning'
  if (task.timeWindow === 'evening') return 'this evening'
  return undefined
}

export function HabitCard({ date, entries, habits, onToggle }: { date: string; entries: HabitEntry[]; habits: Habit[]; onToggle: (habitId: string, partId: string) => void }) {
  if (!habits.length) return null
  return <Card title="personal care">
    <ul className="habits">{habits.map((habit) => {
      const completed = new Set(completedParts(entries, habit.id, date))
      return <li key={habit.id}><div className="habit-head"><span>{habit.title}</span><small>{habit.timeWindow}</small></div><div className="chips">{dueParts(habit, date).map((part) => {
        const done = completed.has(part.id)
        return <button aria-pressed={done} className={done ? 'selected' : ''} key={part.id} onClick={() => onToggle(habit.id, part.id)} type="button">{part.title}</button>
      })}</div></li>
    })}</ul>
  </Card>
}

export function inboxLine(inbox: InboxCounts): string {
  const parts = [`${inbox.unread} unread`]
  if (inbox.flagged) parts.push(`${inbox.flagged} flagged`)
  return parts.join(' · ')
}

export function CalendarCard({ events }: { events: CalendarBlock[] }) {
  if (!events.length) return null
  return <Card title="calendar" aside={<span className="count">{events.length}</span>}>
    <ul className="rows">{events.map((event) => <li className="row" key={event.id}>
      {event.webLink
        ? <a className="row-main" href={event.webLink} target="_blank" rel="noreferrer"><span className="row-title">{event.subject}</span><small>{timeRange(event)}</small></a>
        : <div className="row-main"><span className="row-title">{event.subject}</span><small>{timeRange(event)}</small></div>}
    </li>)}</ul>
  </Card>
}

export function TodayView({ domain, currentDay, place, placeOverride, onPlaceOverride, commitments, weeklyCommitments, habits, habitEntries, onHabitPart, plan, availableMin, energy, onMinutes, onEnergy, weekPaid, floorToday, strategicTodayMin, onFloorNight, onStrategic, untriaged, openCount, openMin, onToggle, onOpen, calendar, inbox, mailAppUrl }: {
  domain: Domain
  currentDay: string
  place: Place
  placeOverride?: Place
  onPlaceOverride: (place?: Place) => void
  commitments: Task[]
  weeklyCommitments: Task[]
  habits: Habit[]
  habitEntries: HabitEntry[]
  onHabitPart: (habitId: string, partId: string) => void
  plan: ReturnType<typeof buildNowPlan>
  availableMin: number
  energy: Energy
  onMinutes: (minutes: number) => void
  onEnergy: (energy: Energy) => void
  weekPaid: boolean
  floorToday: boolean
  strategicTodayMin: number
  onFloorNight: () => void
  onStrategic: (minutes: number) => void
  untriaged: Task[]
  openCount: number
  openMin: number
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  calendar: CalendarBlock[]
  inbox?: InboxCounts
  mailAppUrl: string
}) {
  const done = commitments.filter((task) => isDoneToday(task, currentDay)).length
  const showMail = domain === 'personal' && Boolean(mailAppUrl) && (inbox !== undefined)
  const personalHabits = domain === 'personal' ? habits.filter((habit) => habit.domain === 'personal') : []
  const placeLabel = place === 'office' ? 'at work' : 'at home'

  return <>
    <header className="view-head">
      <h1>today</h1>
      <select className="quiet-select" aria-label="where you are" value={placeOverride ?? 'auto'} onChange={(event) => onPlaceOverride(event.target.value === 'auto' ? undefined : event.target.value as Place)}>
        <option value="auto">{placeOverride ? 'automatic' : `${placeLabel} · auto`}</option>
        <option value="home">at home</option>
        <option value="office">at work</option>
      </select>
    </header>

    <Card title="today" aside={commitments.length > 0 && <span className="count">{done}/{commitments.length}</span>}>
      {commitments.length
        ? <ul className="rows">{commitments.map((task) => <TaskRow key={task.id} task={task} done={isDoneToday(task, currentDay)} hint={commitmentHint(task, currentDay, place)} onToggle={() => onToggle(task.id)} onOpen={() => onOpen(task.id)} />)}</ul>
        : <Empty>nothing due today</Empty>}
    </Card>

    <CalendarCard events={calendar} />

    <HabitCard date={currentDay} entries={habitEntries} habits={personalHabits} onToggle={onHabitPart} />

    <Card title="this week" aside={weeklyCommitments.length > 0 && <span className="count">{weeklyCommitments.length}</span>}>
      {weeklyCommitments.length
        ? <ul className="rows">{weeklyCommitments.map((task) => <TaskRow key={task.id} task={task} done={false} hint={task.dueDate ? `due ${weekday(task.dueDate)}` : undefined} onToggle={() => onToggle(task.id)} onOpen={() => onOpen(task.id)} />)}</ul>
        : <Empty>nothing else due this week</Empty>}
    </Card>

    {weekPaid
      ? <Card title="extra time"><Empty>the week is paid</Empty></Card>
      : <Card title="extra time" aside={<Menu items={[
        { label: floorToday ? 'floor night logged' : 'floor night', onSelect: onFloorNight, disabled: floorToday },
        ...[30, 60, 90].map((minutes) => ({ label: `strategic ${duration(minutes)}`, onSelect: () => onStrategic(minutes) })),
      ]} />}>
        <div className="pickers">
          <Segmented label="time available" options={minuteOptions.map((minutes) => ({ value: minutes, label: duration(minutes) }))} value={availableMin} onChange={onMinutes} />
          <Segmented label="energy" options={energyOptions} value={energy} onChange={onEnergy} />
        </div>
        {(floorToday || strategicTodayMin > 0) && <p className="note">{[floorToday && 'floor night', strategicTodayMin > 0 && `strategic ${duration(strategicTodayMin)}`].filter(Boolean).join(' · ')}</p>}
        {plan.tasks.length
          ? <ul className="rows">{plan.tasks.map((task) => <TaskRow key={task.id} task={task} done={false} onToggle={() => onToggle(task.id)} onOpen={() => onOpen(task.id)} />)}</ul>
          : <Empty>nothing fits this window</Empty>}
        {plan.tasks.length > 0 && <p className="fit">{duration(plan.totalMin)} planned · {duration(Math.max(0, plan.availableMin - plan.totalMin))} open</p>}
      </Card>}

    {showMail && <a className="card linkcard" href={mailAppUrl} target="_blank" rel="noreferrer"><span className="row-title">email</span><small>{inboxLine(inbox!)}</small></a>}

    {untriaged.length > 0 && <details className="card sort">
      <summary>{untriaged.length} new to sort</summary>
      <ul className="rows">{untriaged.map((task) => <li className="row" key={task.id}><button className="row-main" type="button" onClick={() => onOpen(task.id)}><span className="row-title">{task.title}</span></button></li>)}</ul>
    </details>}

    <p className="ledger">{openCount} open · {duration(openMin)}</p>
  </>
}
