import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkBridgeAwayError, bridgeAway, forgetWorkUi, loadWorkUi, workBridgeUp, workUiUrl } from './workUi'

const up = () => Promise.resolve(true)
const down = () => Promise.resolve(false)

describe('work screens loader', () => {
  beforeEach(forgetWorkUi)

  it('imports the bundle from the bridge once', async () => {
    const ui = { mount: vi.fn() }
    const importer = vi.fn().mockResolvedValue(ui)
    await expect(loadWorkUi(importer, up)).resolves.toBe(ui)
    await loadWorkUi(importer, up)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importer).toHaveBeenCalledWith(workUiUrl)
  })

  it('tries again after the bridge was down', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new TypeError('failed to fetch')).mockResolvedValue({ mount: vi.fn() })
    await expect(loadWorkUi(importer, up)).rejects.toThrow('failed to fetch')
    await expect(loadWorkUi(importer, up)).resolves.toBeDefined()
  })

  it('does not import the bundle while the bridge is not running, and loads once it is', async () => {
    const importer = vi.fn().mockResolvedValue({ mount: vi.fn() })
    const failure = await loadWorkUi(importer, down).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(WorkBridgeAwayError)
    expect(bridgeAway(failure)).toBe(true)
    expect(importer).not.toHaveBeenCalled()
    await expect(loadWorkUi(importer, up)).resolves.toBeDefined()
    expect(importer).toHaveBeenCalledTimes(1)
  })

  it('rejects a module without the work screens', async () => {
    const failure = await loadWorkUi(vi.fn().mockResolvedValue({}), up).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('no work screens')
    expect(bridgeAway(failure)).toBe(false)
  })
})

describe('looking for the bridge', () => {
  it('is up when the bridge answers, even with an error', async () => {
    await expect(workBridgeUp(vi.fn().mockResolvedValue(new Response('{"claude":true,"vault":true,"vaultPath":""}', { status: 200 })))).resolves.toBe(true)
    await expect(workBridgeUp(vi.fn().mockResolvedValue(new Response('{"error":"no vault"}', { status: 500 })))).resolves.toBe(true)
  })

  it('is down when nothing answers', async () => {
    await expect(workBridgeUp(vi.fn().mockRejectedValue(new TypeError('failed to fetch')))).resolves.toBe(false)
  })

  it('gives up on a bridge that never answers', async () => {
    const hangs: typeof fetch = (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
    await expect(workBridgeUp(hangs, 10)).resolves.toBe(false)
  })
})
