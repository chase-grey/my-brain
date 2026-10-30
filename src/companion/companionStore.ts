import type { Domain } from '../domain/types'

export type CompanionTurn = { role: 'user' | 'assistant'; text: string; at: string; error?: boolean }
export type CompanionConversation = { version: 1; turns: CompanionTurn[]; sessionId?: string }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const companionStorageKey = (domain: Domain) => `my-brain.${domain}.companion.v1`
export const maxStoredTurns = 40
const empty = (): CompanionConversation => ({ version: 1, turns: [] })

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function loadConversation(domain: Domain, store: StorageLike | undefined = storage()): CompanionConversation {
  try {
    const raw = store?.getItem(companionStorageKey(domain))
    if (!raw) return empty()
    const parsed = JSON.parse(raw) as Partial<CompanionConversation>
    if (parsed.version !== 1 || !Array.isArray(parsed.turns)) return empty()
    return {
      version: 1,
      turns: parsed.turns.filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string'),
      sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
    }
  } catch {
    return empty()
  }
}

export function saveConversation(domain: Domain, conversation: CompanionConversation, store: StorageLike | undefined = storage()): void {
  try {
    store?.setItem(companionStorageKey(domain), JSON.stringify({ ...conversation, turns: conversation.turns.slice(-maxStoredTurns) }))
  } catch {
    // The thread still lives in memory when storage is unavailable.
  }
}

export function clearConversation(domain: Domain, store: StorageLike | undefined = storage()): void {
  try {
    store?.removeItem(companionStorageKey(domain))
  } catch {
    // Nothing to clear.
  }
}
