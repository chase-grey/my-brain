import { describe, expect, it, vi } from 'vitest'
import { GitHubError, type VaultStore } from './githubVault'
import { forgetMemory, indexEntries, readMemoryIndex, removeIndexLine, renderMemoryFile, saveMemory, upsertIndexLine, validateMemoryName } from './memory'

function fakeVault(files: Record<string, string>): VaultStore & { files: Record<string, string> } {
  return {
    files,
    listNotes: vi.fn(async () => Object.keys(files).map((path) => ({ path, sha: path }))),
    readNote: vi.fn(async (path: string) => {
      if (!(path in files)) throw new GitHubError(404, '')
      return { content: files[path], sha: path }
    }),
    writeNote: vi.fn(async (path: string, content: string) => {
      files[path] = content
      return { sha: path }
    }),
    appendNote: vi.fn(async () => ({ sha: 'x' })),
    deleteNote: vi.fn(async (path: string) => {
      if (!(path in files)) throw new Error(`no note at ${path}`)
      delete files[path]
    }),
  }
}

describe('memory files', () => {
  it('renders one fact per file with frontmatter', () => {
    expect(renderMemoryFile({ name: 'morning-routine', description: 'gym before 7, then coffee: no meetings', content: 'Chase trains at 6.\n' })).toBe(
      '---\nname: morning-routine\ndescription: "gym before 7, then coffee: no meetings"\nmetadata:\n  type: user\n---\n\nChase trains at 6.\n',
    )
  })

  it('rejects names that are not kebab-case slugs', () => {
    expect(validateMemoryName(' coffee-order ')).toBe('coffee-order')
    expect(() => validateMemoryName('Coffee Order')).toThrow('kebab-case')
    expect(() => validateMemoryName('../etc')).toThrow('kebab-case')
  })

  it('upserts and removes index lines by file name', () => {
    const index = upsertIndexLine('', 'coffee-order', 'flat white, oat milk')
    expect(index).toBe('- [coffee order](coffee-order.md) — flat white, oat milk\n')
    const updated = upsertIndexLine(upsertIndexLine(index, 'gym', 'mornings'), 'coffee-order', 'now black coffee')
    expect(updated.split('\n').filter(Boolean)).toEqual(['- [coffee order](coffee-order.md) — now black coffee', '- [gym](gym.md) — mornings'])
    expect(removeIndexLine(updated, 'coffee-order')).toBe('- [gym](gym.md) — mornings\n')
    expect(removeIndexLine('- [gym](gym.md) — mornings\n', 'gym')).toBe('')
  })

  it('strips comments and headings when listing entries for the prompt', () => {
    expect(indexEntries('<!-- one line per memory -->\n# memory\n\n- [gym](gym.md) — mornings\n')).toEqual(['- [gym](gym.md) — mornings'])
  })
})

describe('memory in the vault', () => {
  it('treats a missing index as empty but surfaces other errors', async () => {
    const vault = fakeVault({})
    await expect(readMemoryIndex(vault, 'memory')).resolves.toBe('')
    vault.readNote = vi.fn(async () => { throw new GitHubError(401, '') })
    await expect(readMemoryIndex(vault, 'memory')).rejects.toBeInstanceOf(GitHubError)
  })

  it('saves a memory file and its index line, then forgets both', async () => {
    const vault = fakeVault({ 'memory/MEMORY.md': '- [gym](gym.md) — mornings\n', 'memory/gym.md': '---\nname: gym\n---\nMornings.\n' })
    await expect(saveMemory(vault, 'memory', { name: 'coffee-order', description: 'black', content: 'No milk.', type: 'user' })).resolves.toEqual({ path: 'memory/coffee-order.md' })
    expect(vault.files['memory/coffee-order.md']).toContain('name: coffee-order')
    expect(vault.files['memory/MEMORY.md']).toBe('- [gym](gym.md) — mornings\n- [coffee order](coffee-order.md) — black\n')

    await forgetMemory(vault, 'memory', 'gym')
    expect(vault.files['memory/MEMORY.md']).toBe('- [coffee order](coffee-order.md) — black\n')
    await expect(forgetMemory(vault, 'memory', 'gym')).rejects.toThrow('no note at memory/gym.md')
  })
})
