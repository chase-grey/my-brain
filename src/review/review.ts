import type { Domain } from '../domain/types'
import { GitHubError, type VaultStore } from '../companion/githubVault'
import type { Stat } from './facts'
import { periodOf, reviewKinds, type Period, type ReviewKind } from './period'

export type Question = { text: string; answer?: string; answeredOn?: string }

/** One period's recap. `stats` and `next` are counted by the app; the rest is written by a model, and only when `written`. */
export type Review = {
  kind: ReviewKind
  key: string
  generatedAt: string
  written: boolean
  model?: string
  stats: Stat[]
  next: string[]
  earned: string[]
  truths: string[]
  questions: Question[]
}

export interface ReviewStore {
  load(kind: ReviewKind, key: string): Promise<Review | undefined>
  save(review: Review): Promise<void>
}

/** How many of each kind a device keeps. The vault keeps every one as a note. */
export const keepReviews: Record<ReviewKind, number> = { week: 60, month: 30, year: 20 }

const id = (kind: ReviewKind, key: string) => `${kind}:${key}`
const storageKey = (domain: Domain) => `my-brain.${domain}.reviews.v1`

export function pruneReviews(reviews: Record<string, Review>): Record<string, Review> {
  const kept: Record<string, Review> = {}
  for (const kind of reviewKinds) {
    const newest = Object.values(reviews).filter((review) => review.kind === kind).sort((a, b) => b.key.localeCompare(a.key)).slice(0, keepReviews[kind])
    for (const review of newest) kept[id(review.kind, review.key)] = review
  }
  return kept
}

export function localReviewStore(domain: Domain): ReviewStore {
  const read = (): Record<string, Review> => {
    try {
      return JSON.parse(localStorage.getItem(storageKey(domain)) ?? '{}') as Record<string, Review>
    } catch {
      return {}
    }
  }
  return {
    load: async (kind, key) => read()[id(kind, key)],
    save: async (review) => {
      try {
        localStorage.setItem(storageKey(domain), JSON.stringify(pruneReviews({ ...read(), [id(review.kind, review.key)]: review })))
      } catch {
        // The review on screen stays usable.
      }
    },
  }
}

export function reviewPath(kind: ReviewKind, key: string): string {
  return `reviews/${kind}/${key}.md`
}

export function reviewTitle(period: Period): string {
  return period.kind === 'week' ? period.label : `${period.label} in review`
}

const bullets = (items: string[]) => items.map((item) => `- ${item.replace(/\s+/g, ' ').trim()}`)

/** The review as a note: readable in the vault, and read back as the record of what was asked and answered. */
export function renderReview(review: Review): string {
  const lines = [
    '---', `kind: ${review.kind}`, `period: ${review.key}`, `generated: ${review.generatedAt}`, ...(review.model ? [`model: ${review.model}`] : []), '---', '',
    `# ${reviewTitle(periodOf(review.kind, review.key))}`, '',
    '## numbers', ...review.stats.map((stat) => `- ${stat.label}: ${stat.value}`), '',
    '## earned', ...bullets(review.earned), '',
    '## hard truths', ...bullets(review.truths), '',
    '## questions',
    ...review.questions.flatMap((question) => [`### ${question.text.replace(/\s+/g, ' ').trim()}`, ...(question.answer ? [question.answer.trim(), ...(question.answeredOn ? ['', `answered ${question.answeredOn}`] : [])] : []), '']),
    '## next up', ...bullets(review.next), '',
  ]
  return lines.join('\n')
}

export function parseReview(content: string): Review | undefined {
  const text = content.replace(/\r\n/g, '\n')
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!front) return undefined
  const meta = Object.fromEntries(front[1].split('\n').map((line) => [line.slice(0, line.indexOf(':')).trim(), line.slice(line.indexOf(':') + 1).trim()]))
  const kind = meta.kind as ReviewKind
  if (!reviewKinds.includes(kind) || !meta.period) return undefined
  const sections = new Map<string, string>()
  for (const part of text.slice(front[0].length).split(/^## /m).slice(1)) {
    const end = part.indexOf('\n')
    sections.set(part.slice(0, end < 0 ? undefined : end).trim(), end < 0 ? '' : part.slice(end + 1))
  }
  const list = (name: string) => (sections.get(name) ?? '').split('\n').filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim())
  const questions = (sections.get('questions') ?? '').split(/^### /m).slice(1).map((part): Question => {
    const [head, ...rest] = part.split('\n')
    const body = rest.join('\n').trim()
    const dated = /\n*answered (\d{4}-\d{2}-\d{2})$/.exec(body)
    const answer = (dated ? body.slice(0, dated.index) : body).trim()
    return { text: head.trim(), ...(answer ? { answer } : {}), ...(dated ? { answeredOn: dated[1] } : {}) }
  })
  return {
    kind, key: meta.period, generatedAt: meta.generated ?? '', written: true, ...(meta.model ? { model: meta.model } : {}),
    stats: list('numbers').map((line) => ({ label: line.slice(0, line.indexOf(':')).trim(), value: line.slice(line.indexOf(':') + 1).trim() })),
    next: list('next up'), earned: list('earned'), truths: list('hard truths'), questions,
  }
}

/** The vault is the record every device shares; the local copy answers when the vault cannot. */
export function vaultReviewStore(vault: VaultStore, local: ReviewStore): ReviewStore {
  return {
    async load(kind, key) {
      try {
        return parseReview((await vault.readNote(reviewPath(kind, key))).content) ?? await local.load(kind, key)
      } catch (error) {
        const cached = await local.load(kind, key)
        // Written on this device but never reached the vault: send it again.
        if (error instanceof GitHubError && error.status === 404) {
          if (cached?.written) void vault.writeNote(reviewPath(kind, key), renderReview(cached)).catch(() => undefined)
          return cached
        }
        if (cached) return cached
        throw error
      }
    },
    async save(review) {
      await local.save(review)
      if (review.written) await vault.writeNote(reviewPath(review.kind, review.key), renderReview(review))
    },
  }
}
