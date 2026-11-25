import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { companionTask } from '../companion/companionTools'
import { taskMetadata } from '../data/personalTaskSync'
import { setReminders, type ReminderPhone } from '../native/reminders'
import { widgetSnapshot } from '../native/widget'
import { TaskPage } from '../views/TaskPage'
import { commitmentHint, guessLine } from '../views/TodayView'
import { isThisWeekCommitment, todayCommitments } from './personalNow'
import { localMoment, remindLabel, reminderId, remindersFor, upcoming, validMoment } from './remind'
import { guessPrompt, parseGuesses, sortedTask } from './taskGuess'
import type { Task } from './types'

// A wednesday afternoon. The monday after it is nov 30.
const now = '2026-11-25T14:30'
const monday = '2026-11-30T07:00'

function task(id: string, extra: Partial<Task> = {}): Task {
  return { id, taskId: id, domain: 'personal', title: 'bring mittens to work', completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: true, ...extra }
}

describe('a reminder on a task', () => {
  it('is a moment on the phone’s clock, to the minute', () => {
    expect(localMoment(new Date(2026, 10, 30, 7, 5))).toBe('2026-11-30T07:05')
    expect(validMoment('2026-11-30T07:00:00')).toBe(monday)
    for (const wrong of ['2026-11-30', 'monday morning', '2026-02-30T07:00', '2026-11-30T25:00', 'none', 7, undefined]) expect(validMoment(wrong)).toBeUndefined()
  })

  it('needs no due date, and gives the task none', () => {
    const reminded = task('a', { remindAt: monday })
    expect(reminded.dueDate).toBeUndefined()
    expect(todayCommitments([reminded], '2026-11-30')).toEqual([reminded])
    expect(isThisWeekCommitment(reminded, '2026-11-25')).toBe(false)
    const sorted = sortedTask(task('b', { metadataComplete: false }), { estimateMin: 5, priority: 3, energy: 'shallow', remindAt: monday }, '2026-11-25', now)
    expect(sorted.remindAt).toBe(monday)
    expect(sorted.dueDate).toBeUndefined()
  })

  it('rides with the task to the other devices', () => {
    expect(taskMetadata([task('a', { remindAt: monday })])[0].remindAt).toBe(monday)
  })

  it('puts the task on today from its day until it is done', () => {
    const reminded = task('a', { remindAt: monday })
    expect(todayCommitments([reminded], '2026-11-29')).toEqual([])
    expect(commitmentHint(reminded, '2026-11-30', 'home')).toBe('reminder 7am')
    expect(todayCommitments([reminded], '2026-12-02')).toEqual([reminded])
    expect(commitmentHint(reminded, '2026-12-02', 'home')).toBe('reminded nov 30')
    expect(widgetSnapshot('personal', [reminded], '2026-11-30', 'home').lines[0].hint).toBe('reminder 7am')
    const done = { ...reminded, completed: true }
    expect(todayCommitments([done], '2026-11-30')).toEqual([done])
    expect(todayCommitments([done], '2026-12-01')).toEqual([])
  })

  it('stays hidden while the task is hidden, and is not for work or a routine', () => {
    expect(todayCommitments([task('a', { remindAt: monday, hiddenUntil: '2026-12-05' })], '2026-11-30')).toEqual([])
    expect(todayCommitments([task('w', { domain: 'work', remindAt: monday })], '2026-11-30', 'work')).toEqual([])
    expect(remindersFor([task('w', { domain: 'work', remindAt: monday }), task('r', { recurrence: 'daily', remindAt: monday })], now)).toEqual([])
  })

  it('reads the way it is said', () => {
    expect(remindLabel('2026-11-25T18:00', now)).toBe('today 6pm')
    expect(remindLabel('2026-11-26T06:30', now)).toBe('tomorrow 6:30am')
    expect(remindLabel(monday, now)).toBe('mon 7am')
    expect(remindLabel('2026-12-14T12:00', now)).toBe('dec 14 12pm')
  })
})

describe('guessing a reminder', () => {
  const unsorted = task('a', { metadataComplete: false })

  it('asks for one against the day and time it is, in the personal space only', () => {
    const prompt = guessPrompt('personal', [], now)
    expect(prompt).toContain('"remind"')
    expect(prompt).toContain('Wednesday 2026-11-25T14:30')
    expect(prompt).toContain('not a due date')
    expect(guessPrompt('work', [], now)).not.toContain('"remind"')
  })

  it('takes a moment still to come and drops anything else', () => {
    const guess = (remind: unknown, domain: 'personal' | 'work' = 'personal') => parseGuesses(JSON.stringify({ tasks: [{ n: 1, minutes: 5, priority: 3, energy: 'shallow', remind }] }), [unsorted], domain, [], now).a
    expect(guess(monday).remindAt).toBe(monday)
    for (const wrong of ['none', '2026-11-24T07:00', now, 'monday before work', '', null]) expect(guess(wrong)).not.toHaveProperty('remindAt')
    expect(guess(monday, 'work')).not.toHaveProperty('remindAt')
  })

  it('is shown on the line under the task, and filled into the form, until its moment has gone', () => {
    const guess = { estimateMin: 5, priority: 3 as const, energy: 'shallow' as const, place: ['home' as const], remindAt: monday }
    expect(guessLine(guess, 'personal', [], now)).toBe('5m · light · at home · remind mon 7am')
    expect(guessLine(guess, 'personal', [], '2026-11-30T07:01')).toBe('5m · light · at home')
    expect(sortedTask(unsorted, guess, '2026-11-30', '2026-11-30T07:01').remindAt).toBeUndefined()
    expect(upcoming(monday, monday)).toBeUndefined()
  })

  it('never takes the place of a reminder the task already has', () => {
    expect(sortedTask({ ...unsorted, remindAt: '2026-12-01T09:00' }, { estimateMin: 5, priority: 3, energy: 'shallow', remindAt: monday }, '2026-11-25', now).remindAt).toBe('2026-12-01T09:00')
  })
})

