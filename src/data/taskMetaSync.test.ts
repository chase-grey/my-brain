import { describe, expect, it } from 'vitest'
import type { Task, TaskMeta } from '../domain/types'
import { mergePersonalTasks } from './personalTaskSync'
import { compactLog, RemoteEventLog } from './remoteEventLog'
import type { OneDriveSidecar } from './oneDriveSidecar'
import { parseEventLog, replaySidecar, type SidecarEvent } from './sidecarEvents'
import { afterSending, changedIds, keepsRecord, metaSnapshot, reconcileMeta, waitingEntries } from './taskMetaSync'

const now = '2026-11-25T18:00:00.000Z'

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    id, taskId: id, providerListId: 'list', domain: 'personal', title: id, completed: false, createdAt: '2026-11-20T09:00:00Z',
    estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: false, ...over,
  }
}
const sorted = (id: string, over: Partial<Task> = {}) => task(id, { metadataComplete: true, estimateMin: 45, ...over })
const record = (id: string, over: Partial<TaskMeta> = {}): TaskMeta => ({ taskId: id, domain: 'personal', estimateMin: 60, originalEstimateMin: 60, priority: 2, energy: 'deep', pinned: false, carries: 0, metadataComplete: true, ...over })
const provider = (tasks: Task[]) => tasks.map(({ id, providerListId, domain, title, completed, createdAt }) => ({ id, providerListId, domain, title, completed, createdAt }))

/** A OneDrive app folder in memory, as a personal account behaves: a folder cannot be asked for, a write makes it. */
function drive() {
  const files = new Map<string, string>()
  const calls = { reads: 0, writes: 0 }
  let down = false
  const sidecar = {
    readText: async (path: string) => { if (down) throw new Error('offline'); calls.reads += 1; return files.get(path) },
    writeText: async (path: string, contents: string) => { if (down) throw new Error('offline'); calls.writes += 1; files.set(path, contents) },
    ensureFolder: async () => { throw new Error('microsoft graph returned 400 for POST /me/drive/special/approot/children: invalidRequest') },
    listFiles: async (folder: string) => [...files.keys()].filter((path) => path.startsWith(`${folder}/`)).map((path) => path.slice(folder.length + 1)),
  } as unknown as OneDriveSidecar
  return { sidecar, files, calls, cut: (value: boolean) => { down = value } }
}

function memory(): Storage {
  const held = new Map<string, string>()
  return { getItem: (key: string) => held.get(key) ?? null, setItem: (key: string, value: string) => { held.set(key, value) }, removeItem: (key: string) => { held.delete(key) } } as unknown as Storage
}

/** One device: its tasks, what is waiting, and its log on the shared drive. The steps are the ones App.tsx takes. */
function device(shared: ReturnType<typeof drive>, tasks: Task[]) {
  const log = new RemoteEventLog(shared.sidecar, memory())
  let waiting: Record<string, string> = {}
  let base = metaSnapshot(tasks)
  const send = async () => {
    const sent = waiting
    await log.append(waitingEntries(sent, tasks))
    waiting = afterSending(waiting, sent, tasks)
  }
  return {
    tasks: () => tasks,
    toSort: () => tasks.filter((item) => item.metadataComplete === false && !item.completed).map((item) => item.id),
    async change(next: Task[], at: string) {
      for (const id of changedIds(base, next)) waiting[id] = at
      tasks = next
      base = metaSnapshot(next)
      await send().catch(() => undefined)
    },
    async sync(inToDo: Task[], at = now) {
      const replay = await log.replay()
      const { metadata, unsent } = reconcileMeta(Object.values(replay.state.taskMeta ?? {}) as TaskMeta[], tasks, waiting, at)
      tasks = mergePersonalTasks(provider(inToDo), metadata, tasks, at)
      base = metaSnapshot(tasks)
      waiting = { ...Object.fromEntries(unsent.map((id) => [id, at])), ...waiting }
      await send()
    },
  }
}

