import { describe, expect, it, vi } from 'vitest'
import type { AnthropicClient, MessagesResponse } from './anthropicClient'
import { createAnthropicCompanion } from './companion'
import type { CompanionActions } from './companionTools'
import type { CompanionTurn } from './companionStore'
import { contextBudget, contextTurns, continuesThread, threadIdleMs, turnBudget } from './context'
import type { JevAnswer, JevClient } from './jev'
import { routeFromAnswers, routeQuestions, routeWithJev, type Route } from './route'

const now = Date.parse('2026-11-25T12:00:00.000Z')
const ago = (ms: number) => new Date(now - ms).toISOString()
const exchange = (ms: number): CompanionTurn[] => [{ role: 'user', text: 'what is on today', at: ago(ms + 5000) }, { role: 'assistant', text: 'two meetings', at: ago(ms) }]

describe('whether a message carries on the thread', () => {
  it('never carries on an empty thread', () => {
    expect(continuesThread({ turns: [], follows: 0.99, pinned: true, now })).toBe(false)
  })

  it('goes by the clock when nothing has judged the message', () => {
    expect(continuesThread({ turns: exchange(60_000), now })).toBe(true)
    expect(continuesThread({ turns: exchange(threadIdleMs + 60_000), now })).toBe(false)
  })

  it('lets jev overrule the clock, and starts over only when jev is sure', () => {
    expect(continuesThread({ turns: exchange(threadIdleMs * 4), follows: 0.9, now })).toBe(true)
    expect(continuesThread({ turns: exchange(60_000), follows: 0.1, now })).toBe(false)
    expect(continuesThread({ turns: exchange(60_000), follows: 0.45, now })).toBe(true)
  })

  it('always carries on a thread reopened from the history', () => {
    expect(continuesThread({ turns: exchange(threadIdleMs * 100), follows: 0.01, pinned: true, now })).toBe(true)
  })
})

describe('what goes along with a message', () => {
  const turn = (index: number, length: number): CompanionTurn => ({ role: index % 2 ? 'assistant' : 'user', text: `${index}`.padEnd(length, 'x'), at: ago(0) })

  it('sends a short thread whole', () => {
    const turns = exchange(0)
    expect(contextTurns(turns)).toEqual(turns)
  })

  it('drops the oldest turns once the budget is spent', () => {
    const turns = Array.from({ length: 40 }, (_, index) => turn(index, 1000))
    const kept = contextTurns(turns)
    expect(kept.length).toBe(contextBudget / 1000)
    expect(kept[kept.length - 1]).toBe(turns[39])
  })

  it('cuts a long turn short and still sends the last exchange', () => {
    const kept = contextTurns([turn(0, 50), turn(1, turnBudget * 6), turn(2, turnBudget * 6)], turnBudget)
    expect(kept.map((item) => item.text.length)).toEqual([turnBudget + 1, turnBudget + 1])
    expect(kept[1].text.endsWith('…')).toBe(true)
  })
})

describe('asking jev about the thread', () => {
  const choice = (label: string, probabilities: Record<string, number>): JevAnswer => ({ type: 'choice', choice: label, probabilities })

  it('asks only when there is an exchange before the message', async () => {
    expect(Object.keys(routeQuestions([]))).toEqual(['depth'])
    const client = { ask: vi.fn(async () => ({})) } as unknown as JevClient
    await routeWithJev(client, { text: 'and tomorrow?', previousMessage: 'what is on today', previousReply: 'two meetings', groups: [] })
    const [state, questions] = vi.mocked(client.ask).mock.calls[0]
    expect(state).toEqual({ message: 'and tomorrow?', previous_message: 'what is on today', previous_reply: 'two meetings' })
    expect(Object.keys(questions)).toEqual(['depth', 'thread'])
  })

  it('reads the chance the message carries on, and says nothing when jev did not answer', () => {
    expect(routeFromAnswers({ thread: choice('NO', { NO: 0.8, YES: 0.2 }) }, []).follows).toBe(0.2)
    expect(routeFromAnswers({ depth: choice('deep', { deep: 0.9 }), thread: choice('YES', { YES: 0.7 }) }, []).follows).toBe(0.7)
    expect(routeFromAnswers({}, []).follows).toBeUndefined()
  })
})

describe('the companion and the thread', () => {
  const reply: MessagesResponse = { id: 'm', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }
  const actions = {} as CompanionActions

  function companionWith(options: { model?: string; route?: () => Promise<Route>; keep?: (follows?: number) => boolean; history?: CompanionTurn[] }) {
    const client = { createMessage: vi.fn().mockResolvedValue(reply) } as unknown as AnthropicClient
    const route = options.route ? vi.fn(options.route) : undefined
    const companion = createAnthropicCompanion({ client, model: options.model ?? 'claude-sonnet-5-5', route, keep: options.keep, history: () => options.history ?? exchange(0), systemPrompt: () => 'sys', actions: () => actions })
    return { companion, route, messages: () => vi.mocked(client.createMessage).mock.calls[0][0].messages }
  }

  it('asks the route about the thread under a named model too, and hands its answer to keep', async () => {
    const keep = vi.fn(() => true)
    const { companion, route, messages } = companionWith({ route: async () => ({ rung: 0, skip: [], follows: 0.9 }), keep })
    await companion.send('and tomorrow?')
    expect(route!.mock.calls[0]).toEqual([expect.objectContaining({ previousMessage: 'what is on today', previousReply: 'two meetings' })])
    expect(keep).toHaveBeenCalledWith(0.9)
    expect(messages().map((message) => message.content)).toEqual(['what is on today', 'two meetings', 'and tomorrow?'])
    expect(vi.mocked(route!).mock.calls.length).toBe(1)
  })

  it('sends the message alone when the thread is not kept', async () => {
    const { companion, messages } = companionWith({ keep: () => false })
    await companion.send('add milk')
    expect(messages()).toEqual([{ role: 'user', content: 'add milk' }])
  })

  it('still settles the thread when jev cannot be reached', async () => {
    const keep = vi.fn(() => true)
    const { companion } = companionWith({ route: async () => { throw new Error('offline') }, keep })
    await companion.send('and tomorrow?')
    expect(keep).toHaveBeenCalledWith(undefined)
  })
})
