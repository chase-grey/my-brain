import { actionLine, describeAction, type CompanionAction } from './actions'
import { AnthropicError, textOf, toolUses, type AnthropicClient, type AnthropicMessage, type ContentBlock, type ToolUseBlock } from './anthropicClient'
import { BridgeUnreachableError, type BridgeCompanionClient } from './bridgeCompanion'
import { companionTools, executeTool, type CompanionActions, type ToolContext, type Undo } from './companionTools'
import type { CompanionTurn } from './companionStore'
import { GitHubError, type VaultStore } from './githubVault'
import { readMemoryIndex } from './memory'

export type { Undo } from './companionTools'

/** What approving or dismissing one gated action produced. `reply` arrives once every gate in the turn is decided. */
export type Decision = { action: CompanionAction; undo?: Undo; reply?: AssistantReply }
/** Heavy actions the model asked for that wait on the user. Deciding the last one resumes the model. */
export type PendingApprovals = { ids: string[]; decide(id: string, approved: boolean): Promise<Decision> }

export type AssistantReply = {
  text: string
  actions: CompanionAction[]
  /** The way back for each light action that ran, by action id. Lives for the session only. */
  undos: Record<string, Undo>
  toolCalls: { name: string; ok: boolean }[]
  pending?: PendingApprovals
  sessionId?: string
}

export interface Companion {
  send(text: string): Promise<AssistantReply>
}

export const maxModelCalls = 6

export class CompanionError extends Error {
  constructor(readonly kind: 'auth' | 'busy' | 'vault' | 'unreachable' | 'tool-cap' | 'http', message: string) {
    super(message)
  }
}

function turnText(turn: CompanionTurn): string {
  const lines = (turn.actions ?? []).map(actionLine)
  return [turn.text.trim(), ...lines].filter(Boolean).join('\n')
}

