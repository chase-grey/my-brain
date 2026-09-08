import type { OneDriveSidecar } from './oneDriveSidecar'
import { makeSidecarEvent, parseEventLog, replaySidecar, serializeEventLog, type ReplayResult, type SidecarEvent } from './sidecarEvents'

const deviceKey = 'my-brain.personal.device-id.v1'
const sequenceKey = 'my-brain.personal.device-sequence.v1'

export class RemoteEventLog {
  constructor(private readonly sidecar: OneDriveSidecar, private readonly storage: Storage = localStorage) {}

  deviceId(): string {
    const existing = this.storage.getItem(deviceKey)
    if (existing) return existing
    const created = crypto.randomUUID()
    this.storage.setItem(deviceKey, created)
    return created
  }

  async append(entityType: string, entityId: string, op: SidecarEvent['op'], value?: unknown): Promise<SidecarEvent> {
    const deviceId = this.deviceId()
    let event: SidecarEvent | undefined
    const write = async () => {
      const seq = Number(this.storage.getItem(sequenceKey) ?? 0) + 1
      event = makeSidecarEvent(deviceId, seq, entityType, entityId, op, value)
      await this.sidecar.ensureFolder('events')
      const path = `events/${deviceId}.jsonl`
      const current = await this.sidecar.readText(path)
      const events = current ? parseEventLog(current).filter((item): item is SidecarEvent => (item as SidecarEvent).schemaVersion === 1) : []
      await this.sidecar.writeText(path, serializeEventLog([...events, event]))
      this.storage.setItem(sequenceKey, String(seq))
    }
    if (navigator.locks) await navigator.locks.request(`my-brain-events-${deviceId}`, write)
    else await write()
    if (!event) throw new Error('sidecar event was not written')
    return event
  }

  async replay(): Promise<ReplayResult> {
    const files = await this.sidecar.listFiles('events')
    const logs = await Promise.all(files.filter((name) => name.endsWith('.jsonl')).map((name) => this.sidecar.readText(`events/${name}`)))
    return replaySidecar(logs.flatMap((contents) => contents ? parseEventLog(contents) : []))
  }
}
