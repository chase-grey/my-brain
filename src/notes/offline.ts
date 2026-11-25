import type { VaultNote, VaultStore } from '../companion/githubVault'
import { keepOps, keepUnsaved, loadOps, loadUnsaved, mergeNote, notesFolder, type NoteOp } from './notes'

// Notes with no connection. The device keeps a copy of every note under `notes/` (the mirror), so the list and
// any note open without the vault. What is written, renamed, moved or deleted while the vault cannot be reached
// waits on the device and is sent, in order, the next time it can.

type Remote = VaultStore & { invalidate?: () => void }

export type Mirrored = { path: string; sha: string; content: string }

export interface NoteMirror {
  list(): Promise<VaultNote[] | undefined>
  saveList(notes: VaultNote[]): Promise<void>
  get(path: string): Promise<Mirrored | undefined>
  put(note: Mirrored): Promise<void>
  remove(path: string): Promise<void>
  shas(): Promise<Map<string, string>>
}

export class MemoryMirror implements NoteMirror {
  private notes?: VaultNote[]
  readonly files = new Map<string, Mirrored>()
  async list() { return this.notes }
  async saveList(notes: VaultNote[]) { this.notes = notes }
  async get(path: string) { return this.files.get(path) }
  async put(note: Mirrored) { this.files.set(note.path, note) }
  async remove(path: string) { this.files.delete(path) }
  async shas() { return new Map([...this.files.values()].map((note) => [note.path, note.sha])) }
}

export class IndexedDbMirror implements NoteMirror {
  constructor(private readonly databaseName = 'my-brain.personal.notes') {}

  async list() { return await this.run<VaultNote[] | undefined>('meta', 'readonly', (store) => store.get('list')) }
  async saveList(notes: VaultNote[]) { await this.run('meta', 'readwrite', (store) => store.put(notes, 'list')) }
  async get(path: string) { return await this.run<Mirrored | undefined>('files', 'readonly', (store) => store.get(path)) }
  async put(note: Mirrored) { await this.run('files', 'readwrite', (store) => store.put(note)) }
  async remove(path: string) { await this.run('files', 'readwrite', (store) => store.delete(path)) }
  async shas() {
    const all = await this.run<Mirrored[]>('files', 'readonly', (store) => store.getAll())
    return new Map(all.map((note) => [note.path, note.sha]))
  }

  private async run<R>(name: 'files' | 'meta', mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<R> {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('files', { keyPath: 'path' })
        request.result.createObjectStore('meta')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return await new Promise<R>((resolve, reject) => {
      const transaction = database.transaction(name, mode)
      const request = operation(transaction.objectStore(name))
      request.onsuccess = () => resolve(request.result as R)
      request.onerror = () => reject(request.error)
      transaction.oncomplete = () => database.close()
      transaction.onerror = () => reject(transaction.error)
    })
  }
}

const status = (error: unknown) => (error as { status?: unknown } | undefined)?.status

/** The vault could not be reached at all, as against it answering no. A server that is down counts. */
export function unreachable(error: unknown): boolean {
  const code = status(error)
  return typeof code !== 'number' || code >= 500
}

const notThere = (error: unknown) => status(error) === 404
const noNote = (path: string) => Object.assign(new Error(`no note at ${path}`), { status: 404 })
const deviceOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer')), ms)
    work.then((value) => { clearTimeout(timer); resolve(value) }, (error: unknown) => { clearTimeout(timer); reject(error) })
  })
}

/** How many notes are fetched at once when the device's copy is brought up to date. */
const fillAtOnce = 3

/** The vault, with the device's copy standing in whenever the vault cannot be reached. */
export class OfflineVault implements VaultStore {
  /** The last list or note came from this device, not the vault. */
  offline = false
  private filling = false

  constructor(readonly remote: Remote, readonly mirror: NoteMirror, private readonly waitMs = 8000, private readonly sendMs = 30000) {}

  invalidate(): void {
    this.remote.invalidate?.()
  }

