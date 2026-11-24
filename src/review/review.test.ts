import { describe, expect, it, vi } from 'vitest'
import type { ChatClient, MessagesRequest, MessagesResponse } from '../companion/anthropicClient'
import { task } from '../domain/fixtures'
import type { Activity, Goal } from '../domain/types'
import { emptyProductState, type ProductState } from '../productState'
import { fakeVault } from '../trips/fakeVault'
import { bumpsBetween, keepBumpDays, trimBumps, type Bump } from './bumpLog'
import { digestPath, loadDigest, maxDigestsPerRun, parseDigest, renderDigest } from './digest'
import { buildFacts, hasActivity } from './facts'
import { lastCompleted, owedReviews, partsOf, periodOf, seedMarkers } from './period'
import { briefText, createBridgeReviewer, createKeyReviewer, draftLimits, maxJournalReads, parseDraft, reviewPrompt, type Brief } from './reviewer'
import { keepReviews, parseReview, pruneReviews, renderReview, reviewPath, vaultReviewStore, type Review, type ReviewStore } from './review'
import { answerQuestion, runReview } from './runReview'

const week = periodOf('week', '2026-11-16')
const done = (id: string, day: string, extra: Partial<Activity> = {}): Activity => ({ id, domain: 'personal', kind: 'task-completed', taskId: id, occurredAt: `${day}T15:00:00.000Z`, estimateDeltaMin: 30, ...extra })
const goal = (overrides: Partial<Goal> = {}): Goal => ({ id: 'goal-1', domain: 'personal', horizon: 'season', title: 'finish the deck', funded: true, status: 'active', revisions: [], ...overrides })
const state = (overrides: Partial<ProductState> = {}): ProductState => ({ ...emptyProductState, habits: [], ...overrides })

function memoryStore(initial: Review[] = []): ReviewStore & { saved: Review[] } {
  const reviews = new Map(initial.map((review) => [`${review.kind}:${review.key}`, review]))
  const saved: Review[] = []
  return { saved, load: async (kind, key) => reviews.get(`${kind}:${key}`), save: async (review) => { reviews.set(`${review.kind}:${review.key}`, review); saved.push(review) } }
}

const written = (kind: Review['kind'], key: string, extra: Partial<Review> = {}): Review => ({ kind, key, generatedAt: '2026-11-23T08:00:00.000Z', written: true, stats: [], next: [], earned: [], truths: ['you pushed the deck twice'], questions: [{ text: 'what is the deck waiting on?' }], ...extra })

