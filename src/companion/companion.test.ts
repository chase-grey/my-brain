import { describe, expect, it, vi } from 'vitest'
import { AnthropicClient, type MessagesResponse } from './anthropicClient'
import { BridgeCompanionClient } from './bridgeCompanion'
import { CompanionError, createAnthropicCompanion, createBridgeCompanion, maxModelCalls } from './companion'
import type { CompanionActions } from './companionTools'
import { buildSystemPrompt } from './companionPrompt'
import { clearConversation, loadConversation, saveConversation } from './companionStore'

const reply = (content: MessagesResponse['content'], stop_reason = 'end_turn'): MessagesResponse => ({ id: 'm', content, stop_reason })
const actions = { createTask: vi.fn(() => ({ id: 'n1', title: 'call plumber', completed: false, estimateMin: 30, priority: 3 })) } as unknown as CompanionActions

function companionWith(responses: MessagesResponse[], history = [] as Parameters<typeof createAnthropicCompanion>[0]['history'] extends () => infer T ? T : never) {
  const client = { createMessage: vi.fn() } as unknown as AnthropicClient
  for (const response of responses) vi.mocked(client.createMessage).mockResolvedValueOnce(response)
  const companion = createAnthropicCompanion({ client, model: 'claude-sonnet-5-5', history: () => history, systemPrompt: () => 'sys', actions: () => actions })
  return { client, companion }
}

describe('anthropic companion', () => {
  it('runs tool calls and feeds results back until the model stops', async () => {
    const { client, companion } = companionWith([
      reply([{ type: 'text', text: 'adding it' }, { type: 'tool_use', id: 'tu1', name: 'create_task', input: { title: 'call plumber' } }], 'tool_use'),
      reply([{ type: 'text', text: 'done, it is in your inbox' }]),
    ], [{ role: 'user', text: 'hi', at: 't' }, { role: 'assistant', text: 'hello', at: 't' }])

    const result = await companion.send('add a task to call the plumber')
    expect(result).toEqual({ text: 'adding it\n\ndone, it is in your inbox', toolCalls: [{ name: 'create_task', ok: true }] })
    expect(actions.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'call plumber' }))

    const second = vi.mocked(client.createMessage).mock.calls[1][0]
    expect(second.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(second.messages[4].content).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: expect.stringContaining('"id":"n1"'), is_error: undefined }])
    expect(second.tools?.map((tool) => tool.name)).not.toContain('read_note')
  })

  it('stops after the tool call cap', async () => {
    const endless = Array.from({ length: maxModelCalls + 1 }, () => reply([{ type: 'tool_use', id: 'x', name: 'list_goals', input: {} }], 'tool_use'))
    const { client, companion } = companionWith(endless)
    await expect(companion.send('loop')).rejects.toMatchObject({ kind: 'tool-cap' })
    expect(client.createMessage).toHaveBeenCalledTimes(maxModelCalls)
  })

  it('maps a rejected key to a plain message', async () => {
    const client = new AnthropicClient('bad', async () => new Response('nope', { status: 401 }))
    const companion = createAnthropicCompanion({ client, model: 'm', history: () => [], systemPrompt: () => '', actions: () => actions })
    await expect(companion.send('hi')).rejects.toEqual(new CompanionError('auth', 'anthropic rejected the api key'))
  })
})

describe('bridge companion', () => {
  it('sends the system prompt only for a new session and keeps the session id', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'hello from claude code', sessionId: 'abc', isError: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'still here', sessionId: 'abc', isError: false })))
    let sessionId: string | undefined
    const companion = createBridgeCompanion({ client: new BridgeCompanionClient(undefined, fetcher), sessionId: () => sessionId, systemPrompt: () => 'sys' })

    const first = await companion.send('hi')
    sessionId = first.sessionId
    await companion.send('again')
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(bodies[0]).toEqual({ text: 'hi', systemPrompt: 'sys' })
    expect(bodies[1]).toEqual({ text: 'again', sessionId: 'abc' })
    expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:47321/chat')
  })

  it('reports an unreachable bridge', async () => {
    const companion = createBridgeCompanion({ client: new BridgeCompanionClient(undefined, async () => { throw new TypeError('failed to fetch') }), sessionId: () => undefined, systemPrompt: () => '' })
    await expect(companion.send('hi')).rejects.toMatchObject({ kind: 'unreachable' })
  })
})

describe('companion prompt and store', () => {
  it('describes today, the vault conventions, and the honesty rule', () => {
    const prompt = buildSystemPrompt({ domain: 'personal', vaultAvailable: true, summary: {
      today: '2026-10-30', openCount: 3, availableMin: 60,
      dueToday: [{ id: 't1', title: 'call plumber', dueDate: '2026-10-30', completed: false, estimateMin: 15, priority: 2 }],
      overdue: [], thisWeek: [], suggested: [], goals: [{ id: 'g1', title: 'run a 5k', horizon: 'season', status: 'active' }], projects: [],
    } })
    expect(prompt).toContain('Today: 2026-10-30')
    expect(prompt).toContain('call plumber (id t1')
    expect(prompt).toContain('run a 5k (id g1')
    expect(prompt).toContain('HomeBase')
    expect(prompt).toContain('- [ ] text 📅 YYYY-MM-DD')
    expect(prompt).toContain('70 Goals/')
    expect(prompt).toContain('Never say a task, goal, or note change is done unless the tool returned ok')
    expect(buildSystemPrompt({ domain: 'work', vaultAvailable: false, summary: { today: 'd', openCount: 0, availableMin: 0, dueToday: [], overdue: [], thisWeek: [], suggested: [], goals: [], projects: [] } })).toContain('Hivemind vault is not reachable')
  })

  it('round-trips and trims the conversation', () => {
    const data = new Map<string, string>()
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
    const turns = Array.from({ length: 45 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, text: `t${index}`, at: 'now' }))
    saveConversation('work', { version: 1, turns, sessionId: 'abc' }, store)
    const loaded = loadConversation('work', store)
    expect(loaded.turns).toHaveLength(40)
    expect(loaded.turns[0].text).toBe('t5')
    expect(loaded.sessionId).toBe('abc')
    clearConversation('work', store)
    expect(loadConversation('work', store)).toEqual({ version: 1, turns: [] })
    expect(loadConversation('personal', { ...store, getItem: () => 'garbage' })).toEqual({ version: 1, turns: [] })
  })
})
