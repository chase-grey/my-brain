import { actionLine, describeAction, type CompanionAction } from './actions'
import { AnthropicError, textOf, toolUses, type AnthropicMessage, type ChatClient, type ContentBlock, type ToolUseBlock } from './anthropicClient'
import { fileText, fromBase64, userContent, type Attachment } from './attachments'
import { BridgeUnreachableError, type BridgeCompanionClient } from './bridgeCompanion'
import { autoModel } from '../settings'
import { companionTools, executeTool, toolGroups, type CompanionActions, type ToolContext, type Undo } from './companionTools'
import type { CompanionTurn } from './companionStore'
import { contextTurns } from './context'
import { GitHubError, type VaultStore } from './githubVault'
import { readMemoryIndex } from './memory'
import { defaultRoute, handOffTool, rungs, topRung, type Route, type RouteAsk } from './route'

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
  /** The model that finished the reply. */
  model?: string
}

export interface Companion {
  send(text: string, attachments?: Attachment[]): Promise<AssistantReply>
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

const asBlocks = (content: AnthropicMessage['content']): ContentBlock[] => typeof content === 'string' ? [{ type: 'text', text: content }] : content

function historyMessages(turns: CompanionTurn[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = []
  for (const turn of turns) {
    const text = turn.error ? '' : turnText(turn)
    const attachments = turn.error ? [] : turn.attachments ?? []
    if (!text && !attachments.length) continue
    const content = userContent(text, attachments)
    const last = messages[messages.length - 1]
    if (last && last.role === turn.role) {
      last.content = typeof last.content === 'string' && typeof content === 'string' ? `${last.content}\n\n${content}` : [...asBlocks(last.content), ...asBlocks(content)]
    } else {
      messages.push({ role: turn.role, content })
    }
  }
  while (messages.length && messages[0].role !== 'user') messages.shift()
  return messages
}

function toolResult(use: ToolUseBlock, outcome: Awaited<ReturnType<typeof executeTool>>): ContentBlock {
  return { type: 'tool_result', tool_use_id: use.id, content: outcome.ok ? outcome.content : outcome.error, is_error: outcome.ok ? undefined : true }
}

export function createAnthropicCompanion(deps: {
  client: ChatClient
  /** A model name, or `auto`: each message starts on the rung the route names and the model can hand off upward. */
  model: string
  /** low | medium | high | xhigh | max; the api's own default when left out. Auto sets its own. */
  effort?: string
  /** Where a message starts, which tools it can do without, and whether it carries on the thread. Only auto uses the first two; the middle model with every tool when left out or when it fails. */
  route?: (ask: RouteAsk) => Promise<Route>
  /** The thread the message was sent under. */
  history: () => CompanionTurn[]
  /** Asked once per message, with the route's chance that it carries on: whether the thread goes along. It does when left out. */
  keep?: (follows?: number) => boolean
  systemPrompt: (memoryIndex?: string) => string
  actions: () => CompanionActions
  vault?: VaultStore
  memoryFolder?: string
  hasCalendar?: () => boolean
}): Companion {
  const memoryFolder = deps.memoryFolder ?? 'memory'
  const toolContext = (): ToolContext => ({ actions: deps.actions(), vault: deps.vault, memoryFolder })

  type Gate = { use: ToolUseBlock; action: CompanionAction }
  type Tools = ReturnType<typeof companionTools>
  /** `rung` is set only under auto; `allTools` is what a hand-off restores when the route left some out. */
  type Run = { messages: AnthropicMessage[]; system: string; tools: Tools; allTools: Tools; callsLeft: number; model: string; effort?: string; rung?: number }

  const canHandOff = (run: Run) => run.rung !== undefined && (run.rung < topRung || run.tools.length < run.allTools.length)

  function handOff(run: Run): boolean {
    if (!canHandOff(run)) return false
    run.rung = Math.min(run.rung! + 1, topRung)
    run.model = rungs[run.rung].model
    run.effort = rungs[run.rung].effort
    run.tools = run.allTools
    // The call that only handed off does not count against the turn.
    run.callsLeft += 1
    return true
  }

  async function runLoop(run: Run): Promise<AssistantReply> {
    const replyParts: string[] = []
    const actions: CompanionAction[] = []
    const undos: Record<string, Undo> = {}
    const toolCalls: AssistantReply['toolCalls'] = []
    const reply = (pending?: PendingApprovals): AssistantReply => ({ text: replyParts.join('\n\n'), actions, undos, toolCalls, model: run.model, ...(pending ? { pending } : {}) })
    try {
      while (run.callsLeft > 0) {
        run.callsLeft -= 1
        const tools = canHandOff(run) ? [...run.tools, handOffTool] : run.tools
        const response = await deps.client.createMessage({ model: run.model, system: run.system, messages: run.messages, tools, ...(run.effort ? { output_config: { effort: run.effort } } : {}) })
        const uses = toolUses(response.content)
        const handingOff = run.rung !== undefined && uses.some((use) => use.name === handOffTool.name)
        // What a model says while passing the request on is not the answer.
        const spoken = handingOff ? '' : textOf(response.content)
        if (spoken) replyParts.push(spoken)
        if (response.stop_reason !== 'tool_use' || !uses.length) {
          if (response.stop_reason === 'max_tokens') replyParts.push('…')
          return reply()
        }
        run.messages.push({ role: 'assistant', content: response.content })
        const results: ContentBlock[] = []
        const gates: Gate[] = []
        for (const use of uses) {
          if (handingOff && use.name === handOffTool.name) {
            const moved = handOff(run)
            results.push({ type: 'tool_result', tool_use_id: use.id, content: moved ? 'handed off. you are now the stronger model, with every tool. carry on with the request.' : 'there is no stronger model to hand off to. finish the request yourself.' })
            continue
          }
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
    async send(text, attachments = []) {
      const turns = deps.history()
      const available = { hasVault: Boolean(deps.vault), hasCalendar: deps.hasCalendar?.() ?? false }
      const allTools = companionTools(available)
      const auto = deps.model === autoModel
      const before = [...turns].reverse()
      const previousReply = before.find((turn) => turn.role === 'assistant' && !turn.error)?.text.slice(0, 400)
      const previousMessage = before.find((turn) => turn.role === 'user')?.text.slice(0, 400)
      // Neither read may block the turn: a failed route starts in the middle with every tool, and a failed index read
      // leaves the prompt saying so while the tools still work.
      const [route, memoryIndex] = await Promise.all([
        deps.route && (auto || turns.length) ? deps.route({ text: text || attachments.map((item) => item.name).join(', '), previousMessage, previousReply, groups: toolGroups(available) }).catch(() => defaultRoute) : defaultRoute,
        deps.vault ? readMemoryIndex(deps.vault, memoryFolder).catch(() => undefined) : undefined,
      ])
      const kept = (deps.keep ? deps.keep(route.follows) : true) ? contextTurns(turns) : []
      const messages = [...historyMessages(kept), { role: 'user', content: userContent(text, attachments) } satisfies AnthropicMessage]
      const start = auto
        ? { ...rungs[route.rung], rung: route.rung, tools: companionTools({ ...available, skip: route.skip }) }
        : { model: deps.model, effort: deps.effort, tools: allTools }
      return runLoop({ messages, system: deps.systemPrompt(memoryIndex), allTools, callsLeft: maxModelCalls, ...start })
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
    async send(text, attachments = []) {
      const sessionId = deps.sessionId()
      let response
      try {
        // Claude Code reads photos and pdfs from disk, so those are left on the pc first; a text file goes in the message itself.
        const files: string[] = []
        const words = [text]
        for (const item of attachments) {
          if (item.data === undefined) continue
          if (item.kind === 'text') words.unshift(fileText(item))
          else files.push(await deps.client.upload(item.name, fromBase64(item.data)))
        }
        response = await deps.client.chat({ text: words.filter(Boolean).join('\n\n'), ...(files.length ? { files } : {}), sessionId, systemPrompt: sessionId ? undefined : deps.systemPrompt(), ...(deps.model ? { model: deps.model } : {}), ...(deps.effort ? { effort: deps.effort } : {}) })
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
    if (error.status === 401 || error.status === 403) return new CompanionError('auth', `${error.service} rejected the api key`)
    if (error.status === 429 || error.status >= 500) return new CompanionError('busy', `${error.service} is busy, try again`)
    return new CompanionError('http', `${error.service} returned ${error.status}`)
  }
  if (error instanceof GitHubError) return new CompanionError('vault', error.message)
  if (error instanceof BridgeUnreachableError) return new CompanionError('unreachable', error.message)
  if (error instanceof TypeError) return new CompanionError('unreachable', `network request failed: ${error.message.toLowerCase()}`)
  return new CompanionError('http', error instanceof Error ? error.message.toLowerCase() : 'something went wrong')
}