  /** Asks the vault. With a copy on the device, a vault that does not answer in time is not waited on. */
  private async reach<T>(ask: () => Promise<T>, kept: T | undefined): Promise<{ value: T; fresh: boolean }> {
    try {
      if (kept !== undefined && deviceOffline()) throw new Error('offline')
      const value = await (kept === undefined ? ask() : within(ask(), this.waitMs))
      this.offline = false
      return { value, fresh: true }
    } catch (error) {
      if (!unreachable(error)) throw error
      this.offline = true
      if (kept === undefined) throw error
      return { value: kept, fresh: false }
    }
  }

  async listNotes(): Promise<VaultNote[]> {
    const kept = await this.mirror.list().catch(() => undefined)
    const { value, fresh } = await this.reach(() => this.remote.listNotes(), kept)
    if (fresh) {
      await this.mirror.saveList(value).catch(() => {})
      void this.fill(value)
    }
    return value
  }

  async readNote(path: string): Promise<{ content: string; sha: string }> {
    const kept = await this.mirror.get(path).catch(() => undefined)
    // A note renamed or moved here and not yet in the vault is read from the device: the vault has no such file yet.
    if (kept && loadOps().some((op) => op.kind === 'move' && op.to === path)) return { content: kept.content, sha: kept.sha }
    try {
      const { value, fresh } = await this.reach(() => this.remote.readNote(path), kept && { content: kept.content, sha: kept.sha })
      if (fresh) await this.mirror.put({ path, content: value.content, sha: value.sha || kept?.sha || '' }).catch(() => {})
      return value
    } catch (error) {
      if (!unreachable(error)) throw error
      // Not on the device and not in the last list seen: as far as anyone here knows, it is a new note.
      const list = await this.mirror.list().catch(() => undefined)
      if (list && !list.some((note) => note.path === path)) throw noNote(path)
      throw error
    }
  }

  async writeNote(path: string, content: string): Promise<{ sha: string }> {
    const result = await within(this.remote.writeNote(path, content), this.sendMs)
    await this.keep(path, content, result.sha).catch(() => {})
    return result
  }

  async appendNote(path: string, text: string): Promise<{ sha: string }> {
    const result = await this.remote.appendNote(path, text)
    await this.mirror.remove(path).catch(() => {})
    return result
  }

  async deleteNote(path: string): Promise<void> {
    await this.remote.deleteNote(path)
    await this.forget(path).catch(() => {})
  }

  private async keep(path: string, content: string, sha: string): Promise<void> {
    await this.mirror.put({ path, content, sha })
    const list = await this.mirror.list()
    if (list) await this.mirror.saveList([...list.filter((note) => note.path !== path), { path, sha }])
  }

  /** Takes a note off the device's copy only. */
  async forget(path: string): Promise<void> {
    await this.mirror.remove(path)
    const list = await this.mirror.list()
    if (list) await this.mirror.saveList(list.filter((note) => note.path !== path))
  }

  /** Renames a note on the device's copy only. */
  async moveLocal(from: string, to: string): Promise<void> {
    const note = await this.mirror.get(from)
    if (note) await this.mirror.put({ ...note, path: to })
    await this.mirror.remove(from)
    const list = await this.mirror.list()
    if (list) await this.mirror.saveList(list.some((item) => item.path === to) ? list.filter((item) => item.path !== from) : list.map((item) => item.path === from ? { ...item, path: to } : item))
  }

  /** Brings the device's copy up to the list just read: fetches what is new or changed, drops what is gone. */
  private async fill(notes: VaultNote[]): Promise<void> {
    if (this.filling) return
    this.filling = true
    try {
      const wanted = notes.filter((note) => note.path.startsWith(`${notesFolder}/`))
      const have = await this.mirror.shas()
      const held = new Set(loadOps().map((op) => op.kind === 'move' ? op.to : ''))
      const paths = new Set(wanted.map((note) => note.path))
      for (const path of have.keys()) if (!paths.has(path) && !held.has(path)) await this.mirror.remove(path)
      const todo = wanted.filter((note) => have.get(note.path) !== note.sha)
      let stopped = false
      await Promise.all(Array.from({ length: fillAtOnce }, async () => {
        for (let note = todo.shift(); note && !stopped; note = todo.shift()) {
          try {
            const { content } = await this.remote.readNote(note.path)
            await this.mirror.put({ path: note.path, sha: note.sha, content })
          } catch (error) {
            if (unreachable(error)) stopped = true
          }
        }
      }))
    } catch {
      // The next list tries again.
    } finally {
      this.filling = false
    }
  }

