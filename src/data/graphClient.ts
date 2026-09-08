export type AccessTokenProvider = () => Promise<string>

type GraphCollection<T> = {
  value: T[]
  '@odata.nextLink'?: string
}

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
  ) {
    super(`microsoft graph returned ${status}`)
    this.name = 'GraphError'
  }
}

export class GraphClient {
  constructor(
    private readonly getAccessToken: AccessTokenProvider,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = 'https://graph.microsoft.com/v1.0',
  ) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.response(path, init)
    if (response.status === 204) return undefined as T
    return await response.json() as T
  }

  async requestText(path: string, init: RequestInit = {}): Promise<string> {
    const response = await this.response(path, init)
    return await response.text()
  }

  private async response(path: string, init: RequestInit): Promise<Response> {
    const token = await this.getAccessToken()
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    const response = await this.fetcher(this.url(path), { ...init, headers })
    if (!response.ok) throw new GraphError(response.status, await response.text())
    return response
  }

  async collection<T>(path: string): Promise<T[]> {
    const values: T[] = []
    let next: string | undefined = path
    while (next) {
      const page: GraphCollection<T> = await this.request(next)
      values.push(...page.value)
      next = page['@odata.nextLink']
    }
    return values
  }

  private url(path: string): string {
    if (path.startsWith('https://')) return path
    return `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`
  }
}
