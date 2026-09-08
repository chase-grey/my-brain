import { describe, expect, it, vi } from 'vitest'
import { WorkBridgeProvider } from './workBridgeProvider'

describe('work bridge provider', () => {
  it('maps localhost outlook tasks without exposing COM to the app', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ entryId: 'id', subject: 'ship', complete: false }]), { status: 200 }))
    await expect(new WorkBridgeProvider(undefined, fetcher).listTasks()).resolves.toEqual([{ id: 'id', domain: 'work', title: 'ship', completed: false }])
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:47321/tasks', expect.anything())
  })
})
