import { describe, expect, it } from 'vitest'
import { completedParts, defaultPersonalHabits, dueParts, habitDone, toggleHabitPart } from './habits'

const vitamins = defaultPersonalHabits.find((habit) => habit.id === 'vitamins')!

describe('personal care habits', () => {
  it('tracks a multivitamin daily and iron every other day', () => {
    expect(dueParts(vitamins, '2026-09-03').map((part) => part.id)).toEqual(['multivitamin', 'iron'])
    expect(dueParts(vitamins, '2026-09-04').map((part) => part.id)).toEqual(['multivitamin'])
    expect(dueParts(vitamins, '2026-09-05').map((part) => part.id)).toEqual(['multivitamin', 'iron'])
  })

  it('no longer tracks teeth whitening', () => {
    expect(defaultPersonalHabits.map((habit) => habit.id)).toEqual(['vitamins'])
  })

  it('keeps compound-habit parts independent and supports correction', () => {
    let entries = toggleHabitPart([], vitamins.id, 'multivitamin', '2026-09-03')
    expect(completedParts(entries, vitamins.id, '2026-09-03')).toEqual(['multivitamin'])
    expect(habitDone(vitamins, entries, '2026-09-03')).toBe(false)

    entries = toggleHabitPart(entries, vitamins.id, 'iron', '2026-09-03')
    expect(habitDone(vitamins, entries, '2026-09-03')).toBe(true)

    entries = toggleHabitPart(entries, vitamins.id, 'iron', '2026-09-03')
    expect(habitDone(vitamins, entries, '2026-09-03')).toBe(false)
  })
})
