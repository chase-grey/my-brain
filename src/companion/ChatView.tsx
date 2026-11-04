import { useEffect, useMemo, useRef, useState } from 'react'
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import type { Domain } from '../domain/types'
import type { AppSettings } from '../settings'
import { Icon } from '../navIcons'
import { Empty } from '../ui'
import { AnthropicClient } from './anthropicClient'
import { BridgeCompanionClient } from './bridgeCompanion'
import { CompanionError, createAnthropicCompanion, createBridgeCompanion, type Companion } from './companion'
import { buildSystemPrompt } from './companionPrompt'
import { memoryFolders } from './memory'
import { clearConversation, loadConversation, saveConversation, type CompanionConversation, type CompanionTurn } from './companionStore'
import type { CompanionActions, PlanSummary } from './companionTools'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured } from './githubVault'

type BridgeState = 'checking' | 'ready' | 'offline'

// Keys and tokens never contain whitespace; pasting on a phone often adds some.
function compact(value: string): string {
  return value.replace(/\s+/g, '')
}

// Off by default: each message starts a fresh conversation, so an answer is never coloured by what was asked before.
// The chat unmounts on every view change, so the choice lives here for the session rather than in the component.
const keepContextBySpace: Partial<Record<Domain, boolean>> = {}
const emptyConversation = (): CompanionConversation => ({ version: 1, turns: [] })

