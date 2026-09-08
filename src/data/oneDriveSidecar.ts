import { GraphError, type GraphClient } from './graphClient'

function sidecarPath(path: string): string {
  const clean = path.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  if (!clean) throw new Error('sidecar path cannot be empty')
  return `/me/drive/special/approot:/${clean}:/content`
}

export class OneDriveSidecar {
  constructor(private readonly graph: GraphClient) {}

  async readText(path: string): Promise<string | undefined> {
    try {
      return await this.graph.requestText(sidecarPath(path), {
        headers: { Accept: 'text/plain' },
      })
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) return undefined
      throw error
    }
  }

  async writeText(path: string, contents: string): Promise<void> {
    await this.graph.request(sidecarPath(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: contents,
    })
  }

  async readJson<T>(path: string): Promise<T | undefined> {
    const contents = await this.readText(path)
    return contents === undefined ? undefined : JSON.parse(contents) as T
  }

  async writeJson(path: string, value: unknown): Promise<void> {
    await this.writeText(path, `${JSON.stringify(value, null, 2)}\n`)
  }

  async ensureFolder(name: string): Promise<void> {
    try {
      await this.graph.request('/me/drive/special/approot/children', {
        method: 'POST',
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
      })
    } catch (error) {
      if (!(error instanceof GraphError) || error.status !== 409) throw error
    }
  }

  async listFiles(folder: string): Promise<string[]> {
    type DriveItem = { name: string; file?: unknown }
    const clean = folder.split('/').filter(Boolean).map(encodeURIComponent).join('/')
    try {
      const items = await this.graph.collection<DriveItem>(`/me/drive/special/approot:/${clean}:/children?$select=name,file`)
      return items.filter((item) => item.file).map((item) => item.name)
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) return []
      throw error
    }
  }
}
