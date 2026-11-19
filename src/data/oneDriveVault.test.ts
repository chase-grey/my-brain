import { describe, expect, it, vi } from 'vitest'
import { GitHubError } from '../companion/githubVault'
import { GraphError, type GraphClient } from './graphClient'
import { OneDriveVault } from './oneDriveVault'

function graphStub() {
  return { request: vi.fn(), requestText: vi.fn(), collection: vi.fn() } as unknown as GraphClient
}

describe('onedrive vault', () => {
  it('lists notes through every folder under notes/', async () => {
    const graph = graphStub()
    vi.mocked(graph.collection).mockImplementation(async (path: string) => {
      if (path.includes('approot:/notes:/')) return [{ name: 'memory', folder: {} }, { name: 'today.md', file: {}, eTag: 'e1' }]
      if (path.includes('approot:/notes/memory:/')) return [{ name: 'MEMORY.md', file: {}, eTag: 'e2' }]
      return []
    })
    await expect(new OneDriveVault(graph).listNotes()).resolves.toEqual([{ path: 'memory/MEMORY.md', sha: 'e2' }, { path: 'today.md', sha: 'e1' }])
  })

  it('lists nothing before the first note is written', async () => {
    const graph = graphStub()
    vi.mocked(graph.collection).mockRejectedValue(new GraphError(404, ''))
    await expect(new OneDriveVault(graph).listNotes()).resolves.toEqual([])
  })

  it('reports a missing note the way the github vault does', async () => {
    const graph = graphStub()
    vi.mocked(graph.requestText).mockRejectedValue(new GraphError(404, ''))
    const error = await new OneDriveVault(graph).readNote('memory/MEMORY.md').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(GitHubError)
    expect((error as GitHubError).status).toBe(404)
  })

  it('writes a note by path and appends to one that does not exist yet', async () => {
    const graph = graphStub()
    vi.mocked(graph.requestText).mockRejectedValue(new GraphError(404, ''))
    vi.mocked(graph.request).mockResolvedValue({ eTag: 'e3' })
    await expect(new OneDriveVault(graph).appendNote('30 Trips/2026-12 Oslo/trip.md', 'hello')).resolves.toEqual({ sha: 'e3' })
    expect(graph.request).toHaveBeenCalledWith(
      '/me/drive/special/approot:/notes/30%20Trips/2026-12%20Oslo/trip.md:/content',
      expect.objectContaining({ method: 'PUT', body: 'hello\n' }),
    )
  })

  it('deletes the item, not its content', async () => {
    const graph = graphStub()
    vi.mocked(graph.request).mockResolvedValue(undefined)
    await new OneDriveVault(graph).deleteNote('a.md')
    expect(graph.request).toHaveBeenCalledWith('/me/drive/special/approot:/notes/a.md', { method: 'DELETE' })
  })
})
