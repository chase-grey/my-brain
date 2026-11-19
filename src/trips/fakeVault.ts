import { GitHubError, type VaultStore } from '../companion/githubVault'

/** An in-memory vault for tests. `offline` makes every call fail the way a dropped connection does. */
export function fakeVault(notes: Record<string, string> = {}): VaultStore & { notes: Record<string, string>; offline: boolean; writes: string[] } {
  const vault = {
    notes,
    offline: false,
    writes: [] as string[],
    check() { if (vault.offline) throw new TypeError('Failed to fetch') },
    async listNotes() { vault.check(); return Object.keys(vault.notes).map((path) => ({ path, sha: 'sha' })) },
    async readNote(path: string) {
      vault.check()
      if (!(path in vault.notes)) throw new GitHubError(404, '')
      return { content: vault.notes[path], sha: 'sha' }
    },
    async writeNote(path: string, content: string) { vault.check(); vault.notes[path] = content; vault.writes.push(path); return { sha: 'sha' } },
    async appendNote(path: string, text: string) { vault.check(); vault.notes[path] = `${vault.notes[path] ?? ''}${text}`; return { sha: 'sha' } },
    async deleteNote(path: string) { vault.check(); delete vault.notes[path] },
  }
  return vault
}

export function fakeStorage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & { values: Record<string, string> } {
  const values = { ...initial }
  return { values, getItem: (key) => values[key] ?? null, setItem: (key, value) => { values[key] = value } }
}
