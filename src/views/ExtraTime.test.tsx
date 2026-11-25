import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { timeStops } from '../domain/calendar'
import type { buildNowPlan } from '../domain/personalNow'
import { ExtraTimeCard, stopFor } from './ExtraTime'

const plan = { tasks: [], totalMin: 0, availableMin: 0 } as unknown as ReturnType<typeof buildNowPlan>
const card = (props: Partial<Parameters<typeof ExtraTimeCard>[0]> = {}) => renderToStaticMarkup(<ExtraTimeCard plan={plan} energy="shallow" energyOptions={[{ value: 'shallow', label: 'light' }]} onMinutes={() => {}} onEnergy={() => {}} weekPaid={false} floorToday={false} strategicTodayMin={0} onFloorNight={() => {}} onStrategic={() => {}} onToggle={() => {}} onOpen={() => {}} {...props} />)

it('is not drawn until he says he has extra time', () => {
  const html = card()
  expect(html).toContain('>i have extra time<')
  expect(html).not.toContain('type="range"')
  expect(html).not.toContain('time available')
})

it('asks how much on a slider, and suggests nothing until it is moved', () => {
  const html = card({ startAsked: true })
  expect(html).toContain('type="range"')
  expect(html).toContain('>time available<')
  expect(html).not.toContain('nothing fits')
  expect(html).not.toContain('light')
})

it('stays while a length stands, and says the length', () => {
  const html = card({ pickedMin: 24 * 60 })
  expect(html).toContain('time available · 24h')
  expect(html).toContain(`value="${timeStops.length - 1}"`)
  expect(html).toContain('nothing fits this window')
  expect(html).toContain('>hide<')
})

it('puts the slider on the stop for a length', () => {
  expect(stopFor(0)).toBe(0)
  expect(timeStops[stopFor(45)]).toBe(45)
  expect(timeStops[stopFor(100)]).toBe(90)
  expect(timeStops[stopFor(1440)]).toBe(1440)
})
