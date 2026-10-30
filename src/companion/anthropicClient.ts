export type TextBlock = { type: 'text'; text: string }
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock
export type AnthropicMessage = { role: 'user' | 'assistant'; content: string | ContentBlock[] }
export type AnthropicTool = {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}
export type MessagesRequest = { model: string; system?: string; messages: AnthropicMessage[]; tools?: AnthropicTool[]; max_tokens?: number }
export type MessagesResponse = { id: string; content: ContentBlock[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | string }

export class AnthropicError extends Error {
  constructor(readonly status: number, readonly responseBody: string) {
    super(`anthropic returned ${status}`)
  }
}

export class AnthropicClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly baseUrl = 'https://api.anthropic.com/v1',
  ) {}

  async createMessage(request: MessagesRequest): Promise<MessagesResponse> {
    const response = await this.fetcher(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({ max_tokens: 1024, ...request }),
    })
    if (!response.ok) throw new AnthropicError(response.status, await response.text())
    return await response.json() as MessagesResponse
  }
}

export function textOf(content: ContentBlock[]): string {
  return content.filter((block): block is TextBlock => block.type === 'text').map((block) => block.text).join('\n').trim()
}

export function toolUses(content: ContentBlock[]): ToolUseBlock[] {
  return content.filter((block): block is ToolUseBlock => block.type === 'tool_use')
}
