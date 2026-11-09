import type { Domain } from '../domain/types'
import { newId } from '../format'
import type { CompanionAction } from './actions'

export type CompanionTurn = { role: 'user' | 'assistant'; text: string; at: string; error?: boolean; actions?: CompanionAction[] }
export type CompanionConversation = { version: 1; id: string; turns: CompanionTurn[]; sessionId?: string }
type History = { version: 1; conversations: CompanionConversation[] }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const historyStorageKey = (domain: Domain) => `my-brain.${domain}.companion.history.v1`
// The single-thread key the chat used before it kept a history; read once and folded in.
const legacyStorageKey = (domain: Domain) => `my-brain.${domain}.companion.v1`
export const maxStoredTurns = 40
export const maxStoredConversations = 50

export const newConversation = (): CompanionConversation => ({ version: 1, id: newId('chat'), turns: [] })

// A card still waiting when the page closed cannot be resumed: the model's half of the turn lived only in memory.
function settleAction(action: CompanionAction): CompanionAction {
  return action.status === 'pending' || action.status === 'running' ? { ...action, status: 'expired' } : action
}

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function parseConversation(raw: unknown): CompanionConversation | undefined {
  const parsed = raw as Partial<CompanionConversation> | null
  if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.turns)) return undefined
  const turns = parsed.turns
    .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && typeof turn.text === 'string')
    .map((turn) => Array.isArray(turn.actions) ? { ...turn, actions: turn.actions.map(settleAction) } : turn)
  if (!turns.length) return undefined
  return {
    version: 1,
    id: typeof parsed.id === 'string' && parsed.id ? parsed.id : newId('chat'),
    turns,
    ...(typeof parsed.sessionId === 'string' ? { sessionId: parsed.sessionId } : {}),
  }
}

function readJson(store: StorageLike | undefined, key: string): unknown {
  try {
    const raw = store?.getItem(key)
    return raw ? JSON.parse(raw) : undefined
  } catch {
    return undefined
  }
}

function writeHistory(domain: Domain, conversations: CompanionConversation[], store: StorageLike | undefined): void {
  try {
    const history: History = { version: 1, conversations: conversations.slice(0, maxStoredConversations) }
    store?.setItem(historyStorageKey(domain), JSON.stringify(history))
  } catch {
    // The thread still lives in memory when storage is unavailable.
  }
}

/** Every stored conversation for the space, most recent first. */
export function loadHistory(domain: Domain, store: StorageLike | undefined = storage()): CompanionConversation[] {
  const parsed = readJson(store, historyStorageKey(domain)) as Partial<History> | undefined
  const conversations = Array.isArray(parsed?.conversations)
    ? parsed.conversations.map(parseConversation).filter((item): item is CompanionConversation => Boolean(item))
    : []
  const legacy = parseConversation(readJson(store, legacyStorageKey(domain)))
  if (legacy) {
    conversations.unshift(legacy)
    writeHistory(domain, conversations, store)
    try {
      store?.removeItem(legacyStorageKey(domain))
    } catch {
      // Left behind; it is folded in again next time, under the same id.
    }
  }
  return conversations
}

/** Puts the conversation at the top of the history, replacing any earlier copy. An empty conversation is dropped instead. */
export function saveConversation(domain: Domain, conversation: CompanionConversation, store: StorageLike | undefined = storage()): void {
  const rest = loadHistory(domain, store).filter((item) => item.id !== conversation.id)
  if (!conversation.turns.length) {
    writeHistory(domain, rest, store)
    return
  }
  writeHistory(domain, [{ ...conversation, turns: conversation.turns.slice(-maxStoredTurns) }, ...rest], store)
}

export function deleteConversation(domain: Domain, id: string, store: StorageLike | undefined = storage()): void {
  writeHistory(domain, loadHistory(domain, store).filter((item) => item.id !== id), store)
}

export function clearHistory(domain: Domain, store: StorageLike | undefined = storage()): void {
  try {
    store?.removeItem(historyStorageKey(domain))
    store?.removeItem(legacyStorageKey(domain))
  } catch {
    // Nothing to clear.
  }
}

/** The first thing the user said, for the history list. */
export function conversationTitle(conversation: CompanionConversation): string {
  const first = conversation.turns.find((turn) => turn.role === 'user' && turn.text.trim())
  return (first?.text.trim() ?? 'untitled').replace(/\s+/g, ' ')
}

export function conversationUpdatedAt(conversation: CompanionConversation): string {
  return conversation.turns[conversation.turns.length - 1]?.at ?? ''
}
