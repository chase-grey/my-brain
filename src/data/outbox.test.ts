import { describe, expect, it, vi } from 'vitest'
import { MemoryOutboxStorage, Outbox } from './outbox'

describe('offline outbox', () => {
  it('keeps failed writes and removes confirmed writes', async () => {
    const storage = new MemoryOutboxStorage<string>()
    const outbox = new Outbox(storage)
    await outbox.enqueue('one', 'first')
    await outbox.enqueue('two', 'second')
    const send = vi.fn(async (value: string) => { if (value === 'second') throw new Error('offline') })
    expect(await outbox.flush(send)).toEqual({ sent: 1, pending: 1 })
    expect((await storage.list())[0]).toMatchObject({ id: 'two', attempts: 1 })
  })
})
