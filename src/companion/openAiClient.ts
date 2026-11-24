import { AnthropicError, type AnthropicMessage, type ChatClient, type ContentBlock, type MessagesRequest, type MessagesResponse } from './anthropicClient'

type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } }
type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }
type CompletionResponse = { id?: string; choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: ToolCall[] } }[] }

function fromAnthropic(message: AnthropicMessage): OpenAiMessage[] {
  if (typeof message.content === 'string') return [{ role: message.role, content: message.content }]
  const text = message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
  if (message.role === 'assistant') {
    const calls = message.content.filter((block) => block.type === 'tool_use').map((block): ToolCall => ({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input) } }))
    return [{ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) }]
  }
  // Tool results answer the assistant's calls, so they go first; any words the user added follow.
  const results = message.content.filter((block) => block.type === 'tool_result').map((block): OpenAiMessage => ({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content }))
  return text ? [...results, { role: 'user', content: text }] : results
}

/** The request the companion builds for anthropic, as an OpenAI chat-completions body. Effort has no shared equivalent and is left out. */
export function toCompletionRequest(request: MessagesRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: [...(request.system ? [{ role: 'system', content: request.system } satisfies OpenAiMessage] : []), ...request.messages.flatMap(fromAnthropic)],
    ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })) } : {}),
  }
}

function parseArguments(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** A chat-completions reply in the shape the companion reads. */
export function fromCompletionResponse(response: CompletionResponse): MessagesResponse {
  const choice = response.choices?.[0]
  const calls = choice?.message?.tool_calls ?? []
  const content: ContentBlock[] = []
  if (choice?.message?.content) content.push({ type: 'text', text: choice.message.content })
  for (const call of calls) content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseArguments(call.function.arguments) })
  const stop = calls.length ? 'tool_use' : choice?.finish_reason === 'length' ? 'max_tokens' : 'end_turn'
  return { id: response.id ?? '', content, stop_reason: stop }
}

/** OpenAI, OpenRouter, or any service that speaks the same wire, behind the interface the companion already uses. */
export class OpenAiCompatClient implements ChatClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly service = 'openai',
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async createMessage(request: MessagesRequest): Promise<MessagesResponse> {
    const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(toCompletionRequest(request)),
    })
    if (!response.ok) throw new AnthropicError(response.status, await response.text(), this.service)
    return fromCompletionResponse(await response.json() as CompletionResponse)
  }
}
