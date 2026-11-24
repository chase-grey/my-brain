import { describe, expect, it, vi } from 'vitest'
import type { GraphClient } from './graphClient'
import { MailGraphProvider } from './mailGraphProvider'

describe('inbox glance', () => {
  it('reads unread, total, and flagged counts without touching any message', async () => {
    const request = vi.fn(async (path: string, _init?: RequestInit) => path.includes('/messages')
      ? { value: [{ id: 'a' }, { id: 'b' }] }
      : { unreadItemCount: 12, totalItemCount: 40 })
    const counts = await new MailGraphProvider({ request } as unknown as GraphClient).inboxCounts()
    expect(counts).toEqual({ unread: 12, total: 40, flagged: 2 })
    for (const call of request.mock.calls) expect(call[1] ?? {}).not.toHaveProperty("method")
  })

  it('counts only flags on mail from the last thirty days', async () => {
    const request = vi.fn(async (path: string) => path.includes('/messages') ? { value: [] } : { unreadItemCount: 0, totalItemCount: 0 })
    await new MailGraphProvider({ request } as unknown as GraphClient).inboxCounts('2026-11-24T12:00:00.000Z')
    const query = new URL(`https://x${request.mock.calls.find((call) => call[0].includes('/messages'))![0]}`).searchParams
    expect(query.get('$filter')).toBe("flag/flagStatus eq 'flagged' and receivedDateTime ge 2026-10-25T12:00:00.000Z")
  })
})
