import { AnthropicError, textOf, toolUses, type AnthropicClient, type AnthropicMessage, type ContentBlock } from './anthropicClient'
import { BridgeUnreachableError, type BridgeCompanionClient } from './bridgeCompanion'
import { companionTools, executeTool, type CompanionActions } from './companionTools'
import type { CompanionTurn } from './companionStore'
import { GitHubError, type VaultStore } from './githubVault'

export type AssistantReply = { text: string; toolCalls: { name: string; ok: boolean }[]; sessionId?: string }

export interface Companion {
  send(text: string): Promise<AssistantReply>
}

export const maxModelCalls = 6

export class CompanionError extends Error {
  constructor(readonly kind: 'auth' | 'busy' | 'vault' | 'unreachable' | 'tool-cap' | 'http', message: string) {
    super(message)
  }
}

function historyMessages(turns: CompanionTurn[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = []
  for (const turn of turns) {
    if (turn.error || !turn.text.trim()) continue
    const last = messages[messages.length - 1]
    if (last && last.role === turn.role) {
      last.content = `${last.content as string}\n\n${turn.text}`
    } else {
      messages.push({ role: turn.role, content: turn.text })
    }
  }
  while (messages.length && messages[0].role !== 'user') messages.shift()
  return messages
}

export function createAnthropicCompanion(deps: {
  client: AnthropicClient
  model: string
  history: () => CompanionTurn[]
  systemPrompt: () => string
  actions: () => CompanionActions
  vault?: VaultStore
}): Companion {
  return {
    async send(text) {
      const messages = [...historyMessages(deps.history()), { role: 'user', content: text } satisfies AnthropicMessage]
      const tools = companionTools({ hasVault: Boolean(deps.vault) })
      const system = deps.systemPrompt()
      const replyParts: string[] = []
      const toolCalls: AssistantReply['toolCalls'] = []
      try {
        for (let call = 0; call < maxModelCalls; call++) {
          const response = await deps.client.createMessage({ model: deps.model, system, messages, tools })
          const spoken = textOf(response.content)
          if (spoken) replyParts.push(spoken)
          const uses = toolUses(response.content)
          if (response.stop_reason !== 'tool_use' || !uses.length) {
            if (response.stop_reason === 'max_tokens') replyParts.push('…')
            return { text: replyParts.join('\n\n'), toolCalls }
          }
          messages.push({ role: 'assistant', content: response.content })
          const results: ContentBlock[] = []
          for (const use of uses) {
            const outcome = await executeTool(use.name, use.input, { actions: deps.actions(), vault: deps.vault })
            toolCalls.push({ name: use.name, ok: outcome.ok })
            results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.ok ? outcome.content : outcome.error, is_error: outcome.ok ? undefined : true })
          }
          messages.push({ role: 'user', content: results })
        }
      } catch (error) {
        throw mapCompanionError(error)
      }
      throw new CompanionError('tool-cap', `stopped after ${maxModelCalls} tool calls`)
    },
  }
}

export function createBridgeCompanion(deps: {
  client: BridgeCompanionClient
  sessionId: () => string | undefined
  systemPrompt: () => string
}): Companion {
  return {
    async send(text) {
      const sessionId = deps.sessionId()
      let response
      try {
        response = await deps.client.chat({ text, sessionId, systemPrompt: sessionId ? undefined : deps.systemPrompt() })
      } catch (error) {
        throw mapCompanionError(error)
      }
      if (response.isError) throw new CompanionError('http', response.text || 'claude code returned an error')
      return { text: response.text, toolCalls: [], sessionId: response.sessionId }
    },
  }
}

export function mapCompanionError(error: unknown): CompanionError {
  if (error instanceof CompanionError) return error
  if (error instanceof AnthropicError) {
    if (error.status === 401 || error.status === 403) return new CompanionError('auth', 'anthropic rejected the api key')
    if (error.status === 429 || error.status >= 500) return new CompanionError('busy', 'anthropic is busy, try again')
    return new CompanionError('http', `anthropic returned ${error.status}`)
  }
  if (error instanceof GitHubError) return new CompanionError('vault', error.message)
  if (error instanceof BridgeUnreachableError) return new CompanionError('unreachable', error.message)
  if (error instanceof TypeError) return new CompanionError('unreachable', `network request failed: ${error.message.toLowerCase()}`)
  return new CompanionError('http', error instanceof Error ? error.message.toLowerCase() : 'something went wrong')
}
