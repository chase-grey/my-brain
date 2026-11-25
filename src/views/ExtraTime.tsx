import { useState } from 'react'
import { timeStops } from '../domain/calendar'
import type { buildNowPlan } from '../domain/personalNow'
import type { Energy } from '../domain/types'
import { duration } from '../format'
import { Card, Empty, Field, Menu, Segmented, TaskRow } from '../ui'

/** Where the slider sits for a length: the last stop that is not over it. */
export function stopFor(minutes: number): number {
  return Math.max(0, timeStops.findLastIndex((stop) => stop <= minutes))
}

/**
 * Extra time is asked for, never offered: the card is not drawn until he says he has some,
 * and no task is suggested until the slider says how much.
 */
export function ExtraTimeCard({ plan, pickedMin, energy, energyOptions, onMinutes, onEnergy, weekPaid, floorToday, strategicTodayMin, onFloorNight, onStrategic, onToggle, onOpen, startAsked = false }: {
  plan: ReturnType<typeof buildNowPlan>
  /** The length he set on the slider, while it stands. */
  pickedMin?: number
  energy: Energy
  energyOptions: { value: Energy; label: string }[]
  onMinutes: (minutes?: number) => void
  onEnergy: (energy: Energy) => void
  weekPaid: boolean
  floorToday: boolean
  strategicTodayMin: number
  onFloorNight: () => void
  onStrategic: (minutes: number) => void
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  startAsked?: boolean
}) {
  const [asked, setAsked] = useState(startAsked)
  const picked = pickedMin !== undefined && pickedMin > 0

  if (!asked && !picked) return <button className="card linkcard extra-ask" type="button" onClick={() => setAsked(true)}><span className="row-title">i have extra time</span></button>

  const hide = { label: 'hide', onSelect: () => { setAsked(false); onMinutes(undefined) } }
  if (weekPaid) return <Card title="extra time" aside={<Menu items={[hide]} />}><Empty>the week is paid</Empty></Card>

  return <Card title="extra time" aside={<Menu items={[
    { label: floorToday ? 'floor night logged' : 'floor night', onSelect: onFloorNight, disabled: floorToday },
    ...[30, 60, 90].map((minutes) => ({ label: `strategic ${duration(minutes)}`, onSelect: () => onStrategic(minutes) })),
    hide,
  ]} />}>
    <div className="pickers">
      <Field label={picked ? `time available · ${duration(pickedMin)}` : 'time available'}>
        <input type="range" min={0} max={timeStops.length - 1} step={1} value={picked ? stopFor(pickedMin) : 0} aria-valuetext={picked ? duration(pickedMin) : 'none'} onChange={(event) => {
          setAsked(true)
          onMinutes(timeStops[Number(event.target.value)] || undefined)
        }} />
      </Field>
      {picked && <Segmented label="energy" options={energyOptions} value={energy} onChange={onEnergy} />}
    </div>
    {(floorToday || strategicTodayMin > 0) && <p className="note">{[floorToday && 'floor night', strategicTodayMin > 0 && `strategic ${duration(strategicTodayMin)}`].filter(Boolean).join(' · ')}</p>}
    {picked && (plan.tasks.length
      ? <ul className="rows">{plan.tasks.map((task) => <TaskRow key={task.id} task={task} done={false} onToggle={() => onToggle(task.id)} onOpen={() => onOpen(task.id)} />)}</ul>
      : <Empty>nothing fits this window</Empty>)}
    {picked && plan.tasks.length > 0 && <p className="fit">{duration(plan.totalMin)} planned · {duration(Math.max(0, plan.availableMin - plan.totalMin))} open</p>}
  </Card>
}
