import { AnthropicError, type AnthropicMessage, type AnthropicTool, type ChatClient, type ContentBlock, type MessagesRequest, type MessagesResponse } from './anthropicClient'
import { BridgeCompanionClient, BridgeUnreachableError } from './bridgeCompanion'

/**
 * The personal chat on the work pc's Claude Code instead of the personal key. The bridge runs Claude Code as a bare
 * model: no tools of its own, no vault, nothing kept. The tools stay the app's, so the request is rendered into one
 * prompt here, and the reply comes back naming the tools it wants run. Everything personal (memory, notes, tasks,
 * mail) is still read and written by the app, in this browser.
 */

const reachedKey = 'my-brain.bridge.reached.v1'
// The work chat only ever answers through the bridge, so a history of it means this device has reached one.
const workHistoryKey = 'my-brain.work.companion.history.v1'
export const bridgeProbeTimeoutMs = 1500

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function storage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

/**
 * Whether this device has ever talked to a bridge. A phone never has, so it is never asked to look for one:
 * a public page reaching for the local network makes the browser ask permission.
 */
export function bridgeReachedBefore(store: StorageLike | undefined = storage()): boolean {
  try {
    return Boolean(store?.getItem(reachedKey) || store?.getItem(workHistoryKey))
  } catch {
    return false
  }
}

export function rememberBridge(store: StorageLike | undefined = storage()): void {
  try {
    store?.setItem(reachedKey, '1')
  } catch {
    // Asked again next time.
  }
}

let known: Promise<boolean> | undefined

/** Whether the bridge is up and can stand in as the model. A yes is kept for the session; a no is asked again. */
export function bridgeModelReady(client: Pick<BridgeCompanionClient, 'status'> = new BridgeCompanionClient(), timeoutMs = bridgeProbeTimeoutMs): Promise<boolean> {
  if (known) return known
  // The bridge answers one request at a time, so a busy one is treated as away and the key is used instead.
  const late = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs))
  const asked = client.status().then((status) => status.claude && status.model === true, () => false)
  const probe: Promise<boolean> = Promise.race([asked, late]).then((ready) => {
    if (ready) rememberBridge()
    else if (known === probe) known = undefined
    return ready
  })
  known = probe
  return probe
}

export function forgetBridgeModel(): void {
  known = undefined
}

const protocol = [
  // Told only "the app runs tools for you", the small model tried to call them as functions of its own and gave up when that failed.
  'How you act: your whole reply is one structured answer with two fields, text and tool_calls. The tools listed below belong to the app, not to you: they are not functions you can call, and calling one directly fails with "No such tool available". To use one, put it in tool_calls with its name and its input, leave text empty, and end your reply; the app runs it and sends the result back in the next message. You may list several at once. When no tool is needed, answer in text and leave tool_calls empty. Every tool below works this way, so never say a tool is unavailable.',
  'The conversation arrives as one transcript. Reply only as the assistant, to the last thing in it.',
].join(' ')

function toolsSection(tools: AnthropicTool[]): string {
  return `Tools, as JSON:\n${JSON.stringify(tools.map(({ name, description, input_schema }) => ({ name, description, input_schema })))}`
}

export function renderSystem(request: Pick<MessagesRequest, 'system' | 'tools'>): string {
  const tools = request.tools ?? []
  return [request.system?.trim(), tools.length ? `${protocol}\n\n${toolsSection(tools)}` : 'Answer in text and leave tool_calls empty.'].filter(Boolean).join('\n\n')
}

function renderBlock(block: ContentBlock, names: Map<string, string>): string {
  if (block.type === 'text') return block.text
  if (block.type === 'tool_use') {
    names.set(block.id, block.name)
    return `[asked the app to run ${block.name} (${block.id}) with ${JSON.stringify(block.input)}]`
  }
  if (block.type === 'image' || block.type === 'document') return `[an attached ${block.type === 'image' ? 'photo' : 'pdf'} that cannot be read here: say so if it matters]`
  const name = names.get(block.tool_use_id) ?? 'tool'
  return `[${block.is_error ? 'error from' : 'result of'} ${name} (${block.tool_use_id})]\n${block.content}`
}

export function renderPrompt(messages: AnthropicMessage[]): string {
  const names = new Map<string, string>()
  return messages.map((message) => {
    const body = typeof message.content === 'string' ? message.content : message.content.map((block) => renderBlock(block, names)).join('\n')
    return `${message.role === 'user' ? 'USER' : 'ASSISTANT'}:\n${body}`
  }).join('\n\n')
}

type ModelReply = { text?: unknown; tool_calls?: unknown }

/** The reply as content blocks, the shape the companion's loop already reads. */
export function parseReply(raw: string, newId: () => string = () => `bridge_${crypto.randomUUID()}`): MessagesResponse {
  let reply: ModelReply
  try {
    const parsed: unknown = JSON.parse(raw)
    reply = parsed && typeof parsed === 'object' ? parsed as ModelReply : { text: raw }
  } catch {
    // Claude Code answered in plain words rather than the shape asked for; the words are still the answer.
    reply = { text: raw }
  }
  const content: ContentBlock[] = []
  const text = typeof reply.text === 'string' ? reply.text.trim() : ''
  if (text) content.push({ type: 'text', text })
  const calls = Array.isArray(reply.tool_calls) ? reply.tool_calls as { name?: unknown; input?: unknown }[] : []
  for (const call of calls) {
    if (typeof call?.name !== 'string' || !call.name) continue
    const input = call.input && typeof call.input === 'object' && !Array.isArray(call.input) ? call.input as Record<string, unknown> : {}
    content.push({ type: 'tool_use', id: newId(), name: call.name, input })
  }
  const usesTools = content.some((block) => block.type === 'tool_use')
  return { id: newId(), content, stop_reason: usesTools ? 'tool_use' : 'end_turn' }
}

function hasFiles(request: MessagesRequest): boolean {
  return request.messages.some((message) => typeof message.content !== 'string' && message.content.some((block) => block.type === 'image' || block.type === 'document'))
}

export class BridgeModelClient implements ChatClient {
  constructor(
    private readonly bridge: Pick<BridgeCompanionClient, 'model'> = new BridgeCompanionClient(),
    /** Takes over when the bridge has gone away mid-conversation: the personal key, when there is one. */
    private readonly fallback?: ChatClient,
    private readonly onUnreachable?: () => void,
  ) {}

  async createMessage(request: MessagesRequest): Promise<MessagesResponse> {
    // Claude Code takes the prompt as text, so a photo or pdf goes to the key, which can read it.
    if (this.fallback && hasFiles(request)) return await this.fallback.createMessage(request)
    let response
    try {
      response = await this.bridge.model({ system: renderSystem(request), prompt: renderPrompt(request.messages), model: request.model, effort: request.output_config?.effort })
    } catch (error) {
      if (!(error instanceof BridgeUnreachableError)) throw error
      forgetBridgeModel()
      this.onUnreachable?.()
      if (this.fallback) return await this.fallback.createMessage(request)
      throw error
    }
    if (response.isError) throw new AnthropicError(502, response.result, 'claude code')
    return parseReply(response.result)
  }
}
