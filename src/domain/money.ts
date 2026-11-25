// The money slice follows money goals: a figure to reach by a date, a loan to pay off by a date, or months of
// spending kept in savings. The numbers come from screenshots (read once, then thrown away) or are typed in.
// Each snapshot holds only the figures it was given; a goal reads the latest value of its own figure.

export const MONEY_FIGURES = ['netWorth', 'savings', 'investments', 'homeRemaining', 'carRemaining', 'otherDebt', 'incomeMonthly', 'spendingMonthly'] as const
export type MoneyFigure = typeof MONEY_FIGURES[number]

export const moneyFigureLabels: Record<MoneyFigure, string> = {
  netWorth: 'net worth',
  savings: 'savings',
  investments: 'investments',
  homeRemaining: 'home loan left',
  carRemaining: 'car loan left',
  otherDebt: 'other debt',
  incomeMonthly: 'monthly income',
  spendingMonthly: 'monthly spending',
}

export type MoneyAccount = { name: string; balance: number }

export type MoneySnapshot = Partial<Record<MoneyFigure, number>> & {
  month: string
  /** The day the numbers were read. Snapshots saved before 2026-11-25 have only a month, and a zero there means left blank. */
  on?: string
  /** Account lines as the screenshots showed them, kept for questions in chat. */
  accounts?: MoneyAccount[]
}

export type MoneyGoalKind = 'reach' | 'payoff' | 'cover'

export type MoneyGoal = {
  id: string
  title: string
  kind: MoneyGoalKind
  figure: MoneyFigure
  /** reach: the amount to get to. */
  amount?: number
  /** cover: how many months of spending savings should hold. */
  months?: number
  /** reach and payoff: the day it should be done by. */
  by?: string
  startOn: string
  /** The figure on the day the goal was set; taken from the first reading after when there was none yet. */
  startValue?: number
}

export const goalFigures: Record<MoneyGoalKind, MoneyFigure[]> = {
  reach: ['netWorth', 'savings', 'investments'],
  payoff: ['homeRemaining', 'carRemaining', 'otherDebt'],
  cover: ['savings'],
}

export type MoneyStanding = {
  goal: MoneyGoal
  state: 'no numbers' | 'on pace' | 'behind' | 'met' | 'short' | 'no date'
  /** 0 to 1: this goal's share of the slice. */
  score: number
  /** 0 to 1: how far along the goal itself is. */
  progress: number
  current?: number
  /** Where the figure should be today to finish on time. */
  expected?: number
  /** cover: months of spending that savings holds now. */
  monthsCovered?: number
}

export type MoneyReading = {
  /** 0 to 1: how the slice fills. */
  fill: number
  standings: MoneyStanding[]
  /** The day of the newest numbers. */
  asOf?: string
  monthsTracked: number
}

const ms = (day: string) => new Date(`${day}T00:00:00Z`).getTime()
const clamp = (value: number) => Math.min(1, Math.max(0, value))
const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

export const snapshotDay = (snapshot: MoneySnapshot): string => snapshot.on ?? `${snapshot.month}-01`

/** One figure over time, oldest first. */
export function figureHistory(snapshots: MoneySnapshot[], figure: MoneyFigure): { on: string; value: number }[] {
  return snapshots
    .filter((item) => isAmount(item[figure]) && (item.on !== undefined || item[figure] !== 0))
    .map((item) => ({ on: snapshotDay(item), value: item[figure]! }))
    .sort((a, b) => a.on.localeCompare(b.on))
}

/** The newest value of every figure that has one. */
export function latestFigures(snapshots: MoneySnapshot[]): Partial<Record<MoneyFigure, { on: string; value: number }>> {
  const latest: Partial<Record<MoneyFigure, { on: string; value: number }>> = {}
  for (const figure of MONEY_FIGURES) {
    const history = figureHistory(snapshots, figure)
    if (history.length) latest[figure] = history[history.length - 1]
  }
  return latest
}

/** Adds a day's numbers. A second reading on the same day fills in or replaces figures and leaves the rest of that day alone. */
export function addMoneyReading(snapshots: MoneySnapshot[], on: string, figures: Partial<Record<MoneyFigure, number>>, accounts: MoneyAccount[] = []): MoneySnapshot[] {
  const given = Object.fromEntries(MONEY_FIGURES.filter((figure) => isAmount(figures[figure])).map((figure) => [figure, figures[figure]])) as Partial<Record<MoneyFigure, number>>
  if (!Object.keys(given).length && !accounts.length) return snapshots
  const same = snapshots.find((item) => item.on === on)
  const names = new Set(accounts.map((account) => account.name))
  const merged = [...(same?.accounts ?? []).filter((account) => !names.has(account.name)), ...accounts]
  const next: MoneySnapshot = { ...same, ...given, month: on.slice(0, 7), on, ...(merged.length ? { accounts: merged } : {}) }
  return [...snapshots.filter((item) => item !== same), next].sort((a, b) => snapshotDay(a).localeCompare(snapshotDay(b)))
}

