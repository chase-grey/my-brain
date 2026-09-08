import type { Domain } from '../domain/types'

export type OutboxEntry<T> = {
  id: string
  payload: T
  attempts: number
  createdAt: string
}

export interface OutboxStorage<T> {
  list(): Promise<OutboxEntry<T>[]>
  put(entry: OutboxEntry<T>): Promise<void>
  remove(id: string): Promise<void>
}

export class MemoryOutboxStorage<T> implements OutboxStorage<T> {
  private readonly entries = new Map<string, OutboxEntry<T>>()
  async list(): Promise<OutboxEntry<T>[]> { return [...this.entries.values()] }
  async put(entry: OutboxEntry<T>): Promise<void> { this.entries.set(entry.id, entry) }
  async remove(id: string): Promise<void> { this.entries.delete(id) }
}

export class IndexedDbOutboxStorage<T> implements OutboxStorage<T> {
  private readonly databaseName: string
  constructor(domain: Domain, private readonly storeName = 'outbox') {
    this.databaseName = `my-brain.${domain}`
  }

  async list(): Promise<OutboxEntry<T>[]> {
    return await this.transaction('readonly', (store) => store.getAll())
  }

  async put(entry: OutboxEntry<T>): Promise<void> {
    await this.transaction('readwrite', (store) => store.put(entry))
  }

  async remove(id: string): Promise<void> {
    await this.transaction('readwrite', (store) => store.delete(id))
  }

  private async database(): Promise<IDBDatabase> {
    return await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(this.storeName)) request.result.createObjectStore(this.storeName, { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private async transaction<R>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> {
    const database = await this.database()
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(this.storeName, mode)
      const request = operation(transaction.objectStore(this.storeName))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => database.close()
      transaction.onerror = () => reject(transaction.error)
    })
  }
}

export class Outbox<T> {
  constructor(private readonly storage: OutboxStorage<T>) {}

  async enqueue(id: string, payload: T): Promise<void> {
    await this.storage.put({ id, payload, attempts: 0, createdAt: new Date().toISOString() })
  }

  async flush(send: (payload: T) => Promise<void>): Promise<{ sent: number; pending: number }> {
    let sent = 0
    for (const entry of await this.storage.list()) {
      try {
        await send(entry.payload)
        await this.storage.remove(entry.id)
        sent += 1
      } catch {
        await this.storage.put({ ...entry, attempts: entry.attempts + 1 })
      }
    }
    return { sent, pending: (await this.storage.list()).length }
  }
}
