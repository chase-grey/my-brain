export type BridgeChatRequest = { text: string; sessionId?: string; systemPrompt?: string }
export type BridgeChatResponse = { text: string; sessionId: string; isError: boolean }
export type BridgeChatStatus = { claude: boolean; claudePath?: string; vault: boolean; vaultPath: string }

export class BridgeUnreachableError extends Error {
  constructor() {
    super('work bridge is not running')
  }
}

export class BridgeCompanionClient {
  constructor(private readonly baseUrl = 'http://127.0.0.1:47321', private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  async status(): Promise<BridgeChatStatus> {
    return await this.request<BridgeChatStatus>('/chat/status')
  }

  async chat(request: BridgeChatRequest): Promise<BridgeChatResponse> {
    const response = await this.request<Partial<BridgeChatResponse>>('/chat', { method: 'POST', body: JSON.stringify(request) })
    return { text: response.text ?? '', sessionId: response.sessionId ?? request.sessionId ?? '', isError: response.isError === true }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
    } catch {
      throw new BridgeUnreachableError()
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      let detail = ''
      try {
        detail = (JSON.parse(body) as { error?: string }).error ?? ''
      } catch {
        detail = body
      }
      throw new Error(detail ? `work bridge: ${detail}` : `work bridge returned ${response.status}`)
    }
    return await response.json() as T
  }
}
