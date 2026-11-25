import type { CompanionTurn } from './companionStore'

/** With no verdict on the message, it carries on the thread when the last turn is this recent. */
export const threadIdleMs = 15 * 60_000
/** How sure Jev must be that a message stands on its own before the thread is left behind. A wrong "new" loses what the answer needed; a wrong "carries on" costs a few capped turns. */
export const freshConfidence = 0.6
/** The most earlier conversation sent along with a message, in characters, and the most of any one turn. */
export const contextBudget = 8000
export const turnBudget = 2000

/** Whether a new message carries on the thread it was typed under or starts its own. `follows` is Jev's chance that it carries on. */
export function continuesThread({ turns, follows, pinned = false, now }: { turns: CompanionTurn[]; follows?: number; pinned?: boolean; now: number }): boolean {
  if (!turns.length) return false
  if (pinned) return true
  if (typeof follows === 'number') return follows > 1 - freshConfidence
  const last = Date.parse(turns[turns.length - 1].at)
  return Number.isFinite(last) && now - last <= threadIdleMs
}

/** The recent end of a thread that fits the budget: always the last exchange, long turns cut short, older ones dropped. */
export function contextTurns(turns: CompanionTurn[], budget = contextBudget): CompanionTurn[] {
  const kept: CompanionTurn[] = []
  let used = 0
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]
    const text = turn.text.length > turnBudget ? `${turn.text.slice(0, turnBudget)}…` : turn.text
    const cost = text.length + (turn.actions?.length ?? 0) * 80
    if (kept.length >= 2 && used + cost > budget) break
    used += cost
    kept.unshift(text === turn.text ? turn : { ...turn, text })
  }
  return kept
}
