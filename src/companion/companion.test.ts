import { describe, expect, it, vi } from 'vitest'
import { AnthropicClient, type MessagesResponse } from './anthropicClient'
import { BridgeCompanionClient } from './bridgeCompanion'
import { CompanionError, createAnthropicCompanion, createBridgeCompanion, maxModelCalls } from './companion'
import type { CompanionActions } from './companionTools'
import { fakeActions } from './companionTools.test'
import { buildSystemPrompt } from './companionPrompt'
import { clearHistory, conversationTitle, deleteConversation, historyStorageKey, loadHistory, saveConversation } from './companionStore'

const reply = (content: MessagesResponse['content'], stop_reason = 'end_turn'): MessagesResponse => ({ id: 'm', content, stop_reason })
const actions = { createTask: vi.fn(() => ({ id: 'n1', title: 'call plumber', completed: false, estimateMin: 30, priority: 3 })) } as unknown as CompanionActions

function companionWith(responses: MessagesResponse[], history = [] as Parameters<typeof createAnthropicCompanion>[0]['history'] extends () => infer T ? T : never) {
  const client = { createMessage: vi.fn() } as unknown as AnthropicClient
  for (const response of responses) vi.mocked(client.createMessage).mockResolvedValueOnce(response)
  const companion = createAnthropicCompanion({ client, model: 'claude-sonnet-5-5', history: () => history, systemPrompt: () => 'sys', actions: () => actions })
  return { client, companion }
}