describe('a reminder asked for in the chat', () => {
  it('is set on the task it makes, with no due date, in the personal space only', () => {
    expect(companionTask('personal', { title: 'bring mittens to work', remindAt: monday }, '2026-11-25', 'x')).toMatchObject({ remindAt: monday, metadataComplete: true })
    expect(companionTask('personal', { title: 'bring mittens to work', remindAt: monday }, '2026-11-25', 'x').dueDate).toBeUndefined()
    expect(companionTask('work', { title: 'bring mittens to work', remindAt: monday }, '2026-11-25', 'x').remindAt).toBeUndefined()
  })
})

describe('the sort form', () => {
  const page = (existingTask: Task | undefined, domain: 'personal' | 'work' = 'personal', remindAt?: string) => renderToStaticMarkup(createElement(TaskPage, {
    domain, existingTask, guess: remindAt ? { estimateMin: 5, priority: 3, energy: 'shallow', remindAt } : undefined, projects: [],
    onAdd: () => {}, onUpdate: () => {}, onDelete: () => {}, onDone: () => {}, onNotMine: () => {}, onCancel: () => {},
  }))

  it('has remind me beside due, with the time the task has', () => {
    const html = page(task('a', { remindAt: monday }))
    expect(html).toContain('remind me')
    expect(html).toContain(`type="datetime-local" value="${monday}"`)
  })

  it('starts on the guess for a task still to be sorted', () => {
    const later = `${new Date().getFullYear() + 1}-03-02T07:00`
    expect(page(task('a', { metadataComplete: false }), 'personal', later)).toContain(`type="datetime-local" value="${later}"`)
    expect(page(task('a', { metadataComplete: false }), 'personal', '2020-03-02T07:00')).toContain('type="datetime-local" value=""')
  })

  it('has none in work or on a routine', () => {
    expect(page(task('w', { domain: 'work' }), 'work')).not.toContain('remind me')
    expect(page(task('r', { recurrence: 'daily' }))).not.toContain('remind me')
  })
})

describe('what the phone holds', () => {
  const tasks = [
    task('later', { title: 'water the tree', remindAt: '2026-12-01T18:00' }),
    task('soon', { remindAt: monday }),
    task('gone', { remindAt: '2026-11-25T07:00' }),
    task('done', { remindAt: monday, completed: true }),
    task('plain'),
  ]

  function fakePhone(pending: number[] = [], display = 'granted') {
    const calls: string[] = []
    const phone: ReminderPhone = {
      checkPermissions: async () => ({ display }),
      requestPermissions: async () => { calls.push('ask'); return { display: 'granted' } },
      getPending: async () => ({ notifications: pending.map((id) => ({ id })) }),
      cancel: async ({ notifications }) => { calls.push(`cancel ${notifications.map(({ id }) => id).join(',')}`) },
      schedule: async ({ notifications }) => { calls.push(...notifications.map((item) => `set ${item.title} ${localMoment(item.schedule.at)} ${item.extra.taskId} ${item.schedule.allowWhileIdle}`)) },
    }
    return { phone, calls }
  }

  it('is every open task with a reminder still to come, soonest first', () => {
    expect(remindersFor(tasks, now).map(({ taskId, title, at }) => [taskId, title, at])).toEqual([
      ['soon', 'bring mittens to work', monday],
      ['later', 'water the tree', '2026-12-01T18:00'],
    ])
  })

  it('gives each task a number of its own that does not change', () => {
    expect(reminderId('soon')).toBe(reminderId('soon'))
    expect(reminderId('soon')).not.toBe(reminderId('later'))
    for (const id of ['', 'a', 'AAMkAGI2THVSAAA=']) expect(reminderId(id)).toBeGreaterThan(0)
    expect(reminderId('AAMkAGI2THVSAAA=')).toBeLessThanOrEqual(0x7fffffff)
  })

  it('drops what it had and sets what is wanted, at the moment asked for', async () => {
    const { phone, calls } = fakePhone([11, 12])
    await setReminders(phone, remindersFor(tasks, now))
    expect(calls).toEqual(['cancel 11,12', `set bring mittens to work ${monday} soon true`, 'set water the tree 2026-12-01T18:00 later true'])
  })

  it('clears the last one when its task is done or its reminder is taken off', async () => {
    const { phone, calls } = fakePhone([11])
    await setReminders(phone, [])
    expect(calls).toEqual(['cancel 11'])
  })

  it('asks to notify once there is a reminder to set, and not before', async () => {
    const first = fakePhone([], 'prompt')
    await setReminders(first.phone, remindersFor(tasks, now))
    expect(first.calls[0]).toBe('ask')
    const none = fakePhone([], 'prompt')
    await setReminders(none.phone, [])
    expect(none.calls).toEqual([])
  })
})
