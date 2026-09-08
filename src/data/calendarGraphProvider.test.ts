import { describe, expect, it, vi } from 'vitest'
import type { GraphClient } from './graphClient'
import { CalendarGraphProvider } from './calendarGraphProvider'

describe('personal calendar provider', () => {
  it('writes a busy reserved block and returns its id', async () => {
    const graph = { request: vi.fn().mockResolvedValue({ id: 'event', subject: 'basement', start: { dateTime: '2026-09-05T13:00:00', timeZone: 'Central Standard Time' }, end: { dateTime: '2026-09-05T16:00:00', timeZone: 'Central Standard Time' } }) } as unknown as GraphClient
    const block = await new CalendarGraphProvider(graph).createReservedBlock('basement', '2026-09-05T13:00:00', '2026-09-05T16:00:00', 'Central Standard Time')
    expect(block.id).toBe('event')
    expect(graph.request).toHaveBeenCalledWith('/me/events', expect.objectContaining({ method: 'POST' }))
  })
})