describe('anthropic companion', () => {
  it('sends the chosen effort with every request and leaves it out when unset', async () => {
    const client = { createMessage: vi.fn().mockResolvedValue(reply([{ type: 'text', text: 'hi' }])) } as unknown as AnthropicClient
    await createAnthropicCompanion({ client, model: 'claude-opus-5-5', effort: 'low', history: () => [], systemPrompt: () => 'sys', actions: () => actions }).send('hey')
    expect(vi.mocked(client.createMessage).mock.calls[0][0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' } })
    await createAnthropicCompanion({ client, model: 'claude-opus-5-5', history: () => [], systemPrompt: () => 'sys', actions: () => actions }).send('hey')
    expect(vi.mocked(client.createMessage).mock.calls[1][0]).not.toHaveProperty('output_config')
  })

  it('runs tool calls and feeds results back until the model stops', async () => {
    const { client, companion } = companionWith([
      reply([{ type: 'text', text: 'adding it' }, { type: 'tool_use', id: 'tu1', name: 'create_task', input: { title: 'call plumber' } }], 'tool_use'),
      reply([{ type: 'text', text: 'done, it is in your inbox' }]),
    ], [{ role: 'user', text: 'hi', at: 't' }, { role: 'assistant', text: 'hello', at: 't' }])

    const result = await companion.send('add a task to call the plumber')
    expect(result).toMatchObject({ text: 'adding it\n\ndone, it is in your inbox', toolCalls: [{ name: 'create_task', ok: true }] })
    expect(result.actions).toEqual([{ id: 'tu1', tool: 'create_task', weight: 'light', title: 'add task "call plumber"', done: 'added task "call plumber"', status: 'done' }])
    expect(typeof result.undos.tu1).toBe('function')
    expect(result.pending).toBeUndefined()
    expect(actions.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'call plumber' }))

    const second = vi.mocked(client.createMessage).mock.calls[1][0]
    expect(second.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect(second.messages[4].content).toEqual([{ type: 'tool_result', tool_use_id: 'tu1', content: expect.stringContaining('"id":"n1"'), is_error: undefined }])
    expect(second.tools?.map((tool) => tool.name)).not.toContain('read_note')
  })

  it('holds a heavy action for approval and resumes the model once it is decided', async () => {
    const gated = fakeActions()
    const client = { createMessage: vi.fn() } as unknown as AnthropicClient
    vi.mocked(client.createMessage)
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'removing it' }, { type: 'tool_use', id: 'r1', name: 'list_tasks', input: {} }, { type: 'tool_use', id: 'd1', name: 'delete_task', input: { id: 't1' } }], 'tool_use'))
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'gone' }]))
    const companion = createAnthropicCompanion({ client, model: 'm', history: () => [], systemPrompt: () => 'sys', actions: () => gated })

    const first = await companion.send('delete the plumber task')
    expect(first.text).toBe('removing it')
    expect(first.actions).toEqual([{ id: 'd1', tool: 'delete_task', weight: 'heavy', title: 'delete task "call plumber"', done: 'deleted task "call plumber"', fields: [{ label: 'task', value: 'call plumber' }], status: 'pending' }])
    expect(first.pending?.ids).toEqual(['d1'])
    expect(gated.removeTask).not.toHaveBeenCalled()
    expect(client.createMessage).toHaveBeenCalledTimes(1)

    const decision = await first.pending!.decide('d1', true)
    expect(gated.removeTask).toHaveBeenCalledWith('t1')
    expect(decision.action.status).toBe('done')
    expect(typeof decision.undo).toBe('function')
    expect(decision.reply).toMatchObject({ text: 'gone', actions: [] })
    const resumed = vi.mocked(client.createMessage).mock.calls[1][0]
    expect(resumed.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(resumed.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 'r1', content: expect.stringContaining('call plumber'), is_error: undefined },
      { type: 'tool_result', tool_use_id: 'd1', content: JSON.stringify({ id: 't1', title: 'call plumber' }), is_error: undefined },
    ])
    await expect(first.pending!.decide('d1', true)).rejects.toThrow('already decided')
  })

  it('tells the model when the user dismisses a card', async () => {
    const gated = fakeActions()
    const client = { createMessage: vi.fn() } as unknown as AnthropicClient
    vi.mocked(client.createMessage)
      .mockResolvedValueOnce(reply([{ type: 'tool_use', id: 'f1', name: 'forget_memory', input: { name: 'gym' } }], 'tool_use'))
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'kept it' }]))
    const vault = { listNotes: vi.fn(), readNote: vi.fn(async () => ({ content: '- [gym](gym.md) — mornings\n', sha: 'x' })), writeNote: vi.fn(), appendNote: vi.fn(), deleteNote: vi.fn() }
    const companion = createAnthropicCompanion({ client, model: 'm', history: () => [], systemPrompt: () => 'sys', actions: () => gated, vault })

    const first = await companion.send('forget the gym thing')
    expect(first.actions[0]).toMatchObject({ weight: 'heavy', title: 'forget memory "gym"', fields: [{ label: 'memory', value: 'memory/gym.md' }, { label: 'about', value: 'mornings' }], status: 'pending' })
    const decision = await first.pending!.decide('f1', false)
    expect(vault.deleteNote).not.toHaveBeenCalled()
    expect(decision.action.status).toBe('dismissed')
    expect(decision.reply?.text).toBe('kept it')
    const resumed = vi.mocked(client.createMessage).mock.calls[1][0]
    expect(resumed.messages[2].content).toEqual([{ type: 'tool_result', tool_use_id: 'f1', content: expect.stringContaining('dismissed'), is_error: true }])
  })

  it('replays settled actions into later turns so the model knows what happened', async () => {
    const { client, companion } = companionWith([reply([{ type: 'text', text: 'ok' }])], [
      { role: 'user', text: 'add milk', at: 't' },
      { role: 'assistant', text: 'added', at: 't', actions: [{ id: 'a', tool: 'create_task', weight: 'light', title: 'add task "milk"', done: 'added task "milk"', status: 'undone' }, { id: 'b', tool: 'delete_task', weight: 'heavy', title: 'delete task "eggs"', done: 'deleted task "eggs"', status: 'dismissed' }] },
    ])
    await companion.send('what happened?')
    const history = vi.mocked(client.createMessage).mock.calls[0][0].messages
    expect(history[1].content).toBe('added\n[added task "milk", then the user undid it]\n[delete task "eggs": the user dismissed it, not done]')
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
    const companion = createBridgeCompanion({ client: new BridgeCompanionClient(undefined, fetcher), sessionId: () => sessionId, systemPrompt: () => 'sys', model: 'opus', effort: 'medium' })

    const first = await companion.send('hi')
    sessionId = first.sessionId
    await companion.send('again')
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
    expect(bodies[0]).toEqual({ text: 'hi', systemPrompt: 'sys', model: 'opus', effort: 'medium' })
    expect(bodies[1]).toEqual({ text: 'again', sessionId: 'abc', model: 'opus', effort: 'medium' })
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

  it('tells the model what it remembers and where memory lives', () => {
    const summary = { today: 'd', openCount: 0, availableMin: 0, dueToday: [], overdue: [], thisWeek: [], suggested: [], goals: [], projects: [] }
    const personal = buildSystemPrompt({ domain: 'personal', vaultAvailable: true, summary, memoryIndex: '<!-- index -->\n- [gym](gym.md) — mornings\n' })
    expect(personal).toContain('What you remember about the user (memory/MEMORY.md):\n- [gym](gym.md) — mornings')
    expect(personal).toContain('save_memory')
    expect(buildSystemPrompt({ domain: 'personal', vaultAvailable: true, summary, memoryIndex: '' })).toContain('- nothing yet')
    expect(buildSystemPrompt({ domain: 'personal', vaultAvailable: true, summary })).toContain('could not be read this turn')
    const work = buildSystemPrompt({ domain: 'work', vaultAvailable: true, summary })
    expect(work).toContain('read 99 System/Memory/MEMORY.md at the start')
    expect(work).not.toContain('save_memory')
  })

  it('expires cards that were still waiting when the thread was stored', () => {
    const data = new Map<string, string>()
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
    const action = { id: 'a', tool: 'delete_task', weight: 'heavy' as const, title: 'delete task "x"', done: 'deleted task "x"', status: 'pending' as const }
    saveConversation('personal', { version: 1, id: 'c1', turns: [{ role: 'assistant', text: '', at: 'now', actions: [action, { ...action, id: 'b', status: 'done' }] }] }, store)
    expect(loadHistory('personal', store)[0].turns[0].actions?.map((item) => item.status)).toEqual(['expired', 'done'])
  })

  it('round-trips and trims the conversation', () => {
    const data = new Map<string, string>()
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
    const turns = Array.from({ length: 45 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, text: `t${index}`, at: 'now' }))
    saveConversation('work', { version: 1, id: 'c1', turns, sessionId: 'abc' }, store)
    const [loaded] = loadHistory('work', store)
    expect(loaded.turns).toHaveLength(40)
    expect(loaded.turns[0].text).toBe('t5')
    expect(loaded.sessionId).toBe('abc')
    clearHistory('work', store)
    expect(loadHistory('work', store)).toEqual([])
    expect(loadHistory('personal', { ...store, getItem: () => 'garbage' })).toEqual([])
  })

  it('keeps every thread, newest first, and deletes one at a time', () => {
    const data = new Map<string, string>()
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
    const turn = (text: string, at: string) => ({ role: 'user' as const, text, at })
    saveConversation('personal', { version: 1, id: 'old', turns: [turn('plan my week', '2026-11-01T09:00:00.000Z')] }, store)
    saveConversation('personal', { version: 1, id: 'new', turns: [turn('what is on today', '2026-11-05T09:00:00.000Z')] }, store)
    saveConversation('personal', { version: 1, id: 'empty', turns: [] }, store)
    expect(loadHistory('personal', store).map((item) => item.id)).toEqual(['new', 'old'])
    // Saving again replaces the earlier copy instead of adding a second one.
    saveConversation('personal', { version: 1, id: 'old', turns: [turn('plan my week', '2026-11-01T09:00:00.000Z'), { role: 'assistant', text: 'sure', at: '2026-11-06T09:00:00.000Z' }] }, store)
    expect(loadHistory('personal', store).map((item) => item.id)).toEqual(['old', 'new'])
    expect(conversationTitle(loadHistory('personal', store)[0])).toBe('plan my week')
    deleteConversation('personal', 'old', store)
    expect(loadHistory('personal', store).map((item) => item.id)).toEqual(['new'])
  })

  it('folds the single thread from before history into the list once', () => {
    const data = new Map<string, string>()
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) } }
    data.set('my-brain.work.companion.v1', JSON.stringify({ version: 1, turns: [{ role: 'user', text: 'hello', at: '2026-11-04T09:00:00.000Z' }], sessionId: 's1' }))
    const [folded] = loadHistory('work', store)
    expect(folded.sessionId).toBe('s1')
    expect(folded.id).toBeTruthy()
    expect(data.has('my-brain.work.companion.v1')).toBe(false)
    expect(data.has(historyStorageKey('work'))).toBe(true)
    expect(loadHistory('work', store)).toHaveLength(1)
  })
})
