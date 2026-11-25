import { describe, expect, it, vi } from 'vitest'
import { WorkBridgeProvider } from './workBridgeProvider'

describe('work bridge provider', () => {
  it('maps localhost outlook tasks without exposing COM to the app', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ entryId: 'id', subject: 'ship', complete: false, dueDate: null, importance: 2, notes: 'before friday' }]), { status: 200 }))
    await expect(new WorkBridgeProvider(undefined, fetcher).listTasks()).resolves.toEqual([{
      id: 'id', providerListId: 'outlook', domain: 'work', title: 'ship', dueDate: undefined, completed: false, completedOn: undefined, important: true, notes: 'before friday',
    }])
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:47321/tasks', expect.anything())
  })

  it('reads work events for a span of days', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ events: [{ id: 'a', subject: 'standup', start: '2026-11-02T09:00:00', end: '2026-11-02T09:30:00', isAllDay: false, free: false }, { id: 'b', subject: 'hold', start: '2026-11-02T13:00:00', end: '2026-11-02T14:00:00', isAllDay: false, free: true }] }), { status: 200 }))
    await expect(new WorkBridgeProvider(undefined, fetcher).events('2026-11-02', '2026-11-09')).resolves.toEqual([
      { id: 'a', subject: 'standup', start: '2026-11-02T09:00:00', end: '2026-11-02T09:30:00', isAllDay: false, free: false },
      { id: 'b', subject: 'hold', start: '2026-11-02T13:00:00', end: '2026-11-02T14:00:00', isAllDay: false, free: true },
    ])
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:47321/calendar?start=2026-11-02&end=2026-11-09', expect.anything())
  })
})
