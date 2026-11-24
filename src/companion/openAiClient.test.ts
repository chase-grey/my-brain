import { describe, expect, it, vi } from 'vitest'
import { activeModel, baseUrlFor, modelChoices, modelField, providerOf } from './aiProvider'
import { AnthropicError } from './anthropicClient'
import { mapCompanionError } from './companion'
import { fromCompletionResponse, OpenAiCompatClient, toCompletionRequest } from './openAiClient'
import { defaultSettings } from '../settings'

describe('openai-compatible client', () => {
  it('sends the companion request as chat completions', () => {
    const body = toCompletionRequest({
      model: 'gpt-4o-mini',
      system: 'be brief',
      output_config: { effort: 'high' },
      tools: [{ name: 'add_task', description: 'adds a task', input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } }],
      messages: [
        { role: 'user', content: 'add milk' },
        { role: 'assistant', content: [{ type: 'text', text: 'adding' }, { type: 'tool_use', id: 'call_1', name: 'add_task', input: { title: 'milk' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }] },
      ],
    })
    expect(body).toEqual({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'add milk' },
        { role: 'assistant', content: 'adding', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_task', arguments: '{"title":"milk"}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      ],
      tools: [{ type: 'function', function: { name: 'add_task', description: 'adds a task', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } } }],
    })
  })

  it('reads tool calls and text back in the shape the companion expects', () => {
    expect(fromCompletionResponse({ id: 'x', choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_task', arguments: '{"title":"milk"}' } }] } }] })).toEqual({
      id: 'x',
      content: [{ type: 'tool_use', id: 'call_1', name: 'add_task', input: { title: 'milk' } }],
      stop_reason: 'tool_use',
    })
    expect(fromCompletionResponse({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] })).toEqual({ id: '', content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' })
    expect(fromCompletionResponse({ choices: [{ finish_reason: 'length', message: { content: 'cut' } }] }).stop_reason).toBe('max_tokens')
    // Arguments that are not json must not stop the turn.
    expect(fromCompletionResponse({ choices: [{ message: { tool_calls: [{ id: 'c', type: 'function', function: { name: 'n', arguments: 'nope' } }] } }] }).content).toEqual([{ type: 'tool_use', id: 'c', name: 'n', input: {} }])
  })

  it('posts to the base url with a bearer key, and names the service when it fails', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] })))
    const reply = await new OpenAiCompatClient('sk-test', 'https://openrouter.ai/api/v1', 'openrouter', fetcher).createMessage({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })
    expect(reply.content).toEqual([{ type: 'text', text: 'hi' }])
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')

    const refused = new OpenAiCompatClient('bad', 'https://api.openai.com/v1', 'openai', async () => new Response('no', { status: 401 }))
    const error = await refused.createMessage({ model: 'm', messages: [] }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AnthropicError)
    expect(mapCompanionError(error).message).toBe('openai rejected the api key')
    expect(mapCompanionError(new AnthropicError(401, '')).message).toBe('anthropic rejected the api key')
  })
})

describe('ai provider', () => {
  it('is anthropic unless another is named', () => {
    expect(providerOf(undefined).id).toBe('anthropic')
    expect(providerOf('nonsense').id).toBe('anthropic')
    expect(defaultSettings.aiProvider).toBe('anthropic')
    expect(providerOf('openrouter').baseUrl).toBe('https://openrouter.ai/api/v1')
  })

  it('takes a typed base url only for the provider that has none', () => {
    expect(baseUrlFor({ aiProvider: 'openai', aiBaseUrl: 'https://elsewhere/v1' })).toBe('https://api.openai.com/v1')
    expect(baseUrlFor({ aiProvider: 'custom', aiBaseUrl: ' http://localhost:1234/v1/ ' })).toBe('http://localhost:1234/v1')
    expect(baseUrlFor({ aiProvider: 'custom', aiBaseUrl: '' })).toBe('')
  })

  it('keeps each provider on its own model', () => {
    const anthropic = { ...defaultSettings }
    expect(activeModel('personal', anthropic)).toBe('auto')
    expect(modelField('personal', anthropic)).toBe('anthropicModel')

    const openai = { ...defaultSettings, aiProvider: 'openai' }
    expect(activeModel('personal', openai)).toBe('gpt-4o-mini')
    expect(modelChoices('personal', openai)).not.toContain('auto')
    expect(modelField('personal', openai)).toBe('aiModel')
    expect(modelChoices('personal', { ...openai, aiModel: 'o-something' })[0]).toBe('o-something')

    // The work chat is Claude Code whatever the personal provider is.
    expect(activeModel('work', openai)).toBe('claude-sonnet-5-5')
    expect(modelField('work', openai)).toBe('anthropicModel')
  })
})
