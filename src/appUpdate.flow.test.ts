import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateSource } from './appUpdate'

// The module keeps its state at the top level and reads the page it runs in, so each test loads it fresh
// against a page made of just what it touches.
type Listener = () => void
let windowListeners: Record<string, Listener[]>
let documentListeners: Record<string, Listener[]>
let visibility: 'visible' | 'hidden'

beforeEach(() => {
  vi.resetModules()
  windowListeners = {}
  documentListeners = {}
  visibility = 'visible'
  const stored = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  })
  vi.stubGlobal('HTMLInputElement', class {})
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: Listener) => void (windowListeners[type] ??= []).push(listener),
    location: { reload: () => {} },
  })
  vi.stubGlobal('document', {
    get visibilityState() { return visibility },
    activeElement: null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type: string, listener: Listener) => void (documentListeners[type] ??= []).push(listener),
  })
  vi.stubGlobal('setInterval', () => 0)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** A shell whose published build can be changed, and which writes down what it was asked. */
function shell() {
  const asked: string[] = []
  const state = { published: 'b1' }
  const source: UpdateSource = {
    running: 'a0',
    look: async () => {
      asked.push(`look ${state.published}`)
      return { name: state.published }
    },
    // The move never finishes here: what matters is what was asked before it.
    move: () => {
      asked.push('move')
      return new Promise<void>(() => {})
    },
  }
  return { asked, state, source }
}

const touch = () => windowListeners.pointerdown.forEach((listener) => listener())

describe('several builds published before the move', () => {
  it('asks again from the button, so one restart lands on the newest', async () => {
    const { watchForUpdates, checkForUpdate } = await import('./appUpdate')
    const { asked, state, source } = shell()
    watchForUpdates(source)
    touch()
    await vi.waitFor(() => expect(asked).toEqual(['look b1']))

    state.published = 'b2'
    void checkForUpdate()
    await vi.waitFor(() => expect(asked).toEqual(['look b1', 'look b2', 'move']))
  })

  it('asks again before moving on its own, once the answer it has is not fresh', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { watchForUpdates } = await import('./appUpdate')
    const { asked, state, source } = shell()
    watchForUpdates(source)
    touch()
    await vi.waitFor(() => expect(asked).toEqual(['look b1']))

    state.published = 'b2'
    vi.setSystemTime(Date.now() + 10 * 60_000)
    visibility = 'hidden'
    documentListeners.visibilitychange.forEach((listener) => listener())
    await vi.waitFor(() => expect(asked).toEqual(['look b1', 'look b2', 'move']))
  })

  it('does not move on its own when the app is touched while it asks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { watchForUpdates } = await import('./appUpdate')
    const { asked, source } = shell()
    let answer: (() => void) | undefined
    const look = source.look
    watchForUpdates(source)
    touch()
    await vi.waitFor(() => expect(asked).toEqual(['look b1']))

    // Left alone long enough to be quiet, then touched while the second look is still out.
    source.look = async () => {
      await new Promise<void>((resolve) => { answer = resolve })
      return look()
    }
    vi.setSystemTime(Date.now() + 10 * 60_000)
    visibility = 'hidden'
    documentListeners.visibilitychange.forEach((listener) => listener())
    await vi.waitFor(() => expect(answer).toBeDefined())
    visibility = 'visible'
    touch()
    answer?.()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked).not.toContain('move')
  })
})
