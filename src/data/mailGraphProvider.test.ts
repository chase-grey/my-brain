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
})