  /** Sends one waiting rename, move or delete. A note that is no longer in the vault has nothing left to do. */
  async send(op: NoteOp): Promise<void> {
    this.invalidate()
    const list = await within(this.remote.listNotes(), this.sendMs)
    const has = (path: string) => list.some((note) => note.path === path)
    if (op.kind === 'delete') {
      if (has(op.path)) await within(this.remote.deleteNote(op.path), this.sendMs)
      return
    }
    if (!has(op.from)) return
    const { content } = await within(this.remote.readNote(op.from), this.sendMs)
    // A note already at the new name is not written over: both are kept, the moved one first.
    const there = has(op.to) ? (await within(this.remote.readNote(op.to), this.sendMs)).content : undefined
    await this.writeNote(op.to, there === undefined ? content : mergeNote('', content, there))
    await within(this.remote.deleteNote(op.from), this.sendMs)
  }
}

const vaults = new WeakMap<object, OfflineVault>()

/** The offline vault over this one. The same vault always gets the same one back. */
export function offlineNotes(remote: Remote): OfflineVault {
  if (remote instanceof OfflineVault) return remote
  let vault = vaults.get(remote)
  if (!vault) {
    vault = new OfflineVault(remote, typeof indexedDB === 'undefined' ? new MemoryMirror() : new IndexedDbMirror())
    vaults.set(remote, vault)
  }
  return vault
}

/** Notes open on screen. Each saves itself, so a sync leaves them alone. */
export const openNotes = new Set<string>()

export type SyncState = { waiting: number; offline: boolean; sent: number }

export const waitingCount = () => loadOps().length + Object.keys(loadUnsaved()).filter((path) => !openNotes.has(path)).length

let running: Promise<SyncState> | undefined

/** Sends everything that is waiting on the device: renames, moves and deletes in the order they were made, then what was written. */
export function syncNotes(vault: OfflineVault): Promise<SyncState> {
  running ??= sync(vault).finally(() => { running = undefined })
  return running
}

async function sync(vault: OfflineVault): Promise<SyncState> {
  let offline = false
  let sent = 0
  if (!waitingCount()) return { waiting: 0, offline: vault.offline, sent }
  let blocked = false
  for (let op = loadOps()[0]; op; op = loadOps()[0]) {
    try {
      await vault.send(op)
    } catch (error) {
      if (!notThere(error)) {
        offline = unreachable(error)
        blocked = true
        break
      }
    }
    keepOps(loadOps().slice(1))
    sent += 1
  }
  // What was written waits behind the moves: a note's words must not land at a name its move has not reached yet.
  if (!blocked) {
    for (const [path, entry] of Object.entries(loadUnsaved())) {
      if (openNotes.has(path)) continue
      try {
        const theirs = await within(vault.remote.readNote(path), 30000).then(({ content }) => content, (error: unknown) => { if (notThere(error)) return ''; throw error })
        const content = mergeNote(entry.base, entry.content, theirs)
        if (content !== theirs) await vault.writeNote(path, content)
        if (loadUnsaved()[path]?.content === entry.content && !openNotes.has(path)) keepUnsaved(path, undefined)
        sent += 1
      } catch (error) {
        if (unreachable(error)) {
          offline = true
          break
        }
      }
    }
  }
  if (sent) vault.invalidate()
  return { waiting: waitingCount(), offline, sent }
}

/** Deletes a note here at once; the vault follows when it can be reached. */
export async function removeNote(vault: OfflineVault, path: string): Promise<void> {
  keepUnsaved(path, undefined)
  keepOps([...loadOps(), { kind: 'delete', path }])
  await vault.forget(path).catch(() => {})
}

/** Renames or moves a note here at once, unsaved words with it; the vault follows when it can be reached. */
export async function moveNote(vault: OfflineVault, from: string, to: string): Promise<void> {
  const unsaved = loadUnsaved()[from]
  if (unsaved) {
    keepUnsaved(to, unsaved)
    keepUnsaved(from, undefined)
  }
  keepOps([...loadOps(), { kind: 'move', from, to }])
  await vault.moveLocal(from, to).catch(() => {})
}
