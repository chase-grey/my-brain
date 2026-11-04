export type VaultConfig = { repo: string; token: string; branch: string }
export type VaultNote = { path: string; sha: string }

export class GitHubError extends Error {
  constructor(readonly status: number, readonly responseBody: string, message = describeGitHubStatus(status)) {
    super(message)
  }
}

// A fine-grained token answers 404, not 403, for a repo outside its scope, so a 404 can mean any of the three settings.
export function describeGitHubStatus(status: number, where?: { repo: string; branch: string; path?: string }): string {
  if (status === 401 || status === 403) return 'github rejected the token'
  if (status === 404 && where?.path) return `no note at ${where.path} in ${where.repo} on branch ${where.branch}`
  if (status === 404 && where) return `github has no ${where.repo} on branch ${where.branch} that this token can see; check the github repo, branch, and token in settings`
  if (status === 404) return 'vault repo or branch not found; check the github repo and branch in settings'
  return `github returned ${status}`
}

// People paste the repo as a URL and the branch with a refs/heads/ prefix; GitHub wants owner/name and the branch name alone.
export function normalizeRepo(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .split('/').slice(0, 2).join('/')
}

export function normalizeBranch(value: string): string {
  return value.replace(/\s+/g, '').replace(/^refs\/heads\//, '') || 'main'
}

export interface VaultStore {
  listNotes(): Promise<VaultNote[]>
  readNote(path: string): Promise<{ content: string; sha: string }>
  writeNote(path: string, content: string): Promise<{ sha: string }>
  appendNote(path: string, text: string): Promise<{ sha: string }>
  deleteNote(path: string): Promise<void>
}

type TreeResponse = { tree: { path: string; type: string; sha: string }[]; truncated?: boolean }
type ContentsResponse = { content: string; sha: string; encoding: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeBase64(text: string): string {
  let binary = ''
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function decodeBase64(encoded: string): string {
  return decoder.decode(Uint8Array.from(atob(encoded.replace(/\s/g, '')), (char) => char.charCodeAt(0)))
}

export function vaultConfigured(config: Partial<VaultConfig>): config is VaultConfig {
  return Boolean(config.repo?.includes('/') && config.token && config.branch)
}

export class GitHubVault implements VaultStore {
  private tree?: Promise<VaultNote[]>

  constructor(
    private readonly config: VaultConfig,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  invalidate(): void {
    this.tree = undefined
  }

  listNotes(): Promise<VaultNote[]> {
    this.tree ??= this.request<TreeResponse>(`/git/trees/${encodeURIComponent(this.config.branch)}?recursive=1`)
      .then((response) => response.tree.filter((item) => item.type === 'blob' && item.path.endsWith('.md')).map(({ path, sha }) => ({ path, sha })))
      .catch((error: unknown) => {
        this.tree = undefined
        throw error
      })
    return this.tree
  }

  async readNote(path: string): Promise<{ content: string; sha: string }> {
    const file = await this.request<ContentsResponse>(`${this.contentsPath(path)}?ref=${encodeURIComponent(this.config.branch)}`, {}, path)
    return { content: decodeBase64(file.content), sha: file.sha }
  }

  async writeNote(path: string, content: string): Promise<{ sha: string }> {
    const sha = await this.currentSha(path)
    try {
      return await this.put(path, content, sha)
    } catch (error) {
      if (!(error instanceof GitHubError) || (error.status !== 409 && error.status !== 422)) throw error
      const fresh = await this.currentSha(path, true)
      return await this.put(path, content, fresh)
    }
  }

  async appendNote(path: string, text: string): Promise<{ sha: string }> {
    let existing = ''
    try {
      existing = (await this.readNote(path)).content
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 404) throw error
    }
    const separator = existing && !existing.endsWith('\n') ? '\n' : ''
    return await this.writeNote(path, `${existing}${separator}${text}${text.endsWith('\n') ? '' : '\n'}`)
  }

  async deleteNote(path: string): Promise<void> {
    const sha = await this.currentSha(path, true)
    if (!sha) throw new Error(`no note at ${path}`)
    await this.request(this.contentsPath(path), {
      method: 'DELETE',
      body: JSON.stringify({ message: `my brain: delete ${path}`, sha, branch: this.config.branch }),
    })
    this.invalidate()
  }

  private async currentSha(path: string, fresh = false): Promise<string | undefined> {
    if (fresh) this.invalidate()
    const notes = await this.listNotes()
    return notes.find((note) => note.path === path)?.sha
  }

  private async put(path: string, content: string, sha?: string): Promise<{ sha: string }> {
    const response = await this.request<{ content: { sha: string } }>(this.contentsPath(path), {
      method: 'PUT',
      body: JSON.stringify({ message: `my brain: update ${path}`, content: encodeBase64(content), branch: this.config.branch, ...(sha ? { sha } : {}) }),
    })
    this.invalidate()
    return { sha: response.content.sha }
  }

  private contentsPath(path: string): string {
    const clean = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    if (!clean) throw new Error('note path cannot be empty')
    return `/contents/${clean}`
  }

  private async request<T>(path: string, init: RequestInit = {}, notePath?: string): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}/repos/${this.config.repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
    if (!response.ok) throw new GitHubError(response.status, await response.text(), describeGitHubStatus(response.status, { repo: this.config.repo, branch: this.config.branch, path: notePath }))
    return await response.json() as T
  }
}
