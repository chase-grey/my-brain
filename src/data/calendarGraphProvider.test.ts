import { describe, expect, it, vi } from 'vitest'
import { GraphError, type GraphClient } from './graphClient'
import { CalendarGraphProvider } from './calendarGraphProvider'

const event = (id: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  id, subject: 'basement', start: { dateTime: `${start}.0000000`, timeZone: 'America/Chicago' }, end: { dateTime: `${end}.0000000`, timeZone: 'America/Chicago' }, ...extra,
})

describe('personal calendar provider', () => {
  it('writes a busy reserved block in the local time zone and returns its id', async () => {
    const graph = { request: vi.fn().mockResolvedValue(event('event', '2026-09-05T13:00:00', '2026-09-05T16:00:00')) } as unknown as GraphClient
    const block = await new CalendarGraphProvider(graph, 'America/Chicago').createReservedBlock('basement', '2026-09-05T13:00:00', '2026-09-05T16:00:00')
    expect(block).toMatchObject({ id: 'event', start: '2026-09-05T13:00:00', end: '2026-09-05T16:00:00', isAllDay: false })
    const [path, init] = (graph.request as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(path).toBe('/me/events')
    expect(JSON.parse(init.body as string)).toMatchObject({ showAs: 'busy', start: { timeZone: 'America/Chicago' } })
  })

  it('reads a window of events in local time and drops cancelled ones', async () => {
    const graph = { collection: vi.fn().mockResolvedValue([event('a', '2026-11-02T18:00:00', '2026-11-02T19:00:00'), event('b', '2026-11-02T20:00:00', '2026-11-02T21:00:00', { isCancelled: true })]) } as unknown as GraphClient
    const blocks = await new CalendarGraphProvider(graph, 'America/Chicago').events('2026-11-02T00:00:00', '2026-11-03T00:00:00')
    expect(blocks.map((block) => block.id)).toEqual(['a'])
    const [path, init] = (graph.collection as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    expect(path).toContain('/me/calendarView?')
    expect(new Headers(init.headers).get('Prefer')).toBe('outlook.timezone="America/Chicago"')
  })

  it('treats a deleted event as missing instead of failing', async () => {
    const graph = { request: vi.fn().mockRejectedValue(new GraphError(404, 'gone')) } as unknown as GraphClient
    const provider = new CalendarGraphProvider(graph, 'America/Chicago')
    await expect(provider.event('missing')).resolves.toBeUndefined()
    await expect(provider.deleteEvent('missing')).resolves.toBeUndefined()
  })
})
