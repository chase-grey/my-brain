import { describe, expect, it, vi } from 'vitest'
import { AnthropicClient, textOf, toolUses } from './anthropicClient'

describe('anthropic client', () => {
  it('sends browser-direct message requests with the key', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'msg', stop_reason: 'tool_use',
      content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'tu1', name: 'list_notes', input: { folder: '70 Goals' } }],
    }), { status: 200 }))
    const client = new AnthropicClient('sk-ant-test', fetcher)
    const response = await client.createMessage({ model: 'claude-sonnet-5-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }], tools: [] })

    expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({ method: 'POST' }))
    const init = fetcher.mock.calls[0][1] as RequestInit
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-ant-test', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' })
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'claude-sonnet-5-5', system: 'sys', max_tokens: 1024 })
    expect(textOf(response.content)).toBe('checking')
    expect(toolUses(response.content)).toEqual([{ type: 'tool_use', id: 'tu1', name: 'list_notes', input: { folder: '70 Goals' } }])
  })

  it('surfaces the status on failure', async () => {
    const client = new AnthropicClient('bad', async () => new Response('{"error":"auth"}', { status: 401 }))
    await expect(client.createMessage({ model: 'm', messages: [] })).rejects.toMatchObject({ status: 401 })
  })

  it('calls the global fetch unbound, the way browsers require', async () => {
    // Browsers throw "illegal invocation" when fetch runs with `this` set to anything but the window.
    const strictFetch = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation")
      return Promise.resolve(new Response(JSON.stringify({ id: 'msg', stop_reason: 'end_turn', content: [] }), { status: 200 }))
    })
    vi.stubGlobal('fetch', strictFetch)
    try {
      const client = new AnthropicClient('sk-ant-test')
      await expect(client.createMessage({ model: 'm', messages: [] })).resolves.toMatchObject({ id: 'msg' })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