describe('a sorted task on every device', () => {
  const inToDo = [task('a'), task('b'), task('c')]

  it('shows as sorted on the phone once it was sorted on the computer', async () => {
    const shared = drive()
    const computer = device(shared, inToDo)
    const phone = device(shared, inToDo)
    await computer.change([sorted('a'), sorted('b'), task('c')], '2026-11-25T17:00:00.000Z')
    await phone.sync(inToDo)
    expect(phone.toSort()).toEqual(['c'])
    expect(phone.tasks().find((item) => item.id === 'a')).toMatchObject({ estimateMin: 45, metadataComplete: true })
  })

  it('sends what was sorted before any of this reached the account, the first time the device syncs', async () => {
    const shared = drive()
    // The computer sorted these while nothing could be saved: they are only on it.
    const computer = device(shared, [sorted('a'), sorted('b'), task('c')])
    const phone = device(shared, inToDo)
    await phone.sync(inToDo)
    expect(phone.toSort()).toEqual(['a', 'b', 'c'])
    await computer.sync(inToDo)
    expect(computer.toSort()).toEqual(['c'])
    await phone.sync(inToDo)
    expect(phone.toSort()).toEqual(['c'])
  })

  it('never lets a device with an old picture put a task back under new to sort', async () => {
    const shared = drive()
    const computer = device(shared, inToDo)
    const phone = device(shared, inToDo)
    await computer.change([sorted('a'), sorted('b'), sorted('c')], '2026-11-25T17:00:00.000Z')
    // The phone still holds all three as unsorted and changes something else.
    await phone.change([...phone.tasks(), sorted('routine', { recurrence: 'daily', providerListId: undefined })], '2026-11-25T17:30:00.000Z')
    await computer.sync(inToDo)
    expect(computer.toSort()).toEqual([])
    await phone.sync(inToDo)
    expect(phone.toSort()).toEqual([])
  })

  it('keeps a task sorted on one device when another sorts a different one first', async () => {
    const shared = drive()
    const computer = device(shared, [sorted('a'), task('b'), task('c')])
    const phone = device(shared, inToDo)
    await phone.change([task('a'), sorted('b'), task('c')], '2026-11-25T17:00:00.000Z')
    await computer.sync(inToDo)
    expect(computer.toSort()).toEqual(['c'])
    await phone.sync(inToDo)
    expect(phone.toSort()).toEqual(['c'])
  })

  it('holds a change made with no connection and sends it later, under the time it was made', async () => {
    const shared = drive()
    const phone = device(shared, inToDo)
    const computer = device(shared, inToDo)
    shared.cut(true)
    await phone.change([sorted('a'), task('b'), task('c')], '2026-11-25T12:00:00.000Z')
    shared.cut(false)
    await computer.change([sorted('a', { estimateMin: 90 }), task('b'), task('c')], '2026-11-25T15:00:00.000Z')
    await phone.sync(inToDo)
    await computer.sync(inToDo)
    // The computer's change was made later, so it stands on both.
    expect(computer.tasks()[0].estimateMin).toBe(90)
    await phone.sync(inToDo)
    expect(phone.tasks()[0].estimateMin).toBe(90)
  })

  it('takes the account over the device, except for a change still waiting', () => {
    const local = [sorted('a'), sorted('b', { estimateMin: 15 })]
    const { metadata, unsent } = reconcileMeta([record('a'), record('b')], local, { b: now }, now)
    expect(metadata.find((item) => item.taskId === 'a')?.estimateMin).toBe(60)
    expect(metadata.find((item) => item.taskId === 'b')?.estimateMin).toBe(15)
    expect(unsent).toEqual([])
  })

  it('does not send a task nobody has sorted', () => {
    expect(reconcileMeta([], [task('a')], {}, now)).toEqual({ metadata: [], unsent: [] })
  })
})

describe('one change, one write', () => {
  it('takes one read and one write for a change, with fifteen hundred other tasks on the device', async () => {
    const shared = drive()
    const many = Array.from({ length: 1500 }, (_, index) => sorted(`t${index}`))
    const phone = device(shared, many)
    await phone.change(many.map((item) => item.id === 't7' ? { ...item, priority: 1 as const } : item), now)
    expect(shared.calls).toEqual({ reads: 1, writes: 1 })
    expect(parseEventLog([...shared.files.values()][0])).toHaveLength(1)
  })

  it('makes the folder by writing to it, never by asking for it', async () => {
    const shared = drive()
    const log = new RemoteEventLog(shared.sidecar, memory())
    await expect(log.append([{ entityType: 'taskMeta', entityId: 'a', op: 'set', value: record('a') }])).resolves.toHaveLength(1)
    expect([...shared.files.keys()][0]).toMatch(/^events\/.+\.jsonl$/)
  })

  it('keeps the log the size of what was touched, however often', async () => {
    const shared = drive()
    const log = new RemoteEventLog(shared.sidecar, memory())
    for (let turn = 0; turn < 300; turn += 1) {
      await log.append([{ entityType: 'taskMeta', entityId: `t${turn % 5}`, op: 'set', value: record(`t${turn % 5}`, { carries: turn }) }])
    }
    const events = parseEventLog([...shared.files.values()][0]) as SidecarEvent[]
    expect(events).toHaveLength(5)
    expect((replaySidecar(events).state.taskMeta.t4 as TaskMeta).carries).toBe(299)
  })

  it('drops from the log exactly what a replay would have passed over', () => {
    const make = (seq: number, id: string, at: string, carries: number): SidecarEvent => ({ schemaVersion: 1, eventId: `d:${seq}`, deviceId: 'd', seq, occurredAt: at, entityType: 'taskMeta', entityId: id, op: 'set', value: { carries } })
    // The second was written later but made earlier, with no connection.
    const events = [make(1, 'a', '2026-11-25T15:00:00Z', 1), make(2, 'a', '2026-11-25T12:00:00Z', 2), make(3, 'b', '2026-11-25T16:00:00Z', 3)]
    expect(replaySidecar(compactLog(events)).state).toEqual(replaySidecar(events).state)
    expect(compactLog(events)).toHaveLength(2)
  })

  it('lets a finished task give its record up after 400 days, and a deleted task at once', async () => {
    expect(keepsRecord({ completed: true, createdAt: '2025-01-01T00:00:00Z' }, now)).toBe(false)
    expect(keepsRecord({ completed: true, createdAt: '2026-06-01T00:00:00Z' }, now)).toBe(true)
    expect(keepsRecord({ completed: false, createdAt: '2019-01-01T00:00:00Z' }, now)).toBe(true)
    const shared = drive()
    const log = new RemoteEventLog(shared.sidecar, memory())
    await log.append([{ entityType: 'taskMeta', entityId: 'gone', op: 'set', value: record('gone') }])
    await log.append([{ entityType: 'taskMeta', entityId: 'here', op: 'set', value: record('here') }], (event) => event.entityId !== 'gone')
    expect((parseEventLog([...shared.files.values()][0]) as SidecarEvent[]).map((event) => event.entityId)).toEqual(['here'])
  })

  it('leaves a change waiting when it could not be sent, and one made again while sending', () => {
    const tasks = [sorted('a'), sorted('b')]
    expect(afterSending({ a: '1', b: '2' }, {}, tasks)).toEqual({ a: '1', b: '2' })
    expect(afterSending({ a: '1', b: '3' }, { a: '1', b: '2' }, tasks)).toEqual({ b: '3' })
    expect(afterSending({ a: '1', deleted: '1' }, {}, tasks)).toEqual({ a: '1' })
  })
})
