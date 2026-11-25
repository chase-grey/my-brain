import { describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../settings'
import type { Task } from '../domain/types'
import { AnthropicClient, type ChatClient } from './anthropicClient'
import { BridgeModelClient } from './bridgeModel'
import { guessModel, guessTasks, prunedGuesses, type KeptGuesses } from './taskGuesses'

const keyed = { ...defaultSettings, anthropicApiKey: 'sk-ant-test' }
const bridgeUp = { reached: () => true, ready: async () => true }
const bridgeDown = { reached: () => true, ready: async () => false }
const neverReached = { reached: () => false, ready: vi.fn(async () => true) }

describe('who guesses', () => {
  it('sends work tasks only to claude code on the bridge, never to the personal key', async () => {
    expect(await guessModel('work', keyed, bridgeDown)).toBeUndefined()
    const model = await guessModel('work', keyed, bridgeUp)
    expect(model?.client).toBeInstanceOf(BridgeModelClient)
    expect(model?.model).toBe('claude-haiku-5-5')
  })

  it('uses the bridge for personal tasks when this device has one, and the key when it does not', async () => {
    expect((await guessModel('personal', keyed, bridgeUp))?.client).toBeInstanceOf(BridgeModelClient)
    const model = await guessModel('personal', keyed, bridgeDown)
    expect(model?.client).toBeInstanceOf(AnthropicClient)
    expect(model).toMatchObject({ model: 'claude-haiku-5-5', effort: 'low' })
  })

  it('does not look for a bridge on a device that has never reached one', async () => {
    expect((await guessModel('personal', keyed, neverReached))?.client).toBeInstanceOf(AnthropicClient)
    expect(neverReached.ready).not.toHaveBeenCalled()
  })

  it('guesses nothing with no key and no bridge, or with ai turned off', async () => {
    expect(await guessModel('personal', defaultSettings, bridgeDown)).toBeUndefined()
    expect(await guessModel('personal', { ...keyed, aiMode: 'off' }, bridgeUp)).toBeUndefined()
  })

  it('asks another service for the model picked for it', async () => {
    const model = await guessModel('personal', { ...keyed, aiProvider: 'openai', aiModel: 'gpt-4o-mini' }, bridgeDown)
    expect(model?.model).toBe('gpt-4o-mini')
    expect(model?.effort).toBeUndefined()
  })
})

describe('asking', () => {
  it('sends a batch in one request and reads the guesses back by task', async () => {
    const createMessage = vi.fn<ChatClient['createMessage']>(async () => ({ id: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"tasks":[{"n":1,"minutes":15,"priority":3,"energy":"shallow","where":[],"store":"none"}]}' }] }))
    const task: Task = { id: 'a', taskId: 'a', domain: 'personal', title: 'call the dentist', completed: false, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, metadataComplete: false }
    const guesses = await guessTasks([task], 'personal', [], { client: { createMessage }, model: 'claude-haiku-5-5', effort: 'low' })
    expect(guesses).toEqual({ a: { estimateMin: 15, priority: 3, energy: 'shallow' } })
    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(createMessage.mock.calls[0][0]).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } })
    expect(createMessage.mock.calls[0][0].tools).toBeUndefined()
  })
})

describe('kept guesses', () => {
  const guess = { estimateMin: 30, priority: 3 as const, energy: 'shallow' as const }
  const kept: KeptGuesses = {
    waiting: { title: 'a', on: '2026-11-20T10:00:00.000Z', guess },
    sorted: { title: 'b', on: '2026-11-20T10:00:00.000Z', guess },
    ancient: { title: 'c', on: '2026-09-01T10:00:00.000Z', guess },
  }

  it('leave when their task is sorted and when they are over 30 days old', () => {
    expect(Object.keys(prunedGuesses(kept, new Set(['waiting', 'ancient']), '2026-11-25T10:00:00.000Z'))).toEqual(['waiting'])
    expect(Object.keys(prunedGuesses(kept, undefined, '2026-11-25T10:00:00.000Z'))).toEqual(['waiting', 'sorted'])
  })

  it('stay small with hundreds of tasks sorted and nothing waiting', () => {
    const many: KeptGuesses = Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`t${index}`, { title: 'x', on: '2026-11-24T10:00:00.000Z', guess }]))
    expect(prunedGuesses(many, new Set(), '2026-11-25T10:00:00.000Z')).toEqual({})
  })
})
