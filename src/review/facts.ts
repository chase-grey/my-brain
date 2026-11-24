import { goalProgress } from '../domain/goals'
import { dueParts, habitDone } from '../domain/habits'
import { RING_DOMAINS } from '../domain/lifeRing'
import { buildWeekReceipt } from '../domain/receipt'
import type { Domain, Task } from '../domain/types'
import type { ProductState } from '../productState'
import type { Bump } from './bumpLog'
import { addDays, inPeriod, keyOf, nextPeriod, type Period } from './period'

export type Stat = { label: string; value: string }

/**
 * What the app can count about a period without a model. `lines` is the evidence a review may cite;
 * `next` is what the coming period already holds.
 */
export type Facts = { stats: Stat[]; lines: string[]; next: string[] }

export type FactsInput = { domain: Domain; period: Period; today: string; tasks: Task[]; product: ProductState; bumps: Bump[] }

const round1 = (value: number) => Math.round(value * 10) / 10
const hoursOf = (minutes: number) => round1(minutes / 60)
const minutesOf = (activity: { estimateDeltaMin?: number; minutes?: number }) => activity.estimateDeltaMin ?? activity.minutes ?? 0
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export function shortDay(day: string): string {
  return new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toLowerCase()
}

function countBy<T>(items: T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1)
  return counts
}

/** Whether the period holds anything worth a screen: something finished, pushed, logged, or ticked. */
export function hasActivity({ domain, period, product, bumps }: FactsInput): boolean {
  return product.activities.some((item) => item.domain === domain && inPeriod(period, item.occurredAt))
    || bumps.some((bump) => inPeriod(period, bump.on))
    || product.habitEntries.some((entry) => inPeriod(period, entry.date) && entry.completedPartIds.length > 0)
}

