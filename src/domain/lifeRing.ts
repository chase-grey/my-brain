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
}

const RING_DOMAINS: LifeDomain[] = ['body', 'purpose', 'connection', 'build', 'mind', 'creativity', 'money', 'rest']

function median(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function buildLifeRing(evidence: RingEvidence[], commitments: RingCommitment[], today: string): RingArc[] {
  const todayMs = new Date(`${today}T00:00:00Z`).getTime()
  return RING_DOMAINS.map((domain) => {
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