function historyMessages(turns: CompanionTurn[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = []
  for (const turn of turns) {
    const text = turn.error ? '' : turnText(turn)
    if (!text) continue
    const last = messages[messages.length - 1]
    if (last && last.role === turn.role) {
      last.content = `${last.content as string}\n\n${text}`
    } else {
      messages.push({ role: turn.role, content: text })
    }
  }
  while (messages.length && messages[0].role !== 'user') messages.shift()
  return messages
}

function toolResult(use: ToolUseBlock, outcome: Awaited<ReturnType<typeof executeTool>>): ContentBlock {
  return { type: 'tool_result', tool_use_id: use.id, content: outcome.ok ? outcome.content : outcome.error, is_error: outcome.ok ? undefined : true }
}

export function createAnthropicCompanion(deps: {
  client: AnthropicClient
  model: string
  /** low | medium | high | xhigh | max; the api's own default when left out. */
  effort?: string
  history: () => CompanionTurn[]
  systemPrompt: (memoryIndex?: string) => string
  actions: () => CompanionActions
  vault?: VaultStore
  memoryFolder?: string
  hasCalendar?: () => boolean
}): Companion {
  const memoryFolder = deps.memoryFolder ?? 'memory'
  const toolContext = (): ToolContext => ({ actions: deps.actions(), vault: deps.vault, memoryFolder })

  type Gate = { use: ToolUseBlock; action: CompanionAction }
  type Run = { messages: AnthropicMessage[]; system: string; tools: ReturnType<typeof companionTools>; callsLeft: number }

  async function runLoop(run: Run): Promise<AssistantReply> {
    const replyParts: string[] = []
    const actions: CompanionAction[] = []
    const undos: Record<string, Undo> = {}
    const toolCalls: AssistantReply['toolCalls'] = []
    const reply = (pending?: PendingApprovals): AssistantReply => ({ text: replyParts.join('\n\n'), actions, undos, toolCalls, ...(pending ? { pending } : {}) })
    try {
      while (run.callsLeft > 0) {
        run.callsLeft -= 1
        const response = await deps.client.createMessage({ model: deps.model, system: run.system, messages: run.messages, tools: run.tools, ...(deps.effort ? { output_config: { effort: deps.effort } } : {}) })
        const spoken = textOf(response.content)
        if (spoken) replyParts.push(spoken)
        const uses = toolUses(response.content)
        if (response.stop_reason !== 'tool_use' || !uses.length) {
          if (response.stop_reason === 'max_tokens') replyParts.push('…')
          return reply()
        }
        run.messages.push({ role: 'assistant', content: response.content })
        const results: ContentBlock[] = []
        const gates: Gate[] = []
        for (const use of uses) {
          const description = await describeAction(use.name, use.input, toolContext())
          if (description?.weight === 'heavy') {
            const action: CompanionAction = { ...description, weight: 'heavy', id: use.id, tool: use.name, status: 'pending' }
            actions.push(action)
            gates.push({ use, action })
            continue
          }
          const outcome = await executeTool(use.name, use.input, toolContext())
          toolCalls.push({ name: use.name, ok: outcome.ok })
          results.push(toolResult(use, outcome))
          if (!description) continue
          actions.push({ ...description, weight: 'light', id: use.id, tool: use.name, status: outcome.ok ? 'done' : 'failed', ...(outcome.ok ? {} : { error: outcome.error }) })
          if (outcome.ok && outcome.undo) undos[use.id] = outcome.undo
        }
        if (gates.length) return reply(awaitDecisions(run, results, gates))
        run.messages.push({ role: 'user', content: results })
      }
    } catch (error) {
      throw mapCompanionError(error)
    }
    throw new CompanionError('tool-cap', `stopped after ${maxModelCalls} tool calls`)
  }

  // The model's turn stays open until every gated action has an answer; then all the results go back in one message.
  function awaitDecisions(run: Run, results: ContentBlock[], gates: Gate[]): PendingApprovals {
    const decided = new Map<string, ContentBlock>()
    return {
      ids: gates.map((gate) => gate.use.id),
      async decide(id, approved) {
        const gate = gates.find((item) => item.use.id === id)
        if (!gate) throw new Error('no action waiting with that id')
        if (decided.has(id)) throw new Error('already decided')
        let decision: Decision
        if (approved) {
          const outcome = await executeTool(gate.use.name, gate.use.input, toolContext())
          decided.set(id, toolResult(gate.use, outcome))
          decision = { action: { ...gate.action, status: outcome.ok ? 'done' : 'failed', ...(outcome.ok ? {} : { error: outcome.error }) }, ...(outcome.ok && outcome.undo ? { undo: outcome.undo } : {}) }
        } else {
          decided.set(id, { type: 'tool_result', tool_use_id: id, content: 'the user dismissed this action in the app. do not retry it; carry on without it.', is_error: true })
          decision = { action: { ...gate.action, status: 'dismissed' } }
        }
        if (decided.size === gates.length) {
          run.messages.push({ role: 'user', content: [...results, ...gates.map((item) => decided.get(item.use.id)!)] })
          decision.reply = await runLoop(run)
        }
        return decision
      },
    }
  }

  return {
    async send(text) {
      const messages = [...historyMessages(deps.history()), { role: 'user', content: text } satisfies AnthropicMessage]
      const tools = companionTools({ hasVault: Boolean(deps.vault), hasCalendar: deps.hasCalendar?.() ?? false })
      // A failed index read must not block the turn; the prompt says it could not be read and the tools still work.
      const memoryIndex = deps.vault ? await readMemoryIndex(deps.vault, memoryFolder).catch(() => undefined) : undefined
      return runLoop({ messages, system: deps.systemPrompt(memoryIndex), tools, callsLeft: maxModelCalls })
    },
  }
}

export function createBridgeCompanion(deps: {
  client: BridgeCompanionClient
  sessionId: () => string | undefined
  systemPrompt: () => string
  /** A Claude Code alias ("sonnet") or full model name; the bridge's default when left out. */
  model?: string
  effort?: string
}): Companion {
  return {
    async send(text) {
      const sessionId = deps.sessionId()
      let response
      try {
        response = await deps.client.chat({ text, sessionId, systemPrompt: sessionId ? undefined : deps.systemPrompt(), ...(deps.model ? { model: deps.model } : {}), ...(deps.effort ? { effort: deps.effort } : {}) })
      } catch (error) {
        throw mapCompanionError(error)
      }
      if (response.isError) throw new CompanionError('http', response.text || 'claude code returned an error')
      return { text: response.text, actions: [], undos: {}, toolCalls: [], sessionId: response.sessionId }
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
