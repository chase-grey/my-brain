import { describe, expect, it, vi } from 'vitest'
import type { GraphClient } from './graphClient'
import { MailGraphProvider } from './mailGraphProvider'

describe('inbox glance', () => {
  const filters = (request: { mock: { calls: unknown[][] } }) => request.mock.calls.map((call) => new URL(`https://x${call[0]}`).searchParams.get('$filter'))

  it('counts conversations that are flagged, important, or sorted as needing a reply or an action, without touching any message', async () => {
    const request = vi.fn(async (path: string, _init?: RequestInit) => {
      const filter = new URL(`https://x${path}`).searchParams.get('$filter')!
      if (filter.startsWith('flag/')) return { value: [{ id: 'a', conversationId: 'one' }, { id: 'b', conversationId: 'two' }] }
      if (filter.startsWith('importance')) return { value: [{ id: 'a', conversationId: 'one' }] }
      if (filter.includes("'reply'")) return { value: [{ id: 'c', conversationId: 'two' }, { id: 'd', conversationId: 'three' }] }
      return { value: [{ id: 'd', conversationId: 'three' }] }
    })
    const counts = await new MailGraphProvider({ request } as unknown as GraphClient).inboxCounts()
    expect(counts).toEqual({ needsMe: 3 })
    for (const call of request.mock.calls) {
      expect(call[0]).toContain('/me/mailFolders/inbox/messages')
      expect(call[1] ?? {}).not.toHaveProperty('method')
    }
  })

  it('looks only at mail from the last thirty days, and never counts unread or waiting mail', async () => {
    const request = vi.fn(async (_path: string) => ({ value: [] }))
    const counts = await new MailGraphProvider({ request } as unknown as GraphClient).inboxCounts('2026-11-24T12:00:00.000Z')
    expect(counts).toEqual({ needsMe: 0 })
    expect(filters(request)).toEqual([
      "flag/flagStatus eq 'flagged' and receivedDateTime ge 2026-10-25T12:00:00.000Z",
      "importance eq 'high' and receivedDateTime ge 2026-10-25T12:00:00.000Z",
      "categories/any(c:c eq 'reply') and receivedDateTime ge 2026-10-25T12:00:00.000Z",
      "categories/any(c:c eq 'action') and receivedDateTime ge 2026-10-25T12:00:00.000Z",
    ])
  })
})
