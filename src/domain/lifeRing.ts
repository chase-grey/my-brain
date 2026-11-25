import { isCheckArea, type AreaReading, type CheckArea } from './areas'
import type { BodyReading } from './bodyTracker'
import type { MoneyReading } from './money'
import type { RestReading } from './rest'
import type { LifeDomain } from './types'

export type RingEvidence = {
  domain: LifeDomain
  on: string
  value: number
}

export type RingCommitment = {
  domain: LifeDomain
  commitment28: number
}

export type RingArc = {
  domain: LifeDomain
  fill?: number
  drift?: number
  state: 'unknown' | 'dormant' | 'establishing' | 'early-signal' | 'ready'
  focus: boolean
  /** Set on the body slice when workout-tracker is the source: the slice reads this, not a 28-day target. */
  tracker?: BodyReading
  /** Set on the money slice when money goals are set: the slice reads how they stand. */
  money?: MoneyReading
  /** Set on the rest slice when the phone's sleep or screen time has a goal to be read against. */
  rest?: RestReading
  /** Set on purpose, connection, mind, creativity and projects: the slice reads the answers and challenges there. */
  area?: AreaReading
  /** An answer is due again: the slice keeps its last fill and dims. */
  stale?: boolean
}

// Chase's order, 2026-11-24. Lists read it top to bottom; the wheel runs it clockwise starting at 9 o'clock.
export const RING_DOMAINS: LifeDomain[] = ['purpose', 'connection', 'body', 'mind', 'creativity', 'projects', 'money', 'rest']

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Areas in `off` are left out of the ring altogether. With `body`, the body slice is workout-tracker's reading and needs no target;
 * money with goals and rest with phone readings work the same way. With `areas`, the five areas judged by answers
 * read those and never a 28-day target.
 */
export function buildLifeRing(evidence: RingEvidence[], commitments: RingCommitment[], today: string, off: LifeDomain[] = [], body?: BodyReading, more: { money?: MoneyReading; rest?: RestReading; areas?: Record<CheckArea, AreaReading> } = {}): RingArc[] {
  const todayMs = new Date(`${today}T00:00:00Z`).getTime()
  return RING_DOMAINS.filter((domain) => !off.includes(domain)).map((domain) => {
    if (domain === 'body' && body) {
      const state = body.weeksTracked < 12 ? 'establishing' : body.weeksTracked < 26 ? 'early-signal' : 'ready'
      return { domain, fill: body.fill, state, focus: false, tracker: body }
    }
    if (domain === 'money' && more.money) {
      const months = more.money.monthsTracked
      return { domain, fill: more.money.fill, state: months < 3 ? 'establishing' : months < 6 ? 'early-signal' : 'ready', focus: false, money: more.money }
    }
    if (domain === 'rest' && more.rest) {
      const days = more.rest.daysTracked
      return { domain, fill: more.rest.fill, state: days < 84 ? 'establishing' : days < 182 ? 'early-signal' : 'ready', focus: false, rest: more.rest }
    }
    if (isCheckArea(domain) && more.areas) {
      const area = more.areas[domain]
      if (area.fill === undefined) return { domain, state: area.things.length ? 'unknown' : 'dormant', focus: false, area }
      return { domain, fill: area.fill, state: 'ready', focus: area.drifting, area, ...(area.due ? { stale: true } : {}) }
    }
    const commitment = commitments.find((item) => item.domain === domain)?.commitment28 ?? 0
    if (commitment === 0) return { domain, state: 'dormant', focus: false }
    const domainEvidence = evidence.filter((item) => item.domain === domain && item.on <= today)
    if (!domainEvidence.length) return { domain, state: 'unknown', focus: false }
    const recent = domainEvidence.filter((item) => todayMs - new Date(`${item.on}T00:00:00Z`).getTime() < 28 * 86_400_000)
    const fill = Math.min(1, recent.reduce((sum, item) => sum + item.value, 0) / commitment)
    const activeWeeks = new Set(domainEvidence.map((item) => {
      const elapsed = Math.floor((todayMs - new Date(`${item.on}T00:00:00Z`).getTime()) / (7 * 86_400_000))
      return elapsed
    })).size
    const state = activeWeeks < (domain === 'creativity' ? 8 : 12) ? 'establishing' : activeWeeks < 26 ? 'early-signal' : 'ready'
    const historical = median(domainEvidence.filter((item) => !recent.includes(item)).map((item) => item.value))
    const drift = historical && historical > 0 ? (fill * commitment - historical) / historical : undefined
    return { domain, fill, drift, state, focus: state !== 'establishing' && drift !== undefined && drift < -0.25 }
  })
}