/**
 * Where one goal stands today.
 *
 * Pace is a straight line from the figure on the day the goal was set to the target on its date; on or ahead of
 * the line is on pace and scores 1, behind scores the share of the expected ground that was covered. Today is the
 * yardstick, so numbers that have gone stale read as behind until a new reading arrives.
 */
export function moneyStanding(goal: MoneyGoal, snapshots: MoneySnapshot[], today: string): MoneyStanding {
  const history = figureHistory(snapshots, goal.figure)
  const latest = history[history.length - 1]
  const none: MoneyStanding = { goal, state: 'no numbers', score: 0, progress: 0 }
  if (!latest) return none

  if (goal.kind === 'cover') {
    const spending = figureHistory(snapshots, 'spendingMonthly').pop()
    if (!spending || spending.value <= 0 || !goal.months) return { ...none, current: latest.value }
    const monthsCovered = latest.value / spending.value
    const progress = clamp(monthsCovered / goal.months)
    return { goal, state: progress >= 1 ? 'met' : 'short', score: progress, progress, current: latest.value, monthsCovered }
  }

  const target = goal.kind === 'payoff' ? 0 : goal.amount
  if (target === undefined) return none
  const start = goal.startValue ?? history.find((item) => item.on >= goal.startOn)?.value
  if (start === undefined) return { ...none, current: latest.value }
  const current = latest.value
  const done = goal.kind === 'payoff' ? current <= target : current >= target
  if (done) return { goal, state: 'met', score: 1, progress: 1, current }
  const progress = start === target ? 0 : clamp((current - start) / (target - start))
  if (!goal.by) return { goal, state: 'no date', score: progress, progress, current }
  const span = ms(goal.by) - ms(goal.startOn)
  const elapsed = span <= 0 ? 1 : clamp((ms(today) - ms(goal.startOn)) / span)
  const expected = start + (target - start) * elapsed
  const onPace = goal.kind === 'payoff' ? current <= expected : current >= expected
  return { goal, state: onPace ? 'on pace' : 'behind', score: onPace ? 1 : clamp(progress / elapsed), progress, current, expected }
}

/** The slice: every goal weighs the same. Nothing when no goal is set, so money works like any other area. */
export function moneyReading(goals: MoneyGoal[], snapshots: MoneySnapshot[], today: string): MoneyReading | undefined {
  if (!goals.length) return undefined
  const standings = goals.map((goal) => moneyStanding(goal, snapshots, today))
  const days = snapshots.map(snapshotDay).sort()
  return {
    fill: standings.reduce((sum, item) => sum + item.score, 0) / standings.length,
    standings,
    asOf: days[days.length - 1],
    monthsTracked: new Set(days.map((day) => day.slice(0, 7))).size,
  }
}

/** What is kept of each month's income, from the newest income and spending. Nothing when either is missing. */
export function savingRate(snapshots: MoneySnapshot[]): { rate: number; kept: number; on: string } | undefined {
  const latest = latestFigures(snapshots)
  const income = latest.incomeMonthly
  const spending = latest.spendingMonthly
  if (!income || !spending || income.value <= 0) return undefined
  return { rate: (income.value - spending.value) / income.value, kept: income.value - spending.value, on: income.on > spending.on ? income.on : spending.on }
}

/** Numbers older than this read as old: goals judge against today, so they look behind until new ones arrive. */
export const MONEY_STALE_DAYS = 31

/** How many days old the newest numbers are, once that is more than a month. */
export function numbersAge(snapshots: MoneySnapshot[], today: string): number | undefined {
  const newest = snapshots.map(snapshotDay).sort().pop()
  if (!newest) return undefined
  const days = Math.round((ms(today) - ms(newest)) / 86_400_000)
  return days > MONEY_STALE_DAYS ? days : undefined
}

/** A goal as it is saved: the starting figure is whatever the latest reading says today. */
export function newMoneyGoal(input: Omit<MoneyGoal, 'startOn' | 'startValue'>, snapshots: MoneySnapshot[], today: string): MoneyGoal {
  const start = figureHistory(snapshots, input.figure).pop()
  return { ...input, startOn: today, ...(start ? { startValue: start.value } : {}) }
}

/** $1.2m, $48k, $950: short enough for a row. */
export function money(value: number): string {
  const sign = value < 0 ? '-' : ''
  const size = Math.abs(value)
  const trim = (number: number) => String(Math.round(number * 10) / 10)
  if (size >= 999_950) return `${sign}$${trim(size / 1_000_000)}m`
  if (size >= 10_000) return `${sign}$${Math.round(size / 1000)}k`
  if (size >= 1000) return `${sign}$${trim(size / 1000)}k`
  return `${sign}$${Math.round(size)}`
}