/** A model that answers each call with the next scripted reply and remembers what it was asked. */
function scripted(replies: MessagesResponse['content'][]): ChatClient & { requests: MessagesRequest[] } {
  const requests: MessagesRequest[] = []
  return { requests, createMessage: async (request) => { requests.push(structuredClone(request)); const content = replies.shift() ?? []; return { id: 'm', content, stop_reason: content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn' } } }
}
const handIn = (input: Record<string, unknown>): MessagesResponse['content'] => [{ type: 'tool_use', id: 'w', name: 'write_review', input }]
const draft = { earned: ['you met the weekly target'], truths: ['you pushed the deck twice'], questions: ['what is the deck waiting on?'] }

describe('periods', () => {
  it('looks back at the week, month, and year that just ended', () => {
    expect(lastCompleted('week', '2026-11-23')).toMatchObject({ key: '2026-11-16', start: '2026-11-16', end: '2026-11-23', label: 'week of nov 16' })
    expect(lastCompleted('week', '2026-11-29').key).toBe('2026-11-16')
    expect(lastCompleted('month', '2027-01-04')).toMatchObject({ key: '2026-12', start: '2026-12-01', end: '2027-01-01', label: 'december 2026' })
    expect(lastCompleted('year', '2027-01-04')).toMatchObject({ key: '2026', end: '2027-01-01' })
  })

  it('builds a month from the weeks that start in it and a year from its months', () => {
    expect(partsOf(periodOf('month', '2026-11')).map((part) => part.key)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
    expect(partsOf(periodOf('year', '2026')).map((part) => part.key)).toHaveLength(12)
    expect(partsOf(week)).toEqual([])
  })

  it('owes nothing on the first run, then each review once its period has ended', () => {
    const seeded = seedMarkers({}, '2026-11-24')
    expect(owedReviews({}, '2026-11-24')).toEqual([])
    expect(owedReviews(seeded, '2026-11-29')).toEqual([])
    expect(owedReviews(seeded, '2026-11-30').map((period) => period.kind)).toEqual(['week'])
    expect(owedReviews(seeded, '2027-01-04').map((period) => period.kind)).toEqual(['year', 'month', 'week'])
    expect(owedReviews({ ...seeded, week: '2026-11-23' }, '2026-11-30')).toEqual([])
  })
})

describe('bump log', () => {
  const today = '2026-11-18'
  it('counts a day pushed later or dropped once it has come, and nothing else', () => {
    const before = [
      task({ id: 'later', planDate: '2026-11-18' }), task({ id: 'due', dueDate: '2026-11-18' }), task({ id: 'dropped', planDate: '2026-11-17' }),
      task({ id: 'earlier', planDate: '2026-11-20' }), task({ id: 'cleared-early', planDate: '2026-11-25' }), task({ id: 'finished', planDate: '2026-11-18' }),
      task({ id: 'routine', planDate: '2026-11-18', recurrence: 'daily' }), task({ id: 'same', planDate: '2026-11-18' }),
    ]
    const after = [
      task({ id: 'later', planDate: '2026-11-19' }), task({ id: 'due', dueDate: '2026-11-25' }), task({ id: 'dropped' }),
      task({ id: 'earlier', planDate: '2026-11-19' }), task({ id: 'cleared-early' }), task({ id: 'finished', planDate: '2026-11-19', completed: true }),
      task({ id: 'routine', planDate: '2026-11-19', recurrence: 'daily' }), task({ id: 'same', planDate: '2026-11-18' }), task({ id: 'new', planDate: '2026-11-30' }),
    ]
    expect(bumpsBetween(before, after, today).map((bump) => bump.taskId)).toEqual(['later', 'due', 'dropped'])
    expect(bumpsBetween(before, after, today)[0]).toEqual({ taskId: 'later', title: 'Default task', on: today, from: '2026-11-18', to: '2026-11-19' })
  })

  it('lets old bumps leave', () => {
    const bumps: Bump[] = Array.from({ length: keepBumpDays + 200 }, (_, index) => ({ taskId: 't', title: 't', on: new Date(Date.UTC(2024, 0, 1 + index)).toISOString().slice(0, 10), from: 'x' }))
    const kept = trimBumps(bumps, bumps.at(-1)!.on)
    expect(kept).toHaveLength(keepBumpDays + 1)
    expect(kept.at(-1)).toBe(bumps.at(-1))
  })
})

describe('facts', () => {
  const bumps: Bump[] = [
    { taskId: 'deck', title: 'draft the deck', on: '2026-11-10', from: '2026-11-10', to: '2026-11-17' },
    { taskId: 'deck', title: 'draft the deck', on: '2026-11-17', from: '2026-11-17', to: '2026-11-19' },
    { taskId: 'deck', title: 'draft the deck', on: '2026-11-19', from: '2026-11-19', to: '2026-11-24' },
    { taskId: 'taxes', title: 'file taxes', on: '2026-11-20', from: '2026-11-20' },
  ]
  const tasks = [task({ id: 'deck', title: 'draft the deck', dueDate: '2026-11-24' }), task({ id: 'taxes', title: 'file taxes', dueDate: '2026-11-12' }), task({ id: 'call', title: 'call the bank', dueDate: '2026-11-26' })]
  const product = state({
    activities: [done('a', '2026-11-17', { projectId: 'p' }), done('b', '2026-11-18'), done('c', '2026-11-20'), done('old', '2026-11-11'), { id: 'seen', domain: 'personal', kind: 'connection', occurredAt: '2026-11-21T18:00:00.000Z', withPeople: ['Sam'] }],
    goals: [goal({ hoursCommitted: 40, committedOn: '2026-10-01', targetDate: '2026-12-31', revisions: [{ on: '2026-11-19', field: 'date', from: '2026-11-30', to: '2026-12-31' }] })],
    projects: [{ id: 'p', domain: 'personal', goalId: 'goal-1', title: 'deck', status: 'active', rhythm: 'pace', drive: 'intrinsic', mode: 'deep' }],
    commitments: [{ weekStart: '2026-11-16', domain: 'personal', targetMin: 300, strategicMin: 0, habitDaysRequired: 0, maintenance: [], halfTargetMin: 150, ceilingMin: 600 }],
    ringCommitments: [{ domain: 'body', commitment28: 8 }],
    ringEvidence: [{ domain: 'body', on: '2026-11-18', value: 1 }],
    habits: [{ id: 'vitamins', domain: 'personal', title: 'vitamins', cadence: { unit: 'day', interval: 1 }, estimateMin: 2, startedOn: '2026-09-03', countsTowardStreak: true, timeWindow: 'morning', parts: [{ id: 'multi', title: 'multi', intervalDays: 1 }] }],
    habitEntries: [{ habitId: 'vitamins', date: '2026-11-16', completedPartIds: ['multi'] }, { habitId: 'vitamins', date: '2026-11-17', completedPartIds: ['multi'] }],
  })
  const facts = buildFacts({ domain: 'personal', period: week, today: '2026-11-23', tasks, product, bumps })

  it('sets what was finished against what was bumped', () => {
    expect(facts.stats).toEqual(expect.arrayContaining([{ label: 'done', value: '3' }, { label: 'bumped', value: '2' }, { label: 'finished vs bumped', value: '60%' }, { label: 'weekly target', value: '1.5 of 5h' }, { label: 'habits', value: '29%' }]))
    expect(facts.lines).toContain('tasks finished: 3 (1.5h of estimates); the week before: 1')
    expect(facts.lines).toContain('tasks bumped: 2 (3 times in all)')
    expect(facts.lines).toContain('still open, bumped 3 times since nov 10: "draft the deck"')
    expect(facts.lines).toContain('1 open task past due; oldest "file taxes", due nov 12')
  })

  it('lines the work up with goals, life areas, and habits', () => {
    expect(facts.lines).toContain('season goal "finish the deck": 0.5h this week, 0.5h of 40h overall, behind; date moved from nov 30 to dec 31 on nov 19')
    expect(facts.lines).toContain('life area body (importance 3 of 8): 1 logged against 2 promised')
    expect(facts.lines).toContain('habit "vitamins": 2 of 7 days')
    expect(facts.lines).toContain('weekly target: cleared 1.5h of 5h (3.5h short)')
    expect(facts.lines).toContain('people seen: 1')
  })

  it('reads the body area from workout-tracker when it has a summary, not from a target', () => {
    const bodyTracker = { v: 1 as const, asOf: '2026-11-22', streak: 11, freezes: 4, weeksTracked: 16, weeks: [{ week: '2026-11-09', result: 'hit' as const }, { week: '2026-11-16', result: 'hit' as const }], goals: { open: 3, onPace: 3, met: 0 } }
    const tracked = buildFacts({ domain: 'personal', period: week, today: '2026-11-23', tasks, product: { ...product, bodyTracker }, bumps })
    expect(tracked.lines).toContain('life area body (importance 3 of 8): 1 of 1 weeks hit every training goal, 11 week streak, 3 of 3 committed goals on pace')
    expect(tracked.lines.some((line) => line.includes('logged against'))).toBe(false)
    const later = buildFacts({ domain: 'personal', period: week, today: '2026-11-23', tasks, product: { ...product, bodyTracker: { ...bodyTracker, asOf: '2026-12-01' } }, bumps })
    expect(later.lines).toContain('life area body (importance 3 of 8): 1 of 1 weeks hit every training goal')
  })

  it('says what the coming week already holds', () => {
    expect(facts.next).toEqual(['finish the deck · 22.8h behind', 'draft the deck · due nov 24', 'call the bank · due nov 26'])
  })

  it('keeps the other space out and knows an empty period', () => {
    const work = buildFacts({ domain: 'work', period: week, today: '2026-11-23', tasks, product, bumps: [] })
    expect(work.stats).toEqual([{ label: 'done', value: '0' }, { label: 'bumped', value: '0' }])
    expect(work.lines.join('\n')).not.toMatch(/people seen|finish the deck/)
    expect(hasActivity({ domain: 'personal', period: week, today: '2026-11-23', tasks, product, bumps: [] })).toBe(true)
    expect(hasActivity({ domain: 'personal', period: periodOf('week', '2026-08-03'), today: '2026-11-23', tasks, product: state(), bumps })).toBe(false)
  })
})

describe('review notes', () => {
  const review = written('week', '2026-11-16', { model: 'claude-sonnet-5-5', stats: [{ label: 'done', value: '3' }], next: ['draft the deck · due nov 24'], earned: [], questions: [{ text: 'what is the deck waiting on?', answer: 'me.\n\nI keep opening it and closing it.', answeredOn: '2026-11-23' }, { text: 'who did you not call?' }] })

  it('reads back exactly what it wrote, answers included', () => {
    expect(parseReview(renderReview(review))).toEqual(review)
    expect(parseReview(renderReview(review).replace(/\n/g, '\r\n'))).toEqual(review)
    expect(reviewPath('week', '2026-11-16')).toBe('reviews/week/2026-11-16.md')
    expect(parseReview('# not a review')).toBeUndefined()
  })

  it('keeps a bounded number on the device', () => {
    const many = Object.fromEntries(Array.from({ length: keepReviews.week + 25 }, (_, index) => { const key = new Date(Date.UTC(2024, 0, 1 + index * 7)).toISOString().slice(0, 10); return [`week:${key}`, written('week', key)] }))
    const kept = pruneReviews({ ...many, 'year:2026': written('year', '2026') })
    expect(Object.keys(kept).filter((key) => key.startsWith('week:'))).toHaveLength(keepReviews.week)
    expect(kept['year:2026']).toBeDefined()
    expect(Object.keys(kept)).toContain(Object.keys(many).at(-1))
  })

  it('shares reviews through the vault and falls back to the device', async () => {
    const vault = fakeVault()
    const local = memoryStore()
    const store = vaultReviewStore(vault, local)
    await store.save(review)
    expect(vault.notes['reviews/week/2026-11-16.md']).toContain('## hard truths')
    expect(await vaultReviewStore(vault, memoryStore()).load('week', '2026-11-16')).toEqual(review)
    vault.offline = true
    expect(await store.load('week', '2026-11-16')).toEqual(review)
    await expect(vaultReviewStore(vault, memoryStore()).load('week', '2026-11-16')).rejects.toThrow()
  })
})

describe('journal digest', () => {
  const long = (text: string) => `${text} `.repeat(40)
  const reply = (line: string): MessagesResponse['content'] => [{ type: 'text', text: `LINE: ${line}\nSUMMARY: longer, with "a quote".` }]

  it('reads each entry once, in two sizes, and never again until it changes', async () => {
    const vault = fakeVault({ 'journal/2026-11-17.md': long('I will start the deck monday.'), 'journal/2026-11-19.md': 'short one', 'journal/2026-11-05.md': long('before the week.'), 'notes/other.md': 'x' })
    const client = scripted([reply('said the deck starts monday')])
    const first = await loadDigest({ vault, client, model: 'claude-haiku-5-5', range: { start: '2026-10-26', end: '2026-11-23' }, fresh: week })
    expect(first).toEqual([
      { date: '2026-11-17', sha: 'sha', line: 'said the deck starts monday', summary: 'longer, with "a quote".' },
      { date: '2026-11-19', sha: 'sha', line: 'short one', summary: 'short one' },
    ])
    expect(client.requests).toHaveLength(1)
    expect(client.requests[0]).toMatchObject({ model: 'claude-haiku-5-5', max_tokens: 400 })
    expect(parseDigest(vault.notes[digestPath('2026-11')])).toEqual(first)

    const again = scripted([])
    expect(await loadDigest({ vault, client: again, model: 'm', range: week, fresh: week })).toEqual(first)
    expect(again.requests).toHaveLength(0)
  })

  it('stops paying after a fixed number of entries in one run', async () => {
    const notes = Object.fromEntries(Array.from({ length: maxDigestsPerRun + 5 }, (_, index) => [`journal/2026-${String(1 + Math.floor(index / 28)).padStart(2, '0')}-${String(1 + index % 28).padStart(2, '0')}.md`, long('entry')]))
    const client = scripted(Array.from({ length: maxDigestsPerRun + 5 }, () => reply('line')))
    const year = periodOf('year', '2026')
    expect(await loadDigest({ vault: fakeVault(notes), client, model: 'm', range: year, fresh: year })).toHaveLength(maxDigestsPerRun)
    expect(client.requests).toHaveLength(maxDigestsPerRun)
  })

  it('round-trips the digest file', () => {
    const entries = [{ date: '2026-11-17', sha: 'abc', line: 'one line', summary: 'two\n\nparagraphs' }, { date: '2026-11-02', sha: 'def', line: 'earlier', summary: 'earlier summary' }]
    expect(parseDigest(renderDigest(entries))).toEqual([entries[1], entries[0]])
  })
})

describe('writing the review', () => {
  const facts = { stats: [], lines: ['tasks finished: 3', 'tasks bumped: 2 (3 times in all)'], next: ['draft the deck · due nov 24'] }
  const journal = [{ date: '2026-11-10', sha: 's', line: 'said the deck starts monday', summary: 'the fuller one from the tenth' }, { date: '2026-11-17', sha: 's', line: 'said it again', summary: 'the fuller one from the seventeenth' }]
  const brief: Brief = { period: week, facts, journal, previous: written('week', '2026-11-09', { questions: [{ text: 'what is the deck waiting on?' }, { text: 'why skip the gym?', answer: 'tired', answeredOn: '2026-11-16' }] }), parts: [] }

  it('holds the rules: evidence for every line, praise only when earned, no soft questions', () => {
    for (const kind of ['week', 'month', 'year'] as const) {
      const prompt = reviewPrompt(kind, 'Sam')
      expect(prompt).toContain('Every statement must rest on a number or a dated quote in the evidence')
      expect(prompt).toContain('praise only for what the numbers show was done')
      expect(prompt).toContain('An empty list is a correct answer')
      expect(prompt).toContain('Never praise effort, intent, or awareness')
      expect(prompt).toContain('No softening, no advice')
      expect(prompt).toContain('never yes or no')
      expect(prompt).toContain('the way a blunt friend would say it out loud')
      expect(prompt).toContain('never copy its wording')
      expect(prompt).toContain('never 2026-11-10')
      expect(prompt).toContain('Do not mention the evidence')
      expect(prompt).toContain(`at most ${draftLimits[kind].truths}`)
    }
  })

  it('gives the model counted facts and one line per journal entry, never the entries', () => {
    const text = briefText(brief)
    expect(text).toContain('period: week of nov 16 (2026-11-16 to 2026-11-22)')
    expect(text).toContain('- tasks bumped: 2 (3 times in all)')
    expect(text).toContain('- 2026-11-10 (before this period): said the deck starts monday')
    expect(text).toContain('- asked: what is the deck waiting on? | not answered')
    expect(text).toContain('- asked: why skip the gym? | answered 2026-11-16: tired')
    expect(text).not.toContain('the fuller one')
    expect(text.length).toBeLessThan(1200)
  })

  it('opens a fuller journal summary on request, a fixed number of times, then takes the review', async () => {
    const read = (id: string, date: string): MessagesResponse['content'] => [{ type: 'tool_use', id, name: 'read_journal', input: { date } }]
    const client = scripted([read('1', '2026-11-10'), read('2', '2026-11-17'), read('3', '2026-01-01'), read('4', '2026-11-10'), handIn(draft)])
    const result = await createKeyReviewer({ client, model: () => 'claude-sonnet-5-5', effort: () => 'medium', name: 'Sam' }).write(brief)
    expect(result).toEqual({ draft, model: 'claude-sonnet-5-5' })
    expect(client.requests).toHaveLength(maxJournalReads + 2)
    expect(client.requests[0]).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 1200, output_config: { effort: 'medium' } })
    expect(client.requests[0].tools?.map((tool) => tool.name)).toEqual(['read_journal', 'write_review'])
    expect(client.requests[3].tools?.map((tool) => tool.name)).toEqual(['write_review'])
    expect(JSON.stringify(client.requests[1].messages.at(-1))).toContain('the fuller one from the tenth')
    expect(JSON.stringify(client.requests[3].messages.at(-1))).toContain('no journal entry on that date')
    expect(JSON.stringify(client.requests[4].messages.at(-1))).toContain('no more reads')
  })

  it('caps what comes back and fails loudly on nothing', async () => {
    expect(parseDraft({ earned: ['a', 'b', 'c', 'd', 'e', 'f'], truths: ['  spaced\n out  ', 7, ''], questions: [] }, 'week')).toEqual({ earned: ['a', 'b', 'c'], truths: ['spaced out'], questions: [] })
    expect(parseDraft('here you go: {"earned": [], "truths": ["t"], "questions": ["q"]} done', 'week')).toEqual({ earned: [], truths: ['t'], questions: ['q'] })
    expect(parseDraft('no json here', 'week')).toBeUndefined()
    expect(parseDraft({ earned: [], truths: [], questions: [] }, 'week')).toBeUndefined()
    await expect(createKeyReviewer({ client: scripted([[{ type: 'text', text: 'sorry' }]]), model: () => 'm' }).write(brief)).rejects.toThrow('the review came back empty')
  })

  it('writes the work review through claude code on the bridge, which reads the vault itself', async () => {
    const chat = vi.fn(async () => ({ text: `\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``, sessionId: 's', isError: false }))
    expect(await createBridgeReviewer({ client: { chat } }).write(brief)).toEqual({ draft, model: 'sonnet' })
    const request = chat.mock.calls[0][0 as never] as { text: string; systemPrompt: string; model: string; sessionId?: string }
    expect(request.sessionId).toBeUndefined()
    expect(request.systemPrompt).toContain('praise only for what the numbers show was done')
    expect(request.systemPrompt).toContain('line up what was finished against what was carried and against the goals')
    expect(request.systemPrompt).toContain('edit no file')
    const month = { ...brief, period: periodOf('month', '2026-11'), parts: [written('week', '2026-11-16')] }
    await createBridgeReviewer({ client: { chat } }).write(month)
    const second = chat.mock.calls[1][0 as never] as { systemPrompt: string; model: string }
    expect(second.model).toBe('opus')
    expect(second.systemPrompt).toContain('open a daily note only to check something a review below says')
    await expect(createBridgeReviewer({ client: { chat: async () => ({ text: 'bridge broke', sessionId: '', isError: true }) } }).write(brief)).rejects.toThrow('bridge broke')
  })
})

describe('running a review', () => {
  const base = { domain: 'personal' as const, today: '2026-11-23', tasks: [], product: state({ activities: [done('a', '2026-11-17')] }), bumps: [], now: () => '2026-11-23T08:00:00.000Z' }
  const reviewer = (seen: Brief[] = []) => ({ seen, write: async (brief: Brief) => { seen.push(brief); return { draft, model: 'claude-sonnet-5-5' } } })

  it('writes once, saves, and never pays twice for the same period', async () => {
    const store = memoryStore()
    const writer = reviewer()
    const first = await runReview({ ...base, period: week, store, reviewer: writer })
    expect(first).toMatchObject({ kind: 'week', key: '2026-11-16', written: true, model: 'claude-sonnet-5-5', earned: draft.earned, questions: [{ text: 'what is the deck waiting on?' }], stats: [{ label: 'done', value: '1' }, { label: 'bumped', value: '0' }, { label: 'finished vs bumped', value: '100%' }] })
    expect(await runReview({ ...base, period: week, store, reviewer: writer })).toEqual(first)
    expect(writer.seen).toHaveLength(1)
  })

  it('shows the counted half and saves nothing when there is no ai', async () => {
    const store = memoryStore()
    expect(await runReview({ ...base, period: week, store })).toMatchObject({ written: false, earned: [], truths: [], questions: [], stats: [{ label: 'done', value: '1' }, { label: 'bumped', value: '0' }, { label: 'finished vs bumped', value: '100%' }] })
    expect(store.saved).toEqual([])
  })

  it('gives a week the journal lines of the three weeks before it and last week’s questions', async () => {
    const journal = vi.fn(async () => [])
    const writer = reviewer()
    const last = written('week', '2026-11-09')
    await runReview({ ...base, period: week, store: memoryStore([last]), reviewer: writer, journal })
    expect(journal).toHaveBeenCalledWith({ start: '2026-10-26', end: '2026-11-23' }, week)
    expect(writer.seen[0].previous).toEqual(last)
  })

  it('builds a month from its weeks and a year from its months, without rereading the journal for a year', async () => {
    const journal = vi.fn(async () => [])
    const writer = reviewer()
    const month = periodOf('month', '2026-11')
    await runReview({ ...base, today: '2026-12-01', period: month, store: memoryStore([written('week', '2026-11-09'), written('week', '2026-11-16'), written('week', '2026-10-26')]), reviewer: writer, journal })
    expect(writer.seen[0].parts.map((part) => part.key)).toEqual(['2026-11-09', '2026-11-16'])
    expect(journal).toHaveBeenCalledWith({ start: '2026-11-01', end: '2026-12-01' }, month)
    await runReview({ ...base, today: '2027-01-04', period: periodOf('year', '2026'), store: memoryStore([written('month', '2026-11'), written('month', '2026-12')]), reviewer: writer, journal })
    expect(writer.seen[1].parts.map((part) => part.key)).toEqual(['2026-11', '2026-12'])
    expect(journal).toHaveBeenCalledTimes(1)
  })

  it('still writes when the journal cannot be read, and keeps a written review whose save failed', async () => {
    const store = { load: async () => undefined, save: async () => { throw new Error('vault down') } }
    const review = await runReview({ ...base, period: week, store, reviewer: reviewer(), journal: async () => { throw new Error('offline') } })
    expect(review.written).toBe(true)
  })

  it('saves an answer with its date, and clears it when emptied', async () => {
    const store = memoryStore()
    const review = written('week', '2026-11-16')
    const answered = await answerQuestion(store, review, 0, '  me  ', '2026-11-24')
    expect(answered.questions[0]).toEqual({ text: 'what is the deck waiting on?', answer: 'me', answeredOn: '2026-11-24' })
    expect(store.saved).toEqual([answered])
    expect((await answerQuestion(store, answered, 0, ' ', '2026-11-25')).questions[0]).toEqual({ text: 'what is the deck waiting on?' })
  })
})
