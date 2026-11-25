export type BridgeChatRequest = { text: string; /** Ids from `upload`. */ files?: string[]; sessionId?: string; systemPrompt?: string; model?: string; effort?: string }
export type BridgeChatResponse = { text: string; sessionId: string; isError: boolean }
/** `model` is set by a bridge that has `/chat/model`; one started before that route existed leaves it out. */
export type BridgeChatStatus = { claude: boolean; claudePath?: string; vault: boolean; vaultPath: string; model?: boolean }
export type BridgeModelRequest = { system: string; prompt: string; model?: string; effort?: string }
/** `result` is the reply as json text: `{ text, tool_calls }`. */
export type BridgeModelResponse = { result: string; isError: boolean }

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

  /** Leaves a file on the work pc for the next chat message to name. */
  async upload(name: string, bytes: Uint8Array): Promise<string> {
    const body = new Blob([bytes as BlobPart])
    return (await this.request<{ id: string }>(`/chat/file?name=${encodeURIComponent(name)}`, { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } })).id
  }

  /** Claude Code as a bare model, with no tools and no vault: what the personal chat borrows on the work pc. */
  async model(request: BridgeModelRequest): Promise<BridgeModelResponse> {
    const response = await this.request<Partial<BridgeModelResponse>>('/chat/model', { method: 'POST', body: JSON.stringify(request) })
    return { result: response.result ?? '', isError: response.isError === true }
  }

  /** Continues the thread in a Session Runner terminal: the same Claude Code session, resumed in the vault. */
  async openInSessionRunner(sessionId: string, label: string): Promise<void> {
    await this.request<{ id: string }>('/chat/open', { method: 'POST', body: JSON.stringify({ sessionId, label }) })
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