function toMessage(turn: CompanionTurn, index: number): ThreadMessageLike {
  return {
    id: `${turn.at}-${index}`,
    role: turn.role,
    content: [{ type: 'text', text: turn.text }],
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

function AssistantMessage() {
  return <MessagePrimitive.Root className="turn assistant"><MessagePrimitive.Content components={{ Text: MarkdownText }} /></MessagePrimitive.Root>
}

export function ChatView({ domain, settings, actions, summary, hasCalendar = false, onSettings, docked = false }: {
  domain: Domain
  settings: AppSettings
  actions: CompanionActions
  hasCalendar?: boolean
  summary: PlanSummary
  onSettings?: () => void
  docked?: boolean
}) {
  const [keepContext, setKeepContext] = useState(() => keepContextBySpace[domain] ?? false)
  // Only a kept thread comes back: with the toggle off, what is on screen has to match what the model was given, which is nothing yet.
  const [conversation, setConversation] = useState<CompanionConversation>(() => {
    if (keepContextBySpace[domain]) return loadConversation(domain)
    clearConversation(domain)
    return emptyConversation()
  })
  const [sending, setSending] = useState(false)
  const [bridge, setBridge] = useState<BridgeState>(domain === 'work' ? 'checking' : 'ready')
  const conversationRef = useRef(conversation)
  const historyRef = useRef<CompanionTurn[]>([])
  const actionsRef = useRef(actions)
  const hasCalendarRef = useRef(hasCalendar)
  hasCalendarRef.current = hasCalendar
  const summaryRef = useRef(summary)
  conversationRef.current = conversation
  actionsRef.current = actions
  summaryRef.current = summary

  const apiKey = compact(settings.anthropicApiKey)
  const vaultConfig = { repo: normalizeRepo(settings.githubRepo), token: compact(settings.githubToken), branch: normalizeBranch(settings.vaultBranch) }
  const hasVault = domain === 'personal' && vaultConfigured(vaultConfig)
  const hasKey = domain === 'work' || apiKey.length > 0

  const companion = useMemo<Companion | undefined>(() => {
    const systemPrompt = (memoryIndex?: string) => buildSystemPrompt({ domain, summary: summaryRef.current, vaultAvailable: domain === 'work' ? true : hasVault, memoryIndex })
    if (domain === 'work') {
      return createBridgeCompanion({ client: new BridgeCompanionClient(), sessionId: () => conversationRef.current.sessionId, systemPrompt })
    }
    if (!hasKey) return undefined
    return createAnthropicCompanion({
      client: new AnthropicClient(apiKey),
      model: settings.anthropicModel,
      history: () => historyRef.current,
      systemPrompt,
      actions: () => actionsRef.current,
      vault: hasVault ? new GitHubVault(vaultConfig) : undefined,
      memoryFolder: memoryFolders[domain],
      hasCalendar: () => hasCalendarRef.current,
    })
  }, [domain, hasKey, hasVault, settings.anthropicApiKey, settings.anthropicModel, vaultConfig.repo, vaultConfig.token, vaultConfig.branch])

  useEffect(() => {
    if (domain !== 'work') return
    let cancelled = false
    new BridgeCompanionClient().status()
      .then((status) => { if (!cancelled) setBridge(status.claude && status.vault ? 'ready' : 'offline') })
      .catch(() => { if (!cancelled) setBridge('offline') })
    return () => { cancelled = true }
  }, [domain])

  function update(next: CompanionConversation) {
    conversationRef.current = next
    setConversation(next)
    if (keepContext) saveConversation(domain, next)
    else clearConversation(domain)
  }

  function toggleKeepContext() {
    const next = !keepContext
    keepContextBySpace[domain] = next
    setKeepContext(next)
    if (next) saveConversation(domain, conversationRef.current)
    else clearConversation(domain)
  }

  async function onNew(message: AppendMessage) {
    const text = textOf(message)
    if (!text || sending || !companion) return
    // Without keep context the thread starts over on every send, so what is on screen is exactly what the model was given.
    const prior = keepContext ? conversationRef.current : emptyConversation()
    historyRef.current = prior.turns
    update({ ...prior, turns: [...prior.turns, { role: 'user', text, at: new Date().toISOString() }] })
    setSending(true)
    try {
      const reply = await companion.send(text)
      update({ ...conversationRef.current, sessionId: reply.sessionId ?? conversationRef.current.sessionId, turns: [...conversationRef.current.turns, { role: 'assistant', text: reply.text || 'done', at: new Date().toISOString() }] })
    } catch (error) {
      const text = error instanceof CompanionError ? error.message : 'something went wrong'
      if (error instanceof CompanionError && error.kind === 'unreachable' && domain === 'work') setBridge('offline')
      update({ ...conversationRef.current, turns: [...conversationRef.current.turns, { role: 'assistant', text, at: new Date().toISOString(), error: true }] })
    } finally {
      setSending(false)
    }
  }

  function reset() {
    clearConversation(domain)
    update(emptyConversation())
  }

  const unavailable = domain === 'personal' ? !hasKey : bridge === 'offline'
  const runtime = useExternalStoreRuntime({
    messages: conversation.turns,
    convertMessage: toMessage,
    isRunning: sending,
    isDisabled: unavailable || bridge === 'checking',
    onNew,
  })

  return <section className={`chat${docked ? ' is-docked' : ''}`} aria-label="chat">
    <header className="view-head">
      <h1>chat</h1>
      {!unavailable && <button className="pill" type="button" aria-pressed={keepContext} onClick={toggleKeepContext}>keep context</button>}
      {conversation.turns.length > 0 && <button className="link" type="button" onClick={reset}>clear</button>}
    </header>
    {unavailable
      ? <Empty>{domain === 'personal'
        ? <>no api key · <button className="link" type="button" onClick={onSettings}>add one in settings</button></>
        : 'only on the work pc'}</Empty>
      : <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="thread">
          <ThreadPrimitive.Viewport className="thread-viewport">
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            <ThreadPrimitive.If running><div className="turn assistant is-pending" aria-live="polite">…</div></ThreadPrimitive.If>
          </ThreadPrimitive.Viewport>
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input className="composer-input" aria-label="message" placeholder={bridge === 'checking' ? 'checking work pc' : 'message'} rows={1} maxRows={6} />
            <ComposerPrimitive.Send className="composer-send" aria-label="send"><Icon name="send" size={18} /></ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>}
  </section>
}
