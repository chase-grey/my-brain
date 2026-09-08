import { describe, expect, it } from 'vitest'
import { makeSidecarEvent, parseEventLog, replaySidecar, serializeEventLog } from './sidecarEvents'

describe('sidecar event protocol', () => {
  it('round-trips jsonl and deterministically replays events', () => {
    const later = makeSidecarEvent('b', 1, 'taskMeta', 'task', 'set', { estimateMin: 30 }, '2026-09-01T10:00:00Z')
    const earlier = makeSidecarEvent('a', 1, 'taskMeta', 'task', 'set', { estimateMin: 60 }, '2026-09-01T09:00:00Z')
    const parsed = parseEventLog(serializeEventLog([later, earlier]))
    const result = replaySidecar(parsed)
    expect(result.state.taskMeta.task).toEqual({ estimateMin: 30 })
    expect(result.frontier).toEqual({ a: 1, b: 1 })
  })

  it('starts at a snapshot frontier, deduplicates, and retains future versions', () => {
    const event = makeSidecarEvent('a', 2, 'taskMeta', 'task', 'remove', undefined, '2026-09-02T00:00:00Z')
    const result = replaySidecar([event, event, { schemaVersion: 2 }], {
      schemaVersion: 1, createdAt: '2026-09-01T00:00:00Z', createdBy: 'a', frontier: { a: 1 },
      state: { taskMeta: { task: { estimateMin: 60 } } },
    })
    expect(result.state.taskMeta).toEqual({})
    expect(result.retainedUnknownVersions).toEqual([{ schemaVersion: 2 }])
  })
})
