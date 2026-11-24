import type { DigestEntry } from './digest'
import { buildFacts, type FactsInput } from './facts'
import { addDays, partsOf, previousPeriod, type Period } from './period'
import type { Reviewer } from './reviewer'
import type { Review, ReviewStore } from './review'

/** How far back a week's review sees journal lines, so "said the same thing three weeks running" is visible. */
export const journalLookbackDays = 21

export type ReviewDeps = Omit<FactsInput, 'period'> & {
  period: Period
  store: ReviewStore
  /** Absent when there is no ai to ask: the review is then the counted half only, and is not saved. */
  reviewer?: Reviewer
  /** Journal digests for a range, reading new entries only inside `fresh`. Absent without a vault. */
  journal?: (range: Pick<Period, 'start' | 'end'>, fresh: Pick<Period, 'start' | 'end'>) => Promise<DigestEntry[]>
  now?: () => string
}

/** The counted half, free and instant. */
export function countedReview(deps: ReviewDeps): Review {
  const facts = buildFacts(deps)
  return { kind: deps.period.kind, key: deps.period.key, generatedAt: (deps.now ?? (() => new Date().toISOString()))(), written: false, stats: facts.stats, next: facts.next, earned: [], truths: [], questions: [] }
}

/**
 * The review for a period: the saved one when it exists, otherwise counted, written once, and saved.
 * A year reads its months and a month reads its weeks, so no review rereads what a smaller one already covered.
 */
export async function runReview(deps: ReviewDeps): Promise<Review> {
  const { period, store, reviewer } = deps
  const saved = await store.load(period.kind, period.key)
  if (saved?.written) return saved
  const counted = countedReview(deps)
  if (!reviewer) return counted

  const before = previousPeriod(period)
  const [previous, parts] = await Promise.all([
    store.load(before.kind, before.key),
    Promise.all(partsOf(period).map((part) => store.load(part.kind, part.key))),
  ])
  const written = parts.filter((part): part is Review => Boolean(part?.written))
  // A year stands on its months alone. A week also sees the lines of the three weeks before it.
  const journal = period.kind === 'year' || !deps.journal ? []
    : await deps.journal({ start: period.kind === 'week' ? addDays(period.start, -journalLookbackDays) : period.start, end: period.end }, period).catch(() => [])

  const facts = buildFacts(deps)
  const { draft, model } = await reviewer.write({ period, facts, journal, previous: previous?.written ? previous : undefined, parts: written })
  const review: Review = { ...counted, written: true, ...(model ? { model } : {}), earned: draft.earned, truths: draft.truths, questions: draft.questions.map((text) => ({ text })) }
  // Already paid for: a failed save must not lose it. The store keeps a local copy and pushes it again on the next load.
  await store.save(review).catch(() => undefined)
  return review
}

export async function answerQuestion(store: ReviewStore, review: Review, index: number, answer: string, today: string): Promise<Review> {
  const text = answer.trim()
  const questions = review.questions.map((question, at) => at !== index ? question : text ? { text: question.text, answer: text, answeredOn: today } : { text: question.text })
  const next = { ...review, questions }
  await store.save(next)
  return next
}
