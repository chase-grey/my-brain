import { describe, expect, it, vi } from 'vitest'
import type { AnthropicClient, MessagesResponse } from './anthropicClient'
import { createAnthropicCompanion } from './companion'
import type { CompanionActions } from './companionTools'
import { companionTools, toolGroups } from './companionTools'
import { JevClient, JevError, type JevAnswer } from './jev'
import { defaultRoute, handOffTool, routeFromAnswers, routeQuestions, routeWithJev, type Route } from './route'

const choice = (label: string, probability: number, others: Record<string, number> = {}): JevAnswer => ({ type: 'choice', choice: label, probabilities: { [label]: probability, ...others } })
const no = (yes: number): JevAnswer => choice('NO', 1 - yes, { YES: yes })
const all = ['notes', 'trips', 'calendar'] as const

describe('jev client', () => {
  it('posts the state and questions with the key and returns the answers', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { depth: choice('quick', 0.9) } }), { status: 200 }))
    const answers = await new JevClient('jev-key', fetcher as unknown as typeof fetch).ask({ message: 'hi' }, routeQuestions([]))
    expect(answers.depth.choice).toBe('quick')
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jev-key')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'jev-latest', state: { message: 'hi' }, questions: { depth: { type: 'choice' } } })
  })

  it('throws on a failed request', async () => {
    const fetcher = vi.fn(async () => new Response('nope', { status: 401 }))
    await expect(new JevClient('k', fetcher as unknown as typeof fetch).ask({}, {})).rejects.toBeInstanceOf(JevError)
  })
})

describe('routing', () => {
  it('asks only about the tool groups the space has', () => {
    expect(Object.keys(routeQuestions(['calendar']))).toEqual(['depth', 'calendar'])
  })

  it('starts on the cheap model only when jev is sure, and leaves out tools it is sure are not needed', () => {
    expect(routeFromAnswers({ depth: choice('quick', 0.9), notes: no(0.05), trips: no(0.02), calendar: no(0.5) }, [...all])).toEqual({ rung: 0, skip: ['notes', 'trips'] })
    expect(routeFromAnswers({ depth: choice('quick', 0.5) }, [...all])).toEqual({ rung: 1, skip: [] })
  })

  it('gives the top model every tool', () => {
    expect(routeFromAnswers({ depth: choice('deep', 0.8), notes: no(0.01) }, [...all])).toEqual({ rung: 2, skip: [] })
  })

  it('falls to the middle with every tool when answers are missing', () => {
    expect(routeFromAnswers({}, [...all])).toEqual(defaultRoute)
  })

  it('sends the message and the reply before it', async () => {
    const client = { ask: vi.fn(async () => ({ depth: choice('quick', 0.9) })) } as unknown as JevClient
    await routeWithJev(client, { text: 'yes do that', previousReply: 'want me to add it?', groups: [] })
    expect(vi.mocked(client.ask).mock.calls[0][0]).toEqual({ message: 'yes do that', previous_reply: 'want me to add it?' })
  })
})

describe('tool groups', () => {
  it('lists what the space has and drops what a route skips', () => {
    expect(toolGroups({ hasVault: true, hasCalendar: false })).toEqual(['notes', 'trips'])
    const names = companionTools({ hasVault: true, hasCalendar: true, skip: ['notes', 'calendar'] }).map((tool) => tool.name)
    expect(names).toContain('create_task')
    expect(names).toContain('list_trips')
    expect(names).not.toContain('read_note')
    expect(names).not.toContain('save_memory')
    expect(names).not.toContain('list_calendar')
  })
})

describe('auto model', () => {
  const reply = (content: MessagesResponse['content'], stop_reason = 'end_turn'): MessagesResponse => ({ id: 'm', content, stop_reason })
  const actions = { createTask: vi.fn(() => ({ id: 'n1', title: 'milk', completed: false, estimateMin: 5, priority: 3 })) } as unknown as CompanionActions

  function auto(responses: MessagesResponse[], route?: (() => Promise<Route>)) {
    const client = { createMessage: vi.fn() } as unknown as AnthropicClient
    for (const response of responses) vi.mocked(client.createMessage).mockResolvedValueOnce(response)
    const companion = createAnthropicCompanion({ client, model: 'auto', effort: 'max', route, history: () => [], systemPrompt: () => 'sys', actions: () => actions, hasCalendar: () => true })
    return { companion, calls: () => vi.mocked(client.createMessage).mock.calls.map(([request]) => request) }
  }

  it('starts where the route says, with the tools it kept and a way up', async () => {
    const { companion, calls } = auto([reply([{ type: 'text', text: 'added' }])], async () => ({ rung: 0, skip: ['calendar'] }))
    const result = await companion.send('add milk')
    expect(result.model).toBe('claude-haiku-5-5')
    expect(calls()[0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } })
    const names = calls()[0].tools!.map((tool) => tool.name)
    expect(names).not.toContain('list_calendar')
    expect(names).toContain(handOffTool.name)
  })

  it('starts in the middle with every tool when there is no route or it fails', async () => {
    const none = auto([reply([{ type: 'text', text: 'hi' }])])
    await none.companion.send('hey')
    expect(none.calls()[0]).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' } })
    const failed = auto([reply([{ type: 'text', text: 'hi' }])], async () => { throw new Error('offline') })
    await failed.companion.send('hey')
    expect(failed.calls()[0].model).toBe('claude-sonnet-5-5')
    expect(failed.calls()[0].tools!.map((tool) => tool.name)).toContain('list_calendar')
  })

  it('moves up a model with every tool when the model hands off, and drops what it said on the way', async () => {
    const { companion, calls } = auto([
      reply([{ type: 'text', text: 'this needs more thought' }, { type: 'tool_use', id: 'h1', name: 'hand_off', input: {} }], 'tool_use'),
      reply([{ type: 'text', text: 'here is the plan' }]),
    ], async () => ({ rung: 0, skip: ['calendar'] }))
    const result = await companion.send('plan my week')
    expect(result).toMatchObject({ text: 'here is the plan', model: 'claude-sonnet-5-5', actions: [] })
    const second = calls()[1]
    expect(second).toMatchObject({ model: 'claude-sonnet-5-5', output_config: { effort: 'medium' } })
    expect(second.tools!.map((tool) => tool.name)).toContain('list_calendar')
    expect(second.messages.at(-1)!.content).toEqual([expect.objectContaining({ type: 'tool_result', tool_use_id: 'h1' })])
  })

  it('offers no hand-off at the top with every tool', async () => {
    const { companion, calls } = auto([reply([{ type: 'text', text: 'ok' }])], async () => ({ rung: 2, skip: [] }))
    await companion.send('review my year')
    expect(calls()[0].model).toBe('claude-opus-5-5')
    expect(calls()[0].tools!.map((tool) => tool.name)).not.toContain(handOffTool.name)
  })

  it('leaves a named model alone', async () => {
    const client = { createMessage: vi.fn().mockResolvedValue(reply([{ type: 'text', text: 'hi' }])) } as unknown as AnthropicClient
    const route = vi.fn()
    await createAnthropicCompanion({ client, model: 'claude-opus-5-5', effort: 'low', route, history: () => [], systemPrompt: () => 'sys', actions: () => actions }).send('hey')
    const request = vi.mocked(client.createMessage).mock.calls[0][0]
    expect(request).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low' } })
    expect(request.tools!.map((tool) => tool.name)).not.toContain(handOffTool.name)
    expect(route).not.toHaveBeenCalled()
  })
})
