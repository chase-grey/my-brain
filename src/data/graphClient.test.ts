import { describe, expect, it, vi } from 'vitest'
import { GraphClient, GraphError } from './graphClient'

describe('graph client', () => {
  it('authenticates requests and follows collection pagination', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: [{ id: 'one' }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ value: [{ id: 'two' }] }), { status: 200 }))
    const client = new GraphClient(async () => 'token', fetcher)

    await expect(client.collection<{ id: string }>('/items')).resolves.toEqual([{ id: 'one' }, { id: 'two' }])
    expect(fetcher).toHaveBeenNthCalledWith(1, 'https://graph.microsoft.com/v1.0/items', expect.objectContaining({
      headers: expect.any(Headers),
    }))
    const firstHeaders = fetcher.mock.calls[0][1]?.headers as Headers
    expect(firstHeaders.get('Authorization')).toBe('Bearer token')
    expect(fetcher.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/next')
  })

  it('returns graph response details on failure', async () => {
    const client = new GraphClient(async () => 'token', async () => new Response('denied', { status: 403 }))

    await expect(client.request('/items')).rejects.toEqual(new GraphError(403, 'denied'))
  })
})
