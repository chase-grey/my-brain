import { GitHubError, type VaultNote, type VaultStore } from '../companion/githubVault'
import { GraphError, type GraphClient } from './graphClient'

/**
 * Notes kept in the account's OneDrive app folder, under notes/, for anyone without a GitHub vault.
 * Same contract as GitHubVault so the chat, memory, and trips run on either.
 *
 * A missing note throws GitHubError(404): every caller already treats that as "not there yet",
 * and the vault it came from does not matter to them.
 */
export const oneDriveNotesFolder = 'notes'

type DriveItem = { name: string; eTag?: string; lastModifiedDateTime?: string; file?: unknown; folder?: unknown }

function encodePath(path: string): string {
  const clean = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  if (!clean) throw new Error('note path cannot be empty')
  return clean
}

export class OneDriveVault implements VaultStore {
  constructor(private readonly graph: GraphClient, private readonly root = oneDriveNotesFolder) {}

  private item(path: string): string {
    return `/me/drive/special/approot:/${encodePath(`${this.root}/${path}`)}`
  }

  private missing(error: unknown, path: string): never {
    if (error instanceof GraphError && error.status === 404) throw new GitHubError(404, '', `no note at ${path}`)
    throw error
  }

  async listNotes(): Promise<VaultNote[]> {
    const notes: VaultNote[] = []
    const walk = async (folder: string): Promise<void> => {
      let items: DriveItem[]
      try {
        items = await this.graph.collection<DriveItem>(`/me/drive/special/approot:/${encodePath(folder)}:/children?$select=name,eTag,lastModifiedDateTime,file,folder`)
      } catch (error) {
        if (error instanceof GraphError && error.status === 404) return
        throw error
      }
      for (const item of items) {
        const full = `${folder}/${item.name}`
        if (item.folder) await walk(full)
        else if (item.file) notes.push({ path: full.slice(this.root.length + 1), sha: item.eTag ?? '', ...(item.lastModifiedDateTime ? { edited: item.lastModifiedDateTime } : {}) })
      }
    }
    await walk(this.root)
    return notes
  }

  async readNote(path: string): Promise<{ content: string; sha: string }> {
    try {
      const content = await this.graph.requestText(`${this.item(path)}:/content`, { headers: { Accept: 'text/plain' } })
      return { content, sha: '' }
    } catch (error) {
      return this.missing(error, path)
    }
  }

  async writeNote(path: string, content: string): Promise<{ sha: string }> {
    // A path PUT creates the folders on the way.
    const item = await this.graph.request<DriveItem>(`${this.item(path)}:/content`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      body: content,
    })
    return { sha: item?.eTag ?? '' }
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
    try {
      await this.graph.request(this.item(path), { method: 'DELETE' })
    } catch (error) {
      this.missing(error, path)
    }
  }
}
