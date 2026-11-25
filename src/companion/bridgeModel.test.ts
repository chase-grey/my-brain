import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnthropicTool, ChatClient, MessagesRequest, MessagesResponse } from './anthropicClient'
import { BridgeUnreachableError, type BridgeChatStatus, type BridgeModelRequest } from './bridgeCompanion'
import { BridgeModelClient, bridgeModelReady, bridgeReachedBefore, forgetBridgeModel, parseReply, rememberBridge, renderPrompt, renderSystem } from './bridgeModel'
import { createAnthropicCompanion } from './companion'
import type { CompanionActions } from './companionTools'

const tool: AnthropicTool = { name: 'create_task', description: 'Create a task', input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }
const request: MessagesRequest = { model: 'claude-sonnet-5-5', system: 'You are the companion.', messages: [{ role: 'user', content: 'add milk' }], tools: [tool], output_config: { effort: 'medium' } }

function memoryStore(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) } }
}

const status = (model: boolean | undefined): BridgeChatStatus => ({ claude: true, vault: true, vaultPath: 'v', ...(model === undefined ? {} : { model }) })

describe('the request as one prompt', () => {
  it('puts the tools and how to ask for them after the system prompt', () => {
    const system = renderSystem(request)
    expect(system.startsWith('You are the companion.')).toBe(true)
    expect(system).toContain('tool_calls')
    expect(system).toContain('"name":"create_task"')
    expect(system).toContain('"required":["title"]')
  })

  it('asks for plain text when there are no tools', () => {
    expect(renderSystem({ system: 'sys' })).toBe('sys\n\nAnswer in text and leave tool_calls empty.')
  })

  it('writes the conversation as a transcript, with each tool result under the tool that was asked for', () => {
    const prompt = renderPrompt([
      { role: 'user', content: 'add milk' },
      { role: 'assistant', content: [{ type: 'text', text: 'adding it' }, { type: 'tool_use', id: 't1', name: 'create_task', input: { title: 'milk' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"id":"n1"}' }, { type: 'tool_result', tool_use_id: 't2', content: 'no task with that id', is_error: true }] },
    ])
    expect(prompt).toBe([
      'USER:\nadd milk',
      'ASSISTANT:\nadding it\n[asked the app to run create_task (t1) with {"title":"milk"}]',
      'USER:\n[result of create_task (t1)]\n{"id":"n1"}\n[error from tool (t2)]\nno task with that id',
    ].join('\n\n'))
  })
})

describe('the reply as content blocks', () => {
  const ids = () => { let next = 0; return () => `id${next += 1}` }

  it('turns tool calls into tool_use blocks and stops for them', () => {
    const reply = parseReply('{"text":"","tool_calls":[{"name":"create_task","input":{"title":"milk"}}]}', ids())
    expect(reply.stop_reason).toBe('tool_use')
    expect(reply.content).toEqual([{ type: 'tool_use', id: 'id1', name: 'create_task', input: { title: 'milk' } }])
  })

  it('ends the turn on words alone', () => {
    const reply = parseReply('{"text":" two meetings today ","tool_calls":[]}', ids())
    expect(reply.stop_reason).toBe('end_turn')
    expect(reply.content).toEqual([{ type: 'text', text: 'two meetings today' }])
  })

  it('keeps plain words as the answer and drops calls with no name or a bad input', () => {
    expect(parseReply('just words', ids()).content).toEqual([{ type: 'text', text: 'just words' }])
    const reply = parseReply('{"text":"","tool_calls":[{"input":{}},{"name":"list_tasks","input":"nope"}]}', ids())
    expect(reply.content).toEqual([{ type: 'tool_use', id: 'id1', name: 'list_tasks', input: {} }])
  })
})

describe('the bridge as the model', () => {
  it('sends the rendered request with the model and effort, and reads the reply', async () => {
    const model = vi.fn(async (_request: BridgeModelRequest) => ({ result: '{"text":"added","tool_calls":[]}', isError: false }))
    const reply = await new BridgeModelClient({ model }).createMessage(request)
    expect(model).toHaveBeenCalledWith({ system: renderSystem(request), prompt: 'USER:\nadd milk', model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(reply.content).toEqual([{ type: 'text', text: 'added' }])
  })

  it('carries on with the personal key when the bridge has gone away', async () => {
    const answer: MessagesResponse = { id: 'k', content: [{ type: 'text', text: 'from the key' }], stop_reason: 'end_turn' }
    const fallback: ChatClient = { createMessage: vi.fn(async () => answer) }
    const gone = vi.fn()
    const client = new BridgeModelClient({ model: async () => { throw new BridgeUnreachableError() } }, fallback, gone)
    expect(await client.createMessage(request)).toBe(answer)
    expect(fallback.createMessage).toHaveBeenCalledWith(request)
    expect(gone).toHaveBeenCalledOnce()
  })

  it('says the bridge is gone when there is no key to fall back on, and passes other failures up', async () => {
    await expect(new BridgeModelClient({ model: async () => { throw new BridgeUnreachableError() } }).createMessage(request)).rejects.toBeInstanceOf(BridgeUnreachableError)
    const fallback: ChatClient = { createMessage: vi.fn() }
    await expect(new BridgeModelClient({ model: async () => ({ result: 'credit balance is too low', isError: true }) }, fallback).createMessage(request)).rejects.toThrow('claude code returned 502')
    expect(fallback.createMessage).not.toHaveBeenCalled()
  })

  it('sends a message with a photo to the key, and says it cannot be read when there is no key', async () => {
    const withPhoto: MessagesRequest = { ...request, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'what is this' }] }] }
    const answer: MessagesResponse = { id: 'k', content: [{ type: 'text', text: 'a receipt' }], stop_reason: 'end_turn' }
    const fallback: ChatClient = { createMessage: vi.fn(async () => answer) }
    const model = vi.fn(async (_request: BridgeModelRequest) => ({ result: '{"text":"i cannot see it","tool_calls":[]}', isError: false }))
    expect(await new BridgeModelClient({ model }, fallback).createMessage(withPhoto)).toBe(answer)
    expect(model).not.toHaveBeenCalled()
    await new BridgeModelClient({ model }).createMessage(withPhoto)
    expect(model.mock.calls[0][0].prompt).toBe(['USER:', '[an attached photo that cannot be read here: say so if it matters]', 'what is this'].join('\n'))
  })

  it('runs the personal tools in the app, the same loop the key uses', async () => {
    const model = vi.fn()
      .mockResolvedValueOnce({ result: '{"text":"","tool_calls":[{"name":"create_task","input":{"title":"milk"}}]}', isError: false })
      .mockResolvedValueOnce({ result: '{"text":"added milk","tool_calls":[]}', isError: false })
    const actions = { createTask: vi.fn(() => ({ id: 'n1', title: 'milk', completed: false, estimateMin: 5, priority: 3 })) } as unknown as CompanionActions
    const companion = createAnthropicCompanion({ client: new BridgeModelClient({ model }), model: 'claude-sonnet-5-5', history: () => [], systemPrompt: () => 'sys', actions: () => actions })
    const reply = await companion.send('add milk')
    expect(actions.createTask).toHaveBeenCalledWith(expect.objectContaining({ title: 'milk' }))
    expect(reply.text).toBe('added milk')
    expect(reply.actions.map((action) => action.status)).toEqual(['done'])
    expect(model.mock.calls[1][0].prompt).toContain('[result of create_task (')
  })
})

describe('looking for the bridge', () => {
  beforeEach(() => forgetBridgeModel())

  it('is only looked for on a device that has reached it before', () => {
    expect(bridgeReachedBefore(memoryStore())).toBe(false)
    expect(bridgeReachedBefore(memoryStore({ 'my-brain.work.companion.history.v1': '{}' }))).toBe(true)
    const store = memoryStore()
    rememberBridge(store)
    expect(bridgeReachedBefore(store)).toBe(true)
  })

  it('is ready when the bridge has the model route, and remembers that for the session', async () => {
    const client = { status: vi.fn(async () => status(true)) }
    expect(await bridgeModelReady(client)).toBe(true)
    expect(await bridgeModelReady(client)).toBe(true)
    expect(client.status).toHaveBeenCalledOnce()
  })

  it('is not ready on a bridge started before the route existed, one that is down, or one too busy to answer, and asks again next time', async () => {
    expect(await bridgeModelReady({ status: async () => status(undefined) })).toBe(false)
    expect(await bridgeModelReady({ status: async () => { throw new BridgeUnreachableError() } })).toBe(false)
    expect(await bridgeModelReady({ status: () => new Promise<BridgeChatStatus>(() => {}) }, 5)).toBe(false)
    expect(await bridgeModelReady({ status: async () => status(true) })).toBe(true)
  })
})
