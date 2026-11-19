import type { VaultStore } from '../companion/githubVault'
import { mergePackingText } from './packing'
import { readIfExists, type TripOverview } from './trip'

// Packing happens on planes and in basements, so every list the screens show is kept on the
// device and edits are saved there first. Unsent edits are pushed when the vault is reachable;
// if the note changed on the other side meanwhile, the two are merged item by item (packing.ts)
// and nothing is ever asked.

type Entry = { content: string; base?: string; dirty?: boolean }
type Cache = { notes: Record<string, Entry>; overview?: TripOverview }
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export const tripCacheKey = 'my-brain.personal.trips.v1'

export class PackingSync {
  private cache: Cache
  private flushing: Promise<void> = Promise.resolve()

  constructor(private readonly vault: VaultStore, private readonly storage?: StorageLike, private readonly key = tripCacheKey) {
    this.cache = this.load()
  }

  private load(): Cache {
    try {
      const stored = JSON.parse(this.storage?.getItem(this.key) ?? '{}') as Partial<Cache>
      return { notes: stored.notes && typeof stored.notes === 'object' ? stored.notes : {}, overview: stored.overview }
    } catch {
      return { notes: {} }
    }
  }

  private persist(): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.cache))
    } catch {
      // Storage can be full or unavailable; the copy in memory still serves this session.
    }
  }

  cached(path: string): string | undefined {
    return this.cache.notes[path]?.content
  }

  overview(): TripOverview | undefined {
    return this.cache.overview
  }

  setOverview(overview: TripOverview): void {
    this.cache.overview = overview
    this.persist()
  }

  pending(): string[] {
    return Object.keys(this.cache.notes).filter((path) => this.cache.notes[path].dirty)
  }

  /** Save an edit on the device. It reaches the vault on the next flush. */
  save(path: string, content: string): void {
    const entry = this.cache.notes[path]
    if (entry && entry.content === content) return
    this.cache.notes[path] = { ...entry, content, dirty: true }
    this.persist()
  }

  forget(path: string): void {
    delete this.cache.notes[path]
    this.persist()
  }

  /** The vault's copy with any unsent edits merged in; undefined when the note exists nowhere. */
  async refresh(path: string): Promise<string | undefined> {
    const remote = await readIfExists(this.vault, path)
    const entry = this.cache.notes[path]
    if (!entry?.dirty) {
      if (remote === undefined) delete this.cache.notes[path]
      else this.cache.notes[path] = { content: remote, base: remote }
      this.persist()
      return remote
    }
    if (remote !== undefined && remote !== entry.base) {
      this.cache.notes[path] = { content: mergePackingText(entry.base, entry.content, remote), base: remote, dirty: true }
      this.persist()
    }
    return this.cache.notes[path].content
  }

  /** Push every unsent edit. Runs one at a time; a failure leaves the edit waiting and rejects. */
  flush(): Promise<void> {
    const run = this.flushing.then(() => this.flushAll())
    this.flushing = run.catch(() => undefined)
    return run
  }

  private async flushAll(): Promise<void> {
    for (const path of this.pending()) await this.flushOne(path)
  }

  private async flushOne(path: string): Promise<void> {
    const sent = this.cache.notes[path]
    if (!sent?.dirty) return
    const remote = await readIfExists(this.vault, path)
    const merged = remote === undefined || remote === sent.base ? sent.content : mergePackingText(sent.base, sent.content, remote)
    if (merged !== remote) await this.vault.writeNote(path, merged)
    const now = this.cache.notes[path]
    if (!now) return
    // Edits made while the write was in flight stay unsent, rebased onto what the vault now holds.
    if (now.content === sent.content) this.cache.notes[path] = { content: merged, base: merged }
    else this.cache.notes[path] = { content: merged === sent.content ? now.content : mergePackingText(sent.content, now.content, merged), base: merged, dirty: true }
    this.persist()
  }
}
