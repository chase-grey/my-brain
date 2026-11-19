import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetWorkUi, loadWorkUi, workUiUrl } from './workUi'

describe('work screens loader', () => {
  beforeEach(forgetWorkUi)

  it('imports the bundle from the bridge once', async () => {
    const ui = { mount: vi.fn() }
    const importer = vi.fn().mockResolvedValue(ui)
    await expect(loadWorkUi(importer)).resolves.toBe(ui)
    await loadWorkUi(importer)
    expect(importer).toHaveBeenCalledTimes(1)
    expect(importer).toHaveBeenCalledWith(workUiUrl)
  })

  it('tries again after the bridge was down', async () => {
    const importer = vi.fn().mockRejectedValueOnce(new TypeError('failed to fetch')).mockResolvedValue({ mount: vi.fn() })
    await expect(loadWorkUi(importer)).rejects.toThrow('failed to fetch')
    await expect(loadWorkUi(importer)).resolves.toBeDefined()
  })

  it('rejects a module without the work screens', async () => {
    await expect(loadWorkUi(vi.fn().mockResolvedValue({}))).rejects.toThrow('no work screens')
  })
})