export function buildFacts({ domain, period, today, tasks, product, bumps }: FactsInput): Facts {
  const unit = period.kind
  const lines: string[] = []
  const stats: Stat[] = []
  const lastDay = addDays(period.end, -1) < today ? addDays(period.end, -1) : today
  const activities = product.activities.filter((item) => item.domain === domain)
  const within = activities.filter((item) => inPeriod(period, item.occurredAt))
  const open = tasks.filter((task) => task.domain === domain && !task.completed && !task.recurrence && !task.storeType)

  // Finished against pushed.
  const completions = activities.filter((item) => item.kind === 'task-completed')
  const done = completions.filter((item) => inPeriod(period, item.occurredAt))
  const pushed = bumps.filter((bump) => inPeriod(period, bump.on))
  const pushedTasks = new Set(pushed.map((bump) => bump.taskId))
  const byPeriod = countBy(completions, (item) => keyOf(unit, item.occurredAt.slice(0, 10)))
  const earlier = [...byPeriod].filter(([key]) => key < period.key)
  const before = earlier.sort(([a], [b]) => b.localeCompare(a))[0]
  stats.push({ label: 'done', value: String(done.length) }, { label: 'bumped', value: String(pushedTasks.size) })
  lines.push(`tasks finished: ${done.length} (${hoursOf(done.reduce((sum, item) => sum + minutesOf(item), 0))}h of estimates)${before ? `; the ${unit} before: ${before[1]}` : ''}`)
  if (earlier.length >= 3 && done.length > Math.max(...earlier.map(([, count]) => count))) lines.push(`most tasks finished in any ${unit} on record (${earlier.length} earlier ${unit}s)`)
  lines.push(`tasks bumped: ${pushedTasks.size} (${plural(pushed.length, 'time')} in all)`)
  if (done.length + pushedTasks.size > 0) {
    const rate = Math.round(done.length / (done.length + pushedTasks.size) * 100)
    stats.push({ label: 'finished vs bumped', value: `${rate}%` })
    lines.push(`finished ${rate}% of the tasks that were either finished or bumped`)
  }
  const allPushes = countBy(bumps, (bump) => bump.taskId)
  const repeats = open.filter((task) => (allPushes.get(task.id) ?? 0) >= 2).sort((a, b) => allPushes.get(b.id)! - allPushes.get(a.id)!)
  for (const task of repeats.slice(0, 5)) {
    const first = bumps.find((bump) => bump.taskId === task.id)!
    lines.push(`still open, bumped ${allPushes.get(task.id)} times since ${shortDay(first.on)}: "${task.title}"`)
  }
  const overdue = open.filter((task) => task.dueDate && task.dueDate < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
  if (overdue.length) lines.push(`${plural(overdue.length, 'open task')} past due; oldest "${overdue[0].title}", due ${shortDay(overdue[0].dueDate!)}`)

  // The weekly target.
  const weeks = product.commitments.filter((item) => item.domain === domain && inPeriod(period, item.weekStart))
  const receipts = weeks.map((week) => buildWeekReceipt(week, activities, product.dayOverrides))
  if (unit === 'week' && receipts[0]) {
    const receipt = receipts[0]
    stats.push({ label: 'weekly target', value: `${hoursOf(receipt.clearedMin)} of ${hoursOf(receipt.plannedMin)}h` })
    lines.push(`weekly target: cleared ${hoursOf(receipt.clearedMin)}h of ${hoursOf(receipt.plannedMin)}h (${receipt.paid ? 'met' : `${hoursOf(receipt.remainingMin)}h short`})`)
  } else if (receipts.length) {
    const met = receipts.filter((receipt) => receipt.paid).length
    stats.push({ label: 'weekly targets met', value: `${met} of ${receipts.length}` })
    lines.push(`weekly targets met: ${met} of ${receipts.length} weeks`)
  }

  // Goals: time given, where they stand, and how often the promise itself moved.
  const goals = product.goals.filter((goal) => goal.domain === domain && goal.status !== 'abandoned')
  let goalMin = 0
  for (const goal of goals) {
    const projects = new Set(product.projects.filter((project) => project.goalId === goal.id).map((project) => project.id))
    const minutes = within.filter((item) => item.projectId && projects.has(item.projectId)).reduce((sum, item) => sum + minutesOf(item), 0)
    goalMin += minutes
    const progress = goalProgress(goal, product.projects, activities, lastDay)
    const moved = goal.revisions.filter((revision) => inPeriod(period, revision.on)).map((revision) =>
      revision.field === 'date' ? `date moved from ${revision.from ? shortDay(String(revision.from)) : 'unset'} to ${revision.to ? shortDay(String(revision.to)) : 'unset'} on ${shortDay(revision.on)}` : `${revision.field} changed ${revision.from} to ${revision.to} on ${shortDay(revision.on)}`)
    const standing = progress.shape === 'block'
      ? progress.state === 'missed' ? `missed its day, ${shortDay(progress.scheduledOn!)}` : progress.state === 'scheduled' ? `set for ${shortDay(progress.scheduledOn!)}` : progress.state
      : `${hoursOf(minutes)}h this ${unit}, ${progress.hoursDone}h${progress.hoursCommitted ? ` of ${progress.hoursCommitted}h` : ''} overall, ${progress.state}`
    lines.push(`${goal.horizon} goal "${goal.title}": ${[standing, ...moved].join('; ')}`)
  }
  if (goals.length) stats.push({ label: 'goal hours', value: `${hoursOf(goalMin)}h` })

  // Life areas, most important first: what was promised for 28 days, scaled to the period.
  const days = Math.max(1, Math.round((Date.parse(addDays(lastDay, 1)) - Date.parse(period.start)) / 86_400_000))
  const areas = RING_DOMAINS.filter((area) => !product.ringOff.includes(area))
  areas.forEach((area, index) => {
    const promised = product.ringCommitments.find((item) => item.domain === area)?.commitment28 ?? 0
    if (!promised) return
    const logged = product.ringEvidence.filter((item) => item.domain === area && inPeriod(period, item.on)).reduce((sum, item) => sum + item.value, 0)
    lines.push(`life area ${area} (importance ${index + 1} of ${areas.length}): ${round1(logged)} logged against ${round1(promised * days / 28)} promised`)
  })

  // Habits.
  let dueDays = 0
  let keptDays = 0
  for (const habit of product.habits.filter((item) => item.domain === domain && item.countsTowardStreak)) {
    let due = 0
    let kept = 0
    for (let day = period.start; day <= lastDay; day = addDays(day, 1)) {
      if (!dueParts(habit, day).length) continue
      due += 1
      if (habitDone(habit, product.habitEntries, day)) kept += 1
    }
    if (!due) continue
    dueDays += due
    keptDays += kept
    lines.push(`habit "${habit.title}": ${kept} of ${plural(due, 'day')}`)
  }
  if (dueDays) stats.push({ label: 'habits', value: `${Math.round(keptDays / dueDays * 100)}%` })

  const seen = new Set(within.filter((item) => item.kind === 'connection').flatMap((item) => item.withPeople ?? []))
  if (domain === 'personal') lines.push(`people seen: ${seen.size}`)
  for (const rest of product.restCheckIns.filter((item) => inPeriod(period, item.createdAt))) lines.push(`rest check-in ${shortDay(rest.createdAt)}: ${rest.rating} of 10`)

  // What the coming period already holds.
  const coming = nextPeriod(period)
  const next: string[] = []
  for (const goal of goals.filter((item) => item.status === 'active')) {
    const progress = goalProgress(goal, product.projects, activities, today)
    if (progress.shape === 'block') {
      if (progress.scheduledOn && inPeriod(coming, progress.scheduledOn)) next.push(`${goal.title} · ${shortDay(progress.scheduledOn)}`)
      else if (progress.state === 'unscheduled' || progress.state === 'missed') next.push(`${goal.title} · needs a day`)
    } else if (progress.state === 'behind') {
      next.push(`${goal.title} · ${round1(progress.expectedHours! - progress.hoursDone)}h behind`)
    }
  }
  const due = open.filter((task) => task.dueDate && inPeriod(coming, task.dueDate)).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
  for (const task of due.slice(0, 5)) next.push(`${task.title} · due ${shortDay(task.dueDate!)}`)
  for (const task of repeats.slice(0, 3)) if (!due.includes(task)) next.push(`${task.title} · bumped ${allPushes.get(task.id)} times`)

  return { stats, lines, next: next.slice(0, 8) }
}
