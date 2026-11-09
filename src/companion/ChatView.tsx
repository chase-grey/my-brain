import { useEffect, useMemo, useRef, useState } from 'react'
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import type { Domain } from '../domain/types'
import { companionModelOptions, effortOptions, modelShortName, type AppSettings } from '../settings'
import { Icon } from '../navIcons'
import { Empty } from '../ui'
import { useVoice } from '../voice/useVoice'
import type { CompanionAction, ActionStatus } from './actions'
import { ActionHandlersContext, ActionPart, type ActionHandlers } from './ActionParts'
import { AnthropicClient } from './anthropicClient'
import { BridgeCompanionClient } from './bridgeCompanion'
import { CompanionError, createAnthropicCompanion, createBridgeCompanion, type AssistantReply, type Companion, type PendingApprovals, type Undo } from './companion'
import { buildSystemPrompt } from './companionPrompt'
import { memoryFolders } from './memory'
import { clearHistory, conversationTitle, conversationUpdatedAt, deleteConversation, loadHistory, newConversation, saveConversation, type CompanionConversation, type CompanionTurn } from './companionStore'
import type { CompanionActions, PlanSummary } from './companionTools'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured } from './githubVault'

type BridgeState = 'checking' | 'ready' | 'offline'

// Keys and tokens never contain whitespace; pasting on a phone often adds some.
function compact(value: string): string {
  return value.replace(/\s+/g, '')
}

// Off by default: each message starts a fresh conversation, so an answer is never coloured by what was asked before.
// The chat unmounts on every view change, so the choice lives here for the session rather than in the component.
// It switches itself on when an action card appears, because approving the card resumes the same conversation.
const keepContextBySpace: Partial<Record<Domain, boolean>> = {}

// For the history list: time of day for today, otherwise the date.
function when(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase()
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) }).toLowerCase()
}

type MessagePart = Exclude<ThreadMessageLike['content'], string>[number]

function actionPart(action: CompanionAction): MessagePart {
  const waiting = action.status === 'pending' || action.status === 'running'
  return {
    type: 'tool-call',
    toolCallId: action.id,
    toolName: action.tool,
    args: {},
    artifact: action,
    ...(waiting ? {} : { result: action.status }),
    ...(action.weight === 'heavy' ? { approval: { id: action.id, dismissible: true, ...(waiting ? {} : { approved: action.status !== 'dismissed' && action.status !== 'expired' }) } } : {}),
  }
}

export function toMessage(turn: CompanionTurn, index: number): ThreadMessageLike {
  const content: MessagePart[] = []
  if (turn.text.trim() || !turn.actions?.length) content.push({ type: 'text', text: turn.text })
  for (const action of turn.actions ?? []) content.push(actionPart(action))
  return {
    id: `${turn.at}-${index}`,
    role: turn.role,
    content,
    createdAt: new Date(turn.at),
    ...(turn.error ? { status: { type: 'incomplete', reason: 'error', error: turn.text } } : {}),
  }
}

function textOf(message: AppendMessage): string {
  return message.content.map((part) => part.type === 'text' ? part.text : '').join('').trim()
}

function UserMessage() {
  return <MessagePrimitive.Root className="turn user"><MessagePrimitive.Content /></MessagePrimitive.Root>
}

function MarkdownText() {
  return <MarkdownTextPrimitive className="md" />
}

export function AssistantMessage() {
  return <MessagePrimitive.Root className="turn assistant"><MessagePrimitive.Content components={{ Text: MarkdownText, tools: { Fallback: ActionPart } }} /></MessagePrimitive.Root>
}

function withAction(turns: CompanionTurn[], id: string, change: Partial<CompanionAction>): CompanionTurn[] {
  return turns.map((turn) => turn.actions?.some((action) => action.id === id)
    ? { ...turn, actions: turn.actions.map((action) => action.id === id ? { ...action, ...change } : action) }
    : turn)
}

function withStatusForAll(turns: CompanionTurn[], from: ActionStatus[], to: ActionStatus): CompanionTurn[] {
  return turns.map((turn) => turn.actions?.some((action) => from.includes(action.status))
    ? { ...turn, actions: turn.actions.map((action) => from.includes(action.status) ? { ...action, status: to } : action) }
    : turn)
}

