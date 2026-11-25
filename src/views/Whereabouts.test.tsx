import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { buildNowPlan } from '../domain/personalNow'
import type { Task } from '../domain/types'
import { commitmentHint, TodayView } from './TodayView'
import { GoneCard, WherePicker } from './Whereabouts'

const plan = { tasks: [], totalMin: 0, availableMin: 0 } as unknown as ReturnType<typeof buildNowPlan>
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, title: id, completed: false, taskId: id, domain: 'personal', estimateMin: 30, originalEstimateMin: 30, priority: 3,
  energy: 'shallow', pinned: false, carries: 0, ...extra,
} as Task)

const today = (props: Partial<Parameters<typeof TodayView>[0]> = {}) => renderToStaticMarkup(<TodayView domain="personal" currentDay="2026-11-25" place="home"
  onPlaceOverride={() => {}} onGone={() => {}} commitments={[task('pay rent', { dueDate: '2026-11-25' })]} weeklyCommitments={[task('renew plates', { dueDate: '2026-11-27' })]}
  habits={[]} habitEntries={[]} onHabitPart={() => {}} plan={plan} energy="shallow" onMinutes={() => {}} onEnergy={() => {}} weekPaid={false} floorToday={false}
  strategicTodayMin={0} onFloorNight={() => {}} onStrategic={() => {}} untriaged={[task('sort me', { metadataComplete: false })]} guesses={{}} projects={[]} onConfirm={() => {}}
  openCount={9} openMin={300} onToggle={() => {}} onOpen={() => {}} doneTasks={[]} calendar={[]} inbox={{ needsMe: 2 }} mailAppUrl="https://mail.example/" {...props} />)

it('shows everything while he is here', () => {
  const html = today()
  expect(html).toContain('1 new to sort')
  expect(html).toContain('i have extra time')
  expect(html).toContain('2 need me')
  expect(html).toContain('9 open')
  expect(html).not.toContain('i’m back')
})

it('gone keeps what is due today and this week, and puts the rest away', () => {
  const html = today({ gone: '2026-12-03' })
  expect(html).toContain('back thu, dec 3')
  expect(html).toContain('i’m back')
  expect(html).toContain('pay rent')
  expect(html).toContain('renew plates')
  expect(html).not.toContain('new to sort')
  expect(html).not.toContain('i have extra time')
  expect(html).not.toContain('need me')
  expect(html).not.toContain('9 open')
})

it('offers home, work, out and gone, and says where the wifi or the clock put him', () => {
  const picker = (props: Partial<Parameters<typeof WherePicker>[0]> = {}) => renderToStaticMarkup(<WherePicker place="out" asking={false} onPick={() => {}} onAsk={() => {}} onGone={() => {}} currentDay="2026-11-25" {...props} />)
  expect(picker()).toContain('>out · auto<')
  expect(picker()).toContain('<option value="gone">gone</option>')
  expect(picker()).toContain('<option value="out">out</option>')
  expect(picker({ gone: '2026-12-03' })).toContain('<option value="gone" selected="">')
})

it('asks for the day back, from tomorrow on', () => {
  const html = renderToStaticMarkup(<GoneCard asking currentDay="2026-11-25" onGone={() => {}} onCancel={() => {}} />)
  expect(html).toContain('back on')
  expect(html).toContain('min="2026-11-26"')
  expect(renderToStaticMarkup(<GoneCard asking={false} currentDay="2026-11-25" onGone={() => {}} onCancel={() => {}} />)).toBe('')
})

it('a task for somewhere else says where', () => {
  expect(commitmentHint(task('a', { place: ['home'] }), '2026-11-25', 'out')).toBe('when you’re home')
  expect(commitmentHint(task('b', { place: ['out'] }), '2026-11-25', 'home')).toBe('when you’re out')
})
