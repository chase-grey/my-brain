import type { Habit, HabitEntry, HabitPart } from './types'

export const defaultPersonalHabits: Habit[] = [
  {
    id: 'vitamins',
    domain: 'personal',
    title: 'vitamins',
    cadence: { unit: 'day', interval: 1 },
    estimateMin: 2,
    startedOn: '2026-09-03',
    countsTowardStreak: true,
    timeWindow: 'morning',
    parts: [
      { id: 'multivitamin', title: 'multivitamin', intervalDays: 1 },
      { id: 'iron', title: 'iron', intervalDays: 2 },
    ],
  },
  {
    id: 'teeth-whitening',
    domain: 'personal',
    title: 'teeth whitening',
    cadence: { unit: 'day', interval: 1 },
    estimateMin: 1,
    startedOn: '2026-09-03',
    countsTowardStreak: true,
    timeWindow: 'evening',
    parts: [{ id: 'strip', title: 'whitening strip', intervalDays: 1 }],
  },
]

function dayNumber(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
}

export function partDue(habit: Habit, part: HabitPart, date: string): boolean {
  const elapsed = dayNumber(date) - dayNumber(habit.startedOn)
  return elapsed >= 0 && elapsed % part.intervalDays === 0
}

export function dueParts(habit: Habit, date: string): HabitPart[] {
  return (habit.parts ?? []).filter((part) => partDue(habit, part, date))
}

export function completedParts(entries: HabitEntry[], habitId: string, date: string): string[] {
  return entries.findLast((entry) => entry.habitId === habitId && entry.date === date)?.completedPartIds ?? []
}

export function habitDone(habit: Habit, entries: HabitEntry[], date: string): boolean {
  const completed = new Set(completedParts(entries, habit.id, date))
  const due = dueParts(habit, date)
  return due.length > 0 && due.every((part) => completed.has(part.id))
}

export function toggleHabitPart(
  entries: HabitEntry[],
  habitId: string,
  partId: string,
  date: string,
): HabitEntry[] {
  const completed = new Set(completedParts(entries, habitId, date))
  if (completed.has(partId)) completed.delete(partId)
  else completed.add(partId)
  const entry: HabitEntry = { habitId, date, completedPartIds: [...completed] }
  return [...entries.filter((item) => item.habitId !== habitId || item.date !== date), entry]
}