export function ChatView({ domain, settings, actions, summary, hasCalendar = false, onSettings, onChangeSettings, docked = false, talk = false, onTalkStarted }: {
  domain: Domain
  settings: AppSettings
  actions: CompanionActions
  hasCalendar?: boolean
  summary: PlanSummary
  onSettings?: () => void
  /** The model and effort pickers write through here. */
  onChangeSettings?: (change: Partial<AppSettings>) => void
  docked?: boolean
  /** Open already listening, hands-free: the "talk" shortcut and the widget land here. */
  talk?: boolean
  onTalkStarted?: () => void
}) {
  const [keepContext, setKeepContext] = useState(() => keepContextBySpace[domain] ?? false)
  // Only a kept thread comes back on its own: with the toggle off, what is on screen has to match what the model was given,
  // which is nothing yet. Every thread stays in the history either way.
  const [conversation, setConversation] = useState<CompanionConversation>(() => (keepContextBySpace[domain] ? loadHistory(domain)[0] : undefined) ?? newConversation())
  const [history, setHistory] = useState<CompanionConversation[]>()
  const [sending, setSending] = useState(false)
  const [bridge, setBridge] = useState<BridgeState>(domain === 'work' ? 'checking' : 'ready')
  const conversationRef = useRef(conversation)
  const keepContextRef = useRef(keepContext)
  const historyRef = useRef<CompanionTurn[]>([])
  const actionsRef = useRef(actions)
  const hasCalendarRef = useRef(hasCalendar)
  hasCalendarRef.current = hasCalendar
  const summaryRef = useRef(summary)
  // Session-only: the way back for each receipt, and the paused model turn behind each card.
  const undosRef = useRef(new Map<string, Undo>())
  const pendingRef = useRef(new Map<string, PendingApprovals>())
  conversationRef.current = conversation
  keepContextRef.current = keepContext
  actionsRef.current = actions
  summaryRef.current = summary

  const apiKey = compact(settings.anthropicApiKey)
  const vaultConfig = { repo: normalizeRepo(settings.githubRepo), token: compact(settings.githubToken), branch: normalizeBranch(settings.vaultBranch) }
  const hasVault = domain === 'personal' && vaultConfigured(vaultConfig)
  const hasKey = domain === 'work' || apiKey.length > 0

  const companion = useMemo<Companion | undefined>(() => {
    const systemPrompt = (memoryIndex?: string) => buildSystemPrompt({ domain, summary: summaryRef.current, vaultAvailable: domain === 'work' ? true : hasVault, memoryIndex })
    if (domain === 'work') {
      return createBridgeCompanion({ client: new BridgeCompanionClient(), sessionId: () => conversationRef.current.sessionId, systemPrompt, model: modelShortName(settings.anthropicModel), effort: settings.chatEffort })
    }
    if (!hasKey) return undefined
    return createAnthropicCompanion({
      client: new AnthropicClient(apiKey),
      model: settings.anthropicModel,
      effort: settings.chatEffort,
      history: () => historyRef.current,
      systemPrompt,
      actions: () => actionsRef.current,
      vault: hasVault ? new GitHubVault(vaultConfig) : undefined,
      memoryFolder: memoryFolders[domain],
      hasCalendar: () => hasCalendarRef.current,
    })
  }, [domain, hasKey, hasVault, settings.anthropicApiKey, settings.anthropicModel, settings.chatEffort, vaultConfig.repo, vaultConfig.token, vaultConfig.branch])

  useEffect(() => {
    if (domain !== 'work') return
    let cancelled = false
    new BridgeCompanionClient().status()
      .then((status) => { if (!cancelled) setBridge(status.claude && status.vault ? 'ready' : 'offline') })
      .catch(() => { if (!cancelled) setBridge('offline') })
    return () => { cancelled = true }
  }, [domain])

  const voice = useVoice({
    onTranscript: (text) => { void sendText(text) },
    onProblem: (message) => appendTurn({ role: 'assistant', text: message, at: new Date().toISOString(), error: true }),
  })
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  // Opened from the "talk" shortcut or the widget: go straight into hands-free once the chat can take a message.
  const talkStarted = useRef(false)
  useEffect(() => {
    if (!talk || talkStarted.current || !companion || bridge === 'checking') return
    talkStarted.current = true
    voiceRef.current.setHandsFree(true)
    onTalkStarted?.()
  }, [talk, companion, bridge, onTalkStarted])

  function update(next: CompanionConversation) {
    conversationRef.current = next
    setConversation(next)
    saveConversation(domain, next)
  }

  function setKeep(next: boolean) {
    keepContextBySpace[domain] = next
    keepContextRef.current = next
    setKeepContext(next)
  }

  function appendTurn(turn: CompanionTurn) {
    update({ ...conversationRef.current, turns: [...conversationRef.current.turns, turn] })
  }

  function failTurn(error: unknown) {
    const text = error instanceof CompanionError ? error.message : 'something went wrong'
    if (error instanceof CompanionError && error.kind === 'unreachable' && domain === 'work') setBridge('offline')
    appendTurn({ role: 'assistant', text, at: new Date().toISOString(), error: true })
    if (voiceRef.current.handsFree) {
      voiceRef.current.say(text)
      voiceRef.current.setHandsFree(false)
    }
  }

  // One assistant turn per reply: its words, then its receipts and cards. A reply with a card keeps the thread,
  // because the answer to the card continues this same conversation.
  function absorb(reply: AssistantReply) {
    for (const [id, undo] of Object.entries(reply.undos)) undosRef.current.set(id, undo)
    if (reply.pending) {
      for (const id of reply.pending.ids) pendingRef.current.set(id, reply.pending)
      if (!keepContextRef.current) setKeep(true)
    }
    const text = reply.text || (reply.actions.length ? '' : 'done')
    update({
      ...conversationRef.current,
      sessionId: reply.sessionId ?? conversationRef.current.sessionId,
      turns: [...conversationRef.current.turns, { role: 'assistant', text, at: new Date().toISOString(), ...(reply.actions.length ? { actions: reply.actions } : {}) }],
    })
    voiceRef.current.say(text)
  }

  // A new message closes any card still waiting: the model's turn behind it is abandoned, so nothing runs later by surprise.
  function expirePending() {
    if (!pendingRef.current.size) return
    pendingRef.current.clear()
    update({ ...conversationRef.current, turns: withStatusForAll(conversationRef.current.turns, ['pending', 'running'], 'expired') })
  }

  async function onNew(message: AppendMessage) {
    await sendText(textOf(message))
  }

  async function sendText(text: string) {
    if (!text || sending || !companion) return
    expirePending()
    // Without keep context each send is its own thread, so what is on screen is exactly what the model was given.
    const prior = keepContextRef.current ? conversationRef.current : newConversation()
    historyRef.current = prior.turns
    update({ ...prior, turns: [...prior.turns, { role: 'user', text, at: new Date().toISOString() }] })
    setSending(true)
    try {
      absorb(await companion.send(text))
    } catch (error) {
      failTurn(error)
    } finally {
      setSending(false)
    }
  }

  async function onRespondToToolApproval({ approvalId, approved }: { approvalId: string; approved: boolean }) {
    const pending = pendingRef.current.get(approvalId)
    if (!pending) return
    pendingRef.current.delete(approvalId)
    update({ ...conversationRef.current, turns: withAction(conversationRef.current.turns, approvalId, { status: 'running' }) })
    const last = !pending.ids.some((id) => pendingRef.current.has(id))
    if (last) setSending(true)
    try {
      const decision = await pending.decide(approvalId, approved)
      if (decision.undo) undosRef.current.set(approvalId, decision.undo)
      update({ ...conversationRef.current, turns: withAction(conversationRef.current.turns, approvalId, decision.action) })
      if (decision.reply) absorb(decision.reply)
    } catch (error) {
      update({ ...conversationRef.current, turns: withAction(conversationRef.current.turns, approvalId, { status: 'failed', error: error instanceof Error ? error.message : 'failed' }) })
      failTurn(error)
    } finally {
      if (last) setSending(false)
    }
  }

  const handlers: ActionHandlers = {
    canUndo: (id) => undosRef.current.has(id),
    undo: async (id) => {
      const undo = undosRef.current.get(id)
      if (!undo) return
      try {
        await undo()
        undosRef.current.delete(id)
        update({ ...conversationRef.current, turns: withAction(conversationRef.current.turns, id, { status: 'undone' }) })
      } catch (error) {
        appendTurn({ role: 'assistant', text: `undo failed: ${error instanceof Error ? error.message.toLowerCase() : 'something went wrong'}`, at: new Date().toISOString(), error: true })
      }
    },
  }

  // Session-only state belongs to the thread that made it: a fresh or reopened thread starts without it.
  function show(next: CompanionConversation) {
    undosRef.current.clear()
    pendingRef.current.clear()
    conversationRef.current = next
    setConversation(next)
    setHistory(undefined)
  }

  function startNew() {
    show(newConversation())
  }

  // Continuing an old thread needs its turns sent along, so reopening one switches keep context on.
  function reopen(past: CompanionConversation) {
    expirePending()
    show(past)
    setKeep(true)
  }

  function remove(id: string) {
    deleteConversation(domain, id)
    setHistory((items) => items?.filter((item) => item.id !== id))
    if (id === conversationRef.current.id) {
      undosRef.current.clear()
      pendingRef.current.clear()
      const next = newConversation()
      conversationRef.current = next
      setConversation(next)
    }
  }

  function removeAll() {
    if (!window.confirm('delete all conversations?')) return
    clearHistory(domain)
    setHistory([])
    if (conversationRef.current.turns.length) remove(conversationRef.current.id)
  }

  const unavailable = domain === 'personal' ? !hasKey : bridge === 'offline'
  const runtime = useExternalStoreRuntime({
    messages: conversation.turns,
    convertMessage: toMessage,
    isRunning: sending,
    isDisabled: unavailable || bridge === 'checking',
    onNew,
    onRespondToToolApproval,
  })

  return <section className={`chat${docked ? ' is-docked' : ''}`} aria-label="chat">
    <header className="view-head">
      <h1>chat</h1>
      {!unavailable && <button className="pill" type="button" aria-pressed={keepContext} onClick={() => setKeep(!keepContext)}>keep context</button>}
      {!unavailable && voice.supported && <button className="pill" type="button" aria-pressed={voice.handsFree} onClick={() => voice.setHandsFree(!voice.handsFree)}>hands-free</button>}
    </header>
    {unavailable
      ? <Empty>{domain === 'personal'
        ? <>no api key · <button className="link" type="button" onClick={onSettings}>add one in settings</button></>
        : 'only on the work pc'}</Empty>
      : <AssistantRuntimeProvider runtime={runtime}>
        <ActionHandlersContext.Provider value={handlers}>
          <ThreadPrimitive.Root className="thread">
            {history
              ? <HistoryList items={history} currentId={conversation.id} onOpen={reopen} onDelete={remove} onDeleteAll={removeAll} />
              : <ThreadPrimitive.Viewport className="thread-viewport">
                <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
                <ThreadPrimitive.If running><div className="turn assistant is-pending" aria-live="polite">…</div></ThreadPrimitive.If>
              </ThreadPrimitive.Viewport>}
            {voice.state !== 'idle' && <p className="voice-caption" aria-live="polite">{voice.state === 'speaking' ? 'speaking' : voice.transcript ? `listening · ${voice.transcript}` : 'listening'}</p>}
            <div className="chat-tools">
              <select className="picker" aria-label="model" value={settings.anthropicModel} onChange={(event) => onChangeSettings?.({ anthropicModel: event.target.value })}>
                {companionModelOptions.map((model) => <option key={model} value={model}>{modelShortName(model)}</option>)}
              </select>
              <select className="picker" aria-label="effort" value={settings.chatEffort} onChange={(event) => onChangeSettings?.({ chatEffort: event.target.value as AppSettings['chatEffort'] })}>
                {effortOptions.map((level) => <option key={level} value={level}>{level}</option>)}
              </select>
              <span className="chat-tools-gap" />
              <button className="icon-button" type="button" aria-label="history" aria-pressed={Boolean(history)} onClick={() => setHistory(history ? undefined : loadHistory(domain))}><Icon name="history" size={18} /></button>
              <button className="icon-button" type="button" aria-label="new chat" disabled={!conversation.turns.length} onClick={startNew}><Icon name="plus" size={18} /></button>
            </div>
            <ComposerPrimitive.Root className={`composer${voice.supported ? ' has-mic' : ''}`}>
              <ComposerPrimitive.Input className="composer-input" aria-label="message" placeholder={bridge === 'checking' ? 'checking work pc' : 'message'} rows={1} maxRows={6} />
              {voice.supported && <button className={`composer-mic${voice.state !== 'idle' ? ` is-${voice.state}` : ''}`} type="button" aria-pressed={voice.state === 'listening'} aria-label={voice.state === 'idle' ? 'talk' : 'stop'} disabled={sending && voice.state === 'idle'} onClick={voice.toggle}><Icon name="mic" size={18} /></button>}
              <ComposerPrimitive.Send className="composer-send" aria-label="send"><Icon name="send" size={18} /></ComposerPrimitive.Send>
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </ActionHandlersContext.Provider>
      </AssistantRuntimeProvider>}
  </section>
}

export function HistoryList({ items, currentId, onOpen, onDelete, onDeleteAll }: {
  items: CompanionConversation[]
  currentId?: string
  onOpen: (item: CompanionConversation) => void
  onDelete: (id: string) => void
  onDeleteAll: () => void
}) {
  if (!items.length) return <div className="chat-history"><Empty>no past conversations</Empty></div>
  return <div className="chat-history" aria-label="past conversations">
    <ul className="history-list">
      {items.map((item) => {
        const title = conversationTitle(item)
        const count = item.turns.length
        return <li key={item.id} className={item.id === currentId ? 'is-current' : ''}>
          <button className="history-main" type="button" onClick={() => onOpen(item)}>
            <span className="history-title">{title}</span>
            <small>{when(conversationUpdatedAt(item))} · {count} {count === 1 ? 'message' : 'messages'}</small>
          </button>
          <button className="history-delete" type="button" aria-label={`delete ${title}`} onClick={() => onDelete(item.id)}><Icon name="close" size={18} /></button>
        </li>
      })}
    </ul>
    <div className="actions"><button className="link" type="button" onClick={onDeleteAll}>delete all</button></div>
  </div>
}