/** "$310k of $1m · behind", the line a goal row and a review share. */
export function standingText(standing: MoneyStanding): string {
  const { goal, state, current, monthsCovered } = standing
  if (current === undefined) return 'no numbers yet'
  if (goal.kind === 'cover') return monthsCovered === undefined ? 'needs monthly spending' : `${Math.round(monthsCovered * 10) / 10} of ${goal.months} months · ${state}`
  const head = goal.kind === 'payoff' ? `${money(current)} left` : `${money(current)} of ${money(goal.amount ?? 0)}`
  return state === 'no date' ? head : `${head} · ${state}`
}

/** What the chat is told about money: the latest figures, the accounts, and each goal's standing. */
export function moneyBriefing(goals: MoneyGoal[], snapshots: MoneySnapshot[], today: string): string[] {
  const latest = latestFigures(snapshots)
  const lines = MONEY_FIGURES.filter((figure) => latest[figure]).map((figure) => `- ${moneyFigureLabels[figure]}: $${Math.round(latest[figure]!.value).toLocaleString('en-US')} (as of ${latest[figure]!.on})`)
  const saving = savingRate(snapshots)
  if (saving) lines.push(`- saving rate: ${Math.round(saving.rate * 100)}% of income ($${Math.round(saving.kept).toLocaleString('en-US')} a month)`)
  const newest = [...snapshots].reverse().find((item) => item.accounts?.length)
  for (const account of newest?.accounts ?? []) lines.push(`- account ${account.name}: $${Math.round(account.balance).toLocaleString('en-US')} (as of ${snapshotDay(newest!)})`)
  for (const standing of moneyReading(goals, snapshots, today)?.standings ?? []) {
    const { goal } = standing
    const aim = goal.kind === 'cover' ? `keep ${goal.months} months of spending in savings` : goal.kind === 'payoff' ? `pay off ${moneyFigureLabels[goal.figure]}${goal.by ? ` by ${goal.by}` : ''}` : `${moneyFigureLabels[goal.figure]} of $${(goal.amount ?? 0).toLocaleString('en-US')}${goal.by ? ` by ${goal.by}` : ''}`
    const pace = standing.expected === undefined ? '' : `; should be at $${Math.round(standing.expected).toLocaleString('en-US')} today`
    lines.push(`- goal "${goal.title}" (${aim}): ${standingText(standing)}${pace}`)
  }
  return lines
}

export const moneyReadPrompt = [
  'These are screenshots of one person\'s own bank, loan, investment or net worth screens. Read the numbers off them.',
  'Answer with one JSON object and nothing else: {"figures": {...}, "accounts": [{"name": string, "balance": number}]}.',
  `figures may hold any of: ${MONEY_FIGURES.join(', ')}. Plain numbers in dollars, no symbols.`,
  'netWorth is assets minus debts and only when a screen states it. savings is cash in checking and savings added together. investments is brokerage and retirement balances added together. homeRemaining, carRemaining and otherDebt are what is still owed, as positive numbers. incomeMonthly and spendingMonthly only when a screen shows a monthly total.',
  'Leave out any figure the screenshots do not show. Never guess or work one out from partial information.',
  'accounts lists each account shown, named as on screen without account numbers; debts as negative balances.',
].join('\n')

/** The model's answer to `moneyReadPrompt`, or nothing when it is not the JSON asked for. */
export function parseMoneyRead(text: string): { figures: Partial<Record<MoneyFigure, number>>; accounts: MoneyAccount[] } | undefined {
  const from = text.indexOf('{')
  const to = text.lastIndexOf('}')
  if (from < 0 || to <= from) return undefined
  try {
    const value = JSON.parse(text.slice(from, to + 1)) as { figures?: Record<string, unknown>; accounts?: unknown } | null
    if (!value || typeof value !== 'object') return undefined
    const figures: Partial<Record<MoneyFigure, number>> = {}
    for (const figure of MONEY_FIGURES) {
      const amount = value.figures?.[figure]
      if (isAmount(amount)) figures[figure] = figure === 'netWorth' ? amount : Math.abs(amount)
    }
    const accounts = (Array.isArray(value.accounts) ? value.accounts : [])
      .filter((item): item is MoneyAccount => !!item && typeof (item as MoneyAccount).name === 'string' && isAmount((item as MoneyAccount).balance))
      .map((item) => ({ name: item.name.trim().slice(0, 60), balance: item.balance }))
      .filter((item) => item.name)
      .slice(0, 40)
    return { figures, accounts }
  } catch {
    return undefined
  }
}
