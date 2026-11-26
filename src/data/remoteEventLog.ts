import type { OneDriveSidecar } from './oneDriveSidecar'
import { makeSidecarEvent, parseEventLog, replaySidecar, serializeEventLog, type ReplayResult, type SidecarEvent } from './sidecarEvents'

const deviceKey = 'my-brain.personal.device-id.v1'
const sequenceKey = 'my-brain.personal.device-sequence.v1'

export type EventEntry = {
  entityType: string
  entityId: string
  op: SidecarEvent['op']
  value?: unknown
  /** When the change was made, when that was before now: something written with no connection. */
  occurredAt?: string
}

/**
 * This device's log holds one event for each thing it has changed: the newest. An older event from the same
 * device for the same thing can never win a replay, so it is dropped as the newer one is written, and the file
 * stays the size of what the device has touched, not of how often.
 */
export function compactLog(events: SidecarEvent[], keep: (event: SidecarEvent) => boolean = () => true): SidecarEvent[] {
  const newest = new Map<string, SidecarEvent>()
  for (const event of events) {
    const key = `${event.entityType}\n${event.entityId}`
    const held = newest.get(key)
    // The order a replay uses, so what is dropped here is exactly what a replay would have passed over.
    if (!held || held.occurredAt < event.occurredAt || (held.occurredAt === event.occurredAt && held.seq < event.seq)) newest.set(key, event)
  }
  return [...newest.values()].filter(keep).sort((a, b) => a.seq - b.seq)
}

export class RemoteEventLog {
  constructor(private readonly sidecar: OneDriveSidecar, private readonly storage: Storage = localStorage) {}

  deviceId(): string {
    const existing = this.storage.getItem(deviceKey)
    if (existing) return existing
    const created = crypto.randomUUID()
    this.storage.setItem(deviceKey, created)
    return created
  }

  /**
   * Writes every entry in one read and one write of this device's log, however many there are. The folder is
   * made by the write itself: asking OneDrive for it first is refused on a personal account, which once
   * stopped every change from leaving the device. `keep` says which of the log's events still matter.
   */
  async append(entries: EventEntry[], keep?: (event: SidecarEvent) => boolean): Promise<SidecarEvent[]> {
    if (!entries.length) return []
    const deviceId = this.deviceId()
    let written: SidecarEvent[] = []
    const write = async () => {
      const path = `events/${deviceId}.jsonl`
      const current = await this.sidecar.readText(path)
      const events = current ? parseEventLog(current).filter((item): item is SidecarEvent => (item as SidecarEvent).schemaVersion === 1) : []
      // The count on the device can be behind the file, after storage was cleared; a number already used would be skipped on replay.
      const last = Math.max(Number(this.storage.getItem(sequenceKey) ?? 0), ...events.map((event) => event.seq))
      const added = entries.map((entry, index) => makeSidecarEvent(deviceId, last + index + 1, entry.entityType, entry.entityId, entry.op, entry.value, entry.occurredAt))
      await this.sidecar.writeText(path, serializeEventLog(compactLog([...events, ...added], keep)))
      this.storage.setItem(sequenceKey, String(last + added.length))
      written = added
    }
    if (navigator.locks) await navigator.locks.request(`my-brain-events-${deviceId}`, write)
    else await write()
    return written
  }

  async replay(): Promise<ReplayResult> {
    const files = await this.sidecar.listFiles('events')
    const logs = await Promise.all(files.filter((name) => name.endsWith('.jsonl')).map((name) => this.sidecar.readText(`events/${name}`)))
    return replaySidecar(logs.flatMap((contents) => contents ? parseEventLog(contents) : []))
  }
}
