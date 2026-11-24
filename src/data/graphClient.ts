export type AccessTokenProvider = () => Promise<string>

type GraphCollection<T> = {
  value: T[]
  '@odata.nextLink'?: string
}

/** What graph said went wrong, when the body is its usual `{ error: { code, message } }`. */
function graphReason(body: string): string {
  try {
    const error = (JSON.parse(body) as { error?: { code?: string; message?: string } }).error
    const reason = [error?.code, error?.message].filter(Boolean).join(', ')
    return reason ? `: ${reason}` : ''
  } catch {
    return ''
  }
}

/** The path without its query, short enough to show. */
function requestLabel(method: string | undefined, path: string): string {
  const bare = path.replace(/^https:\/\/[^/]+(\/v1\.0)?/, '').split('?')[0]
  return `${(method ?? 'GET').toUpperCase()} ${bare.length > 70 ? `${bare.slice(0, 70)}…` : bare}`
}

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: string,
    /** The request that failed, such as `GET /me/todo/lists`. */
    public readonly request?: string,
  ) {
    super(`microsoft graph returned ${status}${request ? ` for ${request}` : ''}${graphReason(responseBody)}`)
    this.name = 'GraphError'
  }
}

export class GraphClient {
  constructor(
    private readonly getAccessToken: AccessTokenProvider,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
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
    if (!response.ok) throw new GraphError(response.status, await response.text(), requestLabel(init.method, path))
    return response
  }

  async collection<T>(path: string, init: RequestInit = {}): Promise<T[]> {
    const values: T[] = []
    let next: string | undefined = path
    while (next) {
      const page: GraphCollection<T> = await this.request(next, init)
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
