import type { CalendarBlock } from '../data/calendarGraphProvider'
import type { InboxCounts } from '../data/mailGraphProvider'
import { timeRange } from '../domain/calendar'
import { isDoneToday } from '../domain/personalNow'
import { localMoment, remindHint, remindLabel, remindedBy, upcoming } from '../domain/remind'
import type { buildNowPlan } from '../domain/personalNow'
import { completedParts, dueParts } from '../domain/habits'
import { placeOptions, priorityLabels, type TaskGuess } from '../domain/taskGuess'
import { storeOptions } from '../domain/shopping'
import type { Domain, Energy, Habit, HabitEntry, Place, Project, Task } from '../domain/types'
import { duration, weekday } from '../format'
import { Card, Done, TaskRow, Toggle } from '../ui'
import { ExtraTimeCard } from './ExtraTime'

export const energyOptions: { value: Energy; label: string }[] = [
  { value: 'shallow', label: 'light' },
  { value: 'deep', label: 'focused' },
  { value: 'errand', label: 'out' },
]

/** A guess in the words the sort form uses, for the line under a task waiting to be sorted. */
export function guessLine(guess: TaskGuess, domain: Domain, projects: Pick<Project, 'id' | 'title'>[], now = localMoment()): string {
  const personal = domain === 'personal'
  return [
    duration(guess.estimateMin),
    guess.priority !== 3 && priorityLabels[guess.priority],
    personal && !guess.storeType && energyOptions.find((option) => option.value === guess.energy)?.label,
    ...(personal && !guess.storeType ? placeOptions.filter((option) => guess.place?.includes(option.value)).map((option) => option.label) : []),
    personal && guess.storeType && (guess.storeType === 'other' ? 'store' : storeOptions.find((store) => store.value === guess.storeType)?.shortLabel.toLowerCase()),
    projects.find((project) => project.id === guess.projectId)?.title,
    personal && upcoming(guess.remindAt, now) && `remind ${remindLabel(guess.remindAt!, now)}`,
  ].filter(Boolean).join(' · ')
}

export function commitmentHint(task: Task, currentDay: string, place: Place): string | undefined {
  if (isDoneToday(task, currentDay)) return undefined
  if (remindedBy(task, currentDay)) return remindHint(task.remindAt!, currentDay)
  if (task.place?.length && !task.place.includes(place)) return task.place.includes('home') ? 'when you’re home' : 'when you’re at work'
  if (task.dueDate && task.dueDate < currentDay) return 'overdue'
  if (task.timeWindow === 'morning') return new Date().getHours() >= 17 ? 'missed this morning' : 'this morning'
  if (task.timeWindow === 'evening') return 'this evening'
  return undefined
}

export function HabitCard({ date, entries, habits, onToggle }: { date: string; entries: HabitEntry[]; habits: Habit[]; onToggle: (habitId: string, partId: string) => void }) {
  const rows = habits.flatMap((habit) => {
    const completed = new Set(completedParts(entries, habit.id, date))
    return dueParts(habit, date).map((part) => ({ habit, part, done: completed.has(part.id) }))
  })
  if (!rows.length) return null
  return <Card title="personal care" aside={<span className="count">{rows.filter((row) => row.done).length}/{rows.length}</span>}>
    <ul className="rows">{rows.map(({ habit, part, done }) => <li className={`row${done ? ' is-done' : ''}`} key={`${habit.id}:${part.id}`}>
      <Toggle done={done} label={`${done ? 'undo' : 'complete'} ${part.title}`} onToggle={() => onToggle(habit.id, part.id)} />
      <button className="row-main" type="button" onClick={() => onToggle(habit.id, part.id)}><span className="row-title">{part.title}</span></button>
      {habit.timeWindow && <span className="row-meta">{habit.timeWindow}</span>}
    </li>)}</ul>
  </Card>
}

/** What was ticked off today, each with its check to take it back. Not drawn until something is done. */
export function DoneTodayCard({ tasks, onToggle, onOpen }: { tasks: Task[]; onToggle: (id: string) => void; onOpen: (id: string) => void }) {
  if (!tasks.length) return null
  return <Card title="done today" className="done-today" aside={<span className="count is-loud" key={tasks.length}>{tasks.length}</span>}>
    <ul className="rows">{tasks.map((task) => <TaskRow key={task.id} task={task} done hint={undefined} onToggle={() => onToggle(task.id)} onOpen={task.storeType ? undefined : () => onOpen(task.id)} />)}</ul>
  </Card>
}

