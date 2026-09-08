import { describe, expect, it, vi } from 'vitest'
import { GraphError, type GraphClient } from './graphClient'
import { OneDriveSidecar } from './oneDriveSidecar'

function graphStub() {
  return { request: vi.fn(), requestText: vi.fn() } as unknown as GraphClient
}

describe('onedrive sidecar', () => {
  it('stores formatted json inside the app folder', async () => {
    const graph = graphStub()
    vi.mocked(graph.request).mockResolvedValue({})

    await new OneDriveSidecar(graph).writeJson('snapshots/personal.json', { version: 1 })

    expect(graph.request).toHaveBeenCalledWith(
      '/me/drive/special/approot:/snapshots/personal.json:/content',
      expect.objectContaining({ method: 'PUT', body: '{\n  "version": 1\n}\n' }),
    )
  })

  it('treats a missing sidecar file as an empty store', async () => {
    const graph = graphStub()
    vi.mocked(graph.requestText).mockRejectedValue(new GraphError(404, 'missing'))

    await expect(new OneDriveSidecar(graph).readJson('missing.json')).resolves.toBeUndefined()
  })
})
