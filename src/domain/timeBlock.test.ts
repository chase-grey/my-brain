import { describe, expect, it } from 'vitest'
import { blockLabel, blockProblem, blockSpan, blocksFor, reconcileBlock, settleBlocks, validBlockStart, withBlockChange, type TimeBlock } from './timeBlock'

const now = new Date('2026-11-25T09:00:00')
const block: TimeBlock = { id: 'b1', domain: 'personal', title: 'frame the porch', start: '2026-12-05T13:00:00', end: '2026-12-05T16:00:00', eventId: 'e1', projectId: 'p1' }

describe('blocking time', () => {
  it('writes the hour that was picked and the length that was given', () => {
    expect(blockSpan('2026-12-05T13:00', 180)).toEqual({ start: '2026-12-05T13:00:00', end: '2026-12-05T16:00:00' })
    expect(blockSpan('2026-12-05T22:30', 120)).toEqual({ start: '2026-12-05T22:30:00', end: '2026-12-06T00:30:00' })
  })

  it('refuses a block with no name, no real moment, a moment gone by, or a length out of range', () => {
    const good = { title: 'frame the porch', start: '2026-12-05T13:00', minutes: 180 }
    expect(blockProblem(good, now)).toBeUndefined()
    expect(blockProblem({ ...good, title: ' ' }, now)).toBe('it needs a name')
    expect(blockProblem({ ...good, start: 'saturday' }, now)).toBe('pick a day and a time')
    expect(blockProblem({ ...good, start: '2026-02-30T10:00' }, now)).toBe('pick a day and a time')
    expect(blockProblem({ ...good, start: '2026-11-25T08:00' }, now)).toBe('that time has already passed')
    expect(blockProblem({ ...good, minutes: 5 }, now)).toBe('a block is at least 15 minutes')
    expect(blockProblem({ ...good, minutes: 13 * 60 }, now)).toBe('a block is at most 12 hours')
  })

  it('reads a start with or without seconds and nothing else', () => {
    expect(validBlockStart('2026-12-05T13:00:00')).toBe('2026-12-05T13:00')
    expect(validBlockStart('2026-12-05T25:00')).toBeUndefined()
    expect(validBlockStart('2026-12-05')).toBeUndefined()
  })

  it('names a block the way a person would say it', () => {
    expect(blockLabel(block)).toBe('sat, dec 5 · 1pm–4pm')
  })

  it('finds the blocks of a task or a project, soonest first', () => {
    const later: TimeBlock = { ...block, id: 'b2', start: '2026-12-12T09:00:00', end: '2026-12-12T10:00:00' }
    const other: TimeBlock = { ...block, id: 'b3', projectId: undefined, taskId: 't1' }
    expect(blocksFor([later, other, block], { projectId: 'p1' }).map((item) => item.id)).toEqual(['b1', 'b2'])
    expect(blocksFor([later, other, block], { taskId: 't1' }).map((item) => item.id)).toEqual(['b3'])
    expect(blocksFor([block], { taskId: undefined })).toEqual([])
  })

  it('lets a block leave once its time is over', () => {
    const state = { timeBlocks: [block] }
    expect(settleBlocks(state, new Date('2026-12-05T15:00:00'))).toBe(state)
    expect(settleBlocks(state, new Date('2026-12-05T16:00:00')).timeBlocks).toEqual([])
  })

  it('follows the calendar: a block moved there comes back with its new time, one deleted there is gone', () => {
    const event = { id: 'e1', subject: 'frame the porch', start: block.start, end: block.end, isAllDay: false }
    expect(reconcileBlock(block, event)).toEqual({ kind: 'unchanged' })
    const moved = reconcileBlock(block, { ...event, start: '2026-12-06T09:00:00', end: '2026-12-06T12:00:00' })
    expect(moved).toEqual({ kind: 'moved', start: '2026-12-06T09:00:00', end: '2026-12-06T12:00:00' })
    expect(withBlockChange({ timeBlocks: [block] }, 'b1', moved).timeBlocks[0]).toMatchObject({ start: '2026-12-06T09:00:00', end: '2026-12-06T12:00:00' })
    expect(reconcileBlock(block, undefined)).toEqual({ kind: 'gone' })
    expect(withBlockChange({ timeBlocks: [block] }, 'b1', { kind: 'gone' }).timeBlocks).toEqual([])
  })
})
