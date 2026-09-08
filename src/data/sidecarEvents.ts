export type SidecarEvent = {
  schemaVersion: 1
  eventId: string
  deviceId: string
  seq: number
  occurredAt: string
  entityType: string
  entityId: string
  op: 'set' | 'remove'
  value?: unknown
}

export type SidecarSnapshot = {
  schemaVersion: 1
  createdAt: string
  createdBy: string
  frontier: Record<string, number>
  state: SidecarState
}

export type SidecarState = Record<string, Record<string, unknown>>

export type ReplayResult = {
  state: SidecarState
  frontier: Record<string, number>
  retainedUnknownVersions: unknown[]
}

export function parseEventLog(contents: string): unknown[] {
  return contents.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as unknown)
}

export function serializeEventLog(events: SidecarEvent[]): string {
  return events.map((event) => JSON.stringify(event)).join('\n') + (events.length ? '\n' : '')
}

export function replaySidecar(events: unknown[], snapshot?: SidecarSnapshot): ReplayResult {
  const state = structuredClone(snapshot?.state ?? {})
  const frontier = { ...snapshot?.frontier }
  const retainedUnknownVersions: unknown[] = []
  const known: SidecarEvent[] = []
  const seen = new Set<string>()

  for (const candidate of events) {
    if (!isSidecarEvent(candidate)) {
      retainedUnknownVersions.push(candidate)
      continue
    }
    if (candidate.seq <= (frontier[candidate.deviceId] ?? 0) || seen.has(candidate.eventId)) continue
    seen.add(candidate.eventId)
    known.push(candidate)
  }

  known.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.deviceId.localeCompare(b.deviceId) || a.seq - b.seq)
  for (const event of known) {
    const entities = state[event.entityType] ??= {}
    if (event.op === 'remove') delete entities[event.entityId]
    else entities[event.entityId] = event.value
    frontier[event.deviceId] = Math.max(frontier[event.deviceId] ?? 0, event.seq)
  }
  return { state, frontier, retainedUnknownVersions }
}

export function makeSidecarEvent(
  deviceId: string,
  seq: number,
  entityType: string,
  entityId: string,
  op: SidecarEvent['op'],
  value?: unknown,
  occurredAt = new Date().toISOString(),
): SidecarEvent {
  return { schemaVersion: 1, eventId: `${deviceId}:${seq}`, deviceId, seq, occurredAt, entityType, entityId, op, value }
}

function isSidecarEvent(value: unknown): value is SidecarEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<SidecarEvent>
  return event.schemaVersion === 1 && typeof event.eventId === 'string' && typeof event.deviceId === 'string'
    && typeof event.seq === 'number' && typeof event.occurredAt === 'string' && typeof event.entityType === 'string'
    && typeof event.entityId === 'string' && (event.op === 'set' || event.op === 'remove')
}
