import { describe, expect, it, vi } from 'vitest'
import { GitHubError, GitHubVault, decodeBase64, encodeBase64, vaultConfigured } from './githubVault'

const config = { repo: 'chase-grey/homebase', token: 'ghp_x', branch: 'main' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const tree = { tree: [
  { path: '70 Goals/Run.md', type: 'blob', sha: 'aaa' },
  { path: 'cover.png', type: 'blob', sha: 'bbb' },
  { path: '70 Goals', type: 'tree', sha: 'ccc' },
] }
const putBodies = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls
  .filter(([, init]) => (init as RequestInit).method === 'PUT')
  .map(([, init]) => JSON.parse((init as RequestInit).body as string) as { sha?: string; content: string; branch: string })

describe('github vault', () => {
  it('lists markdown notes once and reads utf-8 content', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(tree))
      .mockResolvedValueOnce(json({ content: encodeBase64('# Run\n- [ ] 5k 📅 2026-11-01\n'), sha: 'aaa', encoding: 'base64' }))
    const vault = new GitHubVault(config, fetcher)
    await expect(vault.listNotes()).resolves.toEqual([{ path: '70 Goals/Run.md', sha: 'aaa' }])
    await vault.listNotes()
    await expect(vault.readNote('70 Goals/Run.md')).resolves.toEqual({ content: '# Run\n- [ ] 5k 📅 2026-11-01\n', sha: 'aaa' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][0]).toBe('https://api.github.com/repos/chase-grey/homebase/git/trees/main?recursive=1')
    expect(fetcher.mock.calls[1][0]).toBe('https://api.github.com/repos/chase-grey/homebase/contents/70%20Goals/Run.md?ref=main')
    expect((fetcher.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer ghp_x' })
  })

  it('writes with the known sha and retries once after a conflict', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json(tree))
      .mockResolvedValueOnce(json({ message: 'sha does not match' }, 409))
      .mockResolvedValueOnce(json({ tree: [{ path: '70 Goals/Run.md', type: 'blob', sha: 'fresh' }] }))
      .mockResolvedValueOnce(json({ content: { sha: 'new' } }))
    const vault = new GitHubVault(config, fetcher)
    await expect(vault.writeNote('70 Goals/Run.md', 'body')).resolves.toEqual({ sha: 'new' })
    const bodies = putBodies(fetcher)
    expect(bodies.map((body) => body.sha)).toEqual(['aaa', 'fresh'])
    expect(bodies[0]).toMatchObject({ branch: 'main', content: encodeBase64('body') })
  })

  it('creates missing notes without a sha and appends to existing ones', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(json({ message: 'not found' }, 404))
      .mockResolvedValueOnce(json(tree))
      .mockResolvedValueOnce(json({ content: { sha: 'created' } }))
    const vault = new GitHubVault(config, fetcher)
    await expect(vault.appendNote('00 Weekly Plans/2026-W44.md', '- [ ] call plumber')).resolves.toEqual({ sha: 'created' })
    const [put] = putBodies(fetcher)
    expect(put.sha).toBeUndefined()
    expect(decodeBase64(put.content)).toBe('- [ ] call plumber\n')
  })

  it('reports github failures with status', async () => {
    const vault = new GitHubVault(config, async () => new Response('bad credentials', { status: 401 }))
    await expect(vault.listNotes()).rejects.toBeInstanceOf(GitHubError)
    expect(vaultConfigured({ repo: 'a/b', token: 't', branch: 'main' })).toBe(true)
    expect(vaultConfigured({ repo: 'nope', token: 't', branch: 'main' })).toBe(false)
  })
})