/** What the email card says. Nothing when no mail needs me, and then the card is not drawn. */
export function inboxLine(inbox?: InboxCounts): string | undefined {
  if (!inbox?.needsMe) return undefined
  return inbox.needsMe === 1 ? '1 needs me' : `${inbox.needsMe} need me`
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

export function TodayView({ domain, currentDay, place, placeOverride, onPlaceOverride, commitments, weeklyCommitments, habits, habitEntries, onHabitPart, plan, pickedMin, energy, onMinutes, onEnergy, weekPaid, floorToday, strategicTodayMin, onFloorNight, onStrategic, untriaged, guesses, projects, onConfirm, openCount, openMin, onToggle, onOpen, doneTasks, calendar, inbox, mailAppUrl }: {
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
  pickedMin?: number
  energy: Energy
  onMinutes: (minutes?: number) => void
  onEnergy: (energy: Energy) => void
  weekPaid: boolean
  floorToday: boolean
  strategicTodayMin: number
  onFloorNight: () => void
  onStrategic: (minutes: number) => void
  untriaged: Task[]
  guesses: Record<string, TaskGuess>
  projects: Pick<Project, 'id' | 'title'>[]
  onConfirm: (id: string) => void
  openCount: number
  openMin: number
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  /** What was ticked off today, for the card at the bottom. */
  doneTasks: Task[]
  calendar: CalendarBlock[]
  inbox?: InboxCounts
  mailAppUrl: string
}) {
  // A task ticked off leaves this list for done today at the bottom; the count still says how far through the day is.
  const open = commitments.filter((task) => !isDoneToday(task, currentDay))
  const done = commitments.length - open.length
  const mailLine = domain === 'personal' && mailAppUrl ? inboxLine(inbox) : undefined
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

    <Card title="today" aside={commitments.length > 0 && <span className="count" key={done}>{done}/{commitments.length}</span>}>
      {open.length
        ? <ul className="rows">{open.map((task) => <TaskRow key={task.id} task={task} done={false} hint={commitmentHint(task, currentDay, place)} onToggle={() => onToggle(task.id)} onOpen={() => onOpen(task.id)} />)}</ul>
        : commitments.length ? <Done label="all done today" /> : <Done label="nothing due today" />}
    </Card>

    <CalendarCard events={calendar} />

    <HabitCard date={currentDay} entries={habitEntries} habits={personalHabits} onToggle={onHabitPart} />

    <Card title="this week" aside={weeklyCommitments.length > 0 && <span className="count">{weeklyCommitments.length}</span>}>
      {weeklyCommitments.length
        ? <ul className="rows">{weeklyCommitments.map((task) => <TaskRow key={task.id} task={task} done={false} hint={task.dueDate ? `due ${weekday(task.dueDate)}` : undefined} onToggle={() => onToggle(task.id)} onOpen={() => onOpen(task.id)} />)}</ul>
        : <Done label="nothing else due this week" />}
    </Card>

    <ExtraTimeCard plan={plan} pickedMin={pickedMin} energy={energy} energyOptions={energyOptions} onMinutes={onMinutes} onEnergy={onEnergy} weekPaid={weekPaid} floorToday={floorToday} strategicTodayMin={strategicTodayMin} onFloorNight={onFloorNight} onStrategic={onStrategic} onToggle={onToggle} onOpen={onOpen} />

    {mailLine && <a className="card linkcard" href={mailAppUrl} target="_blank" rel="noreferrer"><span className="row-title">email</span><small>{mailLine}</small></a>}

    {untriaged.length > 0 && <details className="card sort">
      <summary>{untriaged.length} new to sort</summary>
      <ul className="rows">{untriaged.map((task) => <li className="row" key={task.id}>
        <button className="row-main" type="button" onClick={() => onOpen(task.id)}><span className="row-title">{task.title}</span>{guesses[task.id] && <small>{guessLine(guesses[task.id], domain, projects)}</small>}</button>
        {guesses[task.id] && <button className="link" type="button" aria-label={`confirm ${task.title}`} onClick={() => onConfirm(task.id)}>confirm</button>}
      </li>)}</ul>
    </details>}

    <DoneTodayCard tasks={doneTasks} onToggle={onToggle} onOpen={onOpen} />

    <p className="ledger">{openCount} open · {duration(openMin)}</p>
  </>
}
