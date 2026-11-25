import { useEffect, useMemo, useRef, useState } from 'react'
import { AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime, type AppendMessage, type ThreadMessageLike } from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import type { Domain } from '../domain/types'
import { copyText } from '../clipboard'
import { holdUpdates } from '../appUpdate'
import { autoModel, effortOptions, modelShortName, type AppSettings } from '../settings'
import { Icon } from '../navIcons'
import { Empty, Menu } from '../ui'
import { useVoice } from '../voice/useVoice'
import type { CompanionAction, ActionStatus } from './actions'
import { ActionHandlersContext, ActionPart, type ActionHandlers } from './ActionParts'
import { attachmentAccept, readAttachment, type Attachment } from './attachments'
import { activeModel, baseUrlFor, modelChoices, modelField, providerOf, usesAnthropic } from './aiProvider'
import { AnthropicClient } from './anthropicClient'
import { BridgeCompanionClient } from './bridgeCompanion'
import { BridgeModelClient, bridgeModelReady, bridgeReachedBefore, rememberBridge } from './bridgeModel'
import { CompanionError, createAnthropicCompanion, createBridgeCompanion, type AssistantReply, type Companion, type PendingApprovals, type Undo } from './companion'
import { buildSystemPrompt, pastePrompt } from './companionPrompt'
import { continuesThread } from './context'
import { attachMail, type MailReader } from './mailTools'
import { memoryFolders } from './memory'
import { clearHistory, conversationTitle, conversationUpdatedAt, deleteConversation, loadHistory, newConversation, saveConversation, type CompanionConversation, type CompanionTurn } from './companionStore'
import type { CompanionActions, PlanSummary } from './companionTools'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured, type VaultStore } from './githubVault'
import { JevClient } from './jev'
import { OpenAiCompatClient } from './openAiClient'
import { routeWithJev } from './route'

type BridgeState = 'checking' | 'ready' | 'offline'
/** The personal chat on the work pc's Claude Code: being looked for, in use, or not here. */
type Borrow = 'checking' | 'ready' | 'off'

// Keys and tokens never contain whitespace; pasting on a phone often adds some.
function compact(value: string): string {
  return value.replace(/\s+/g, '')
}

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
  // A photo still in memory shows as itself; anything else, or a photo from a stored thread, shows by name.
  for (const item of turn.attachments ?? []) {
    content.push(item.kind === 'image' && item.data
      ? { type: 'image', image: `data:${item.mediaType};base64,${item.data}`, filename: item.name }
      : { type: 'file', filename: item.name, data: '', mimeType: item.mediaType })
  }
  if (turn.text.trim() || (!turn.actions?.length && !turn.attachments?.length)) content.push({ type: 'text', text: turn.text })
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

function AttachedImage({ image, filename }: { image: string; filename?: string }) {
  return <img className="turn-image" src={image} alt={filename ?? ''} />
}

function AttachedFile({ filename }: { filename?: string }) {
  return <span className="turn-file">{filename}</span>
}

/** The one button beside the message box: it sends once there is something to send, and is the way into voice until then. */
export function composerButton({ voiceSupported, voiceOn, hasText, hasFiles }: { voiceSupported: boolean; voiceOn: boolean; hasText: boolean; hasFiles: boolean }): 'send' | 'voice' {
  if (!voiceSupported) return 'send'
  if (voiceOn) return 'voice'
  return hasText || hasFiles ? 'send' : 'voice'
}

export function UserMessage() {
  return <MessagePrimitive.Root className="turn user"><MessagePrimitive.Content components={{ Image: AttachedImage, File: AttachedFile }} /></MessagePrimitive.Root>
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

export function ChatView({ domain, settings, actions, summary, hasCalendar = false, onSettings, onChangeSettings, docked = false, talk = false, onTalkStarted, notesVault, userName, prefill, onPrefilled, mail, mailId, mailOff = false, onMailTaken }: {
  domain: Domain
  settings: AppSettings
  /** Notes in the account's OneDrive, used when no github vault is set up. */
  notesVault?: VaultStore
  userName?: string
  actions: CompanionActions
  hasCalendar?: boolean
  summary: PlanSummary
  onSettings?: () => void
  /** The model and effort pickers write through here. */
  onChangeSettings?: (change: Partial<AppSettings>) => void
  docked?: boolean
  /** Open already listening: the "talk" shortcut and the widget land here. */
  talk?: boolean
  onTalkStarted?: () => void
  /** Typed into the composer once, unsent: a new account's first request. */
  prefill?: string
  onPrefilled?: () => void
  /** The personal mailbox, read-only, while the account is connected. */
  mail?: MailReader
  /** A message the mail app handed over: a new thread opens about its conversation. */
  mailId?: string
  /** There is no connected account to read that message with. */
  mailOff?: boolean
  onMailTaken?: () => void
}) {
  // The chat unmounts on every view change. A thread still warm comes back; an older one waits in the history.
  const [conversation, setConversation] = useState<CompanionConversation>(() => {
    const last = loadHistory(domain)[0]
    return last && continuesThread({ turns: last.turns, now: Date.now() }) ? last : newConversation()
  })
  const [history, setHistory] = useState<CompanionConversation[]>()
  const [sending, setSending] = useState(false)
  // Picked for the next message and not sent yet.
  const [attached, setAttached] = useState<Attachment[]>([])
  const attachedRef = useRef(attached)
  attachedRef.current = attached
  const [reading, setReading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // A reload would drop them.
  useEffect(() => (attached.length ? holdUpdates() : undefined), [attached.length > 0])
  // A reload would cut off an answer that is still arriving.
  useEffect(() => (sending ? holdUpdates() : undefined), [sending])
  const [openedId, setOpenedId] = useState<string>()
  // Under auto, the model that answered last, shown beside the choice.
  const [answeredBy, setAnsweredBy] = useState<string>()
  const [bridge, setBridge] = useState<BridgeState>(domain === 'work' ? 'checking' : 'ready')
  // On a device that has reached the work bridge before, the personal chat asks it first and spends the personal key only when it is away.
  const [borrow, setBorrow] = useState<Borrow>(() => domain === 'personal' && settings.aiMode !== 'off' && bridgeReachedBefore() ? 'checking' : 'off')
  const [openingMail, setOpeningMail] = useState(false)
  const mailRef = useRef(mail)
  mailRef.current = mail
  const conversationRef = useRef(conversation)
  // A thread reopened from the history is carried on by the next message, whatever its age or topic.
  const pinnedRef = useRef(false)
  const keepRef = useRef<(follows?: number) => boolean>(() => true)
  const historyRef = useRef<CompanionTurn[]>([])
  const actionsRef = useRef(actions)
  const hasCalendarRef = useRef(hasCalendar)
  hasCalendarRef.current = hasCalendar
  const summaryRef = useRef(summary)
  // Session-only: the way back for each receipt, and the paused model turn behind each card.
  const undosRef = useRef(new Map<string, Undo>())
  const pendingRef = useRef(new Map<string, PendingApprovals>())
  conversationRef.current = conversation
  actionsRef.current = actions
  summaryRef.current = summary

  const apiKey = compact(settings.anthropicApiKey)
  const jevKey = compact(settings.jevApiKey)
  const provider = providerOf(settings.aiProvider)
  const viaBridge = domain === 'personal' && borrow === 'ready'
  // Claude Code only runs anthropic's models, whatever service the key is for.
  const modelSettings = viaBridge ? { ...settings, aiProvider: 'anthropic' } : settings
  const anthropic = usesAnthropic(domain, modelSettings)
  const baseUrl = baseUrlFor(settings)
  const model = activeModel(domain, modelSettings)
  const [copied, setCopied] = useState(false)
  const vaultConfig = { repo: normalizeRepo(settings.githubRepo), token: compact(settings.githubToken), branch: normalizeBranch(settings.vaultBranch) }
  const hasGitHubVault = domain === 'personal' && vaultConfigured(vaultConfig)
  const fallbackVault = domain === 'personal' && !hasGitHubVault ? notesVault : undefined
  const hasVault = hasGitHubVault || Boolean(fallbackVault)
  const keyReady = settings.aiMode === 'key' && apiKey.length > 0 && baseUrl.length > 0 && activeModel(domain, settings).length > 0
  const hasKey = domain === 'work' || viaBridge || keyReady

  const companion = useMemo<Companion | undefined>(() => {
    const systemPrompt = (memoryIndex?: string) => buildSystemPrompt({ domain, summary: summaryRef.current, vaultAvailable: domain === 'work' ? true : hasVault, memoryIndex, notes: fallbackVault ? 'onedrive' : 'homebase', userName, mailAvailable: domain === 'personal' && Boolean(mailRef.current), mail: conversationRef.current.mail })
    if (domain === 'work') {
      return createBridgeCompanion({ client: new BridgeCompanionClient(), sessionId: () => conversationRef.current.sessionId, systemPrompt, model: modelShortName(model), effort: settings.chatEffort })
    }
    if (!hasKey) return undefined
    const keyClient = () => usesAnthropic(domain, settings) ? new AnthropicClient(apiKey) : new OpenAiCompatClient(apiKey, baseUrl, provider.id === 'custom' ? 'the ai service' : provider.label)
    return createAnthropicCompanion({
      // If the bridge goes away mid-conversation an anthropic key carries on with the same models; another service's key waits for the next message.
      client: viaBridge ? new BridgeModelClient(new BridgeCompanionClient(), keyReady && usesAnthropic(domain, settings) ? keyClient() : undefined, () => setBorrow('off')) : keyClient(),
      model,
      effort: anthropic ? settings.chatEffort : undefined,
      route: anthropic && jevKey ? (ask) => routeWithJev(new JevClient(jevKey), ask) : undefined,
      history: () => historyRef.current,
      keep: (follows) => keepRef.current(follows),
      systemPrompt,
      actions: () => actionsRef.current,
      vault: hasGitHubVault ? new GitHubVault(vaultConfig) : fallbackVault,
      memoryFolder: memoryFolders[domain],
      hasCalendar: () => hasCalendarRef.current,
      mail: () => domain === 'personal' ? mailRef.current : undefined,
    })
  }, [domain, hasKey, viaBridge, keyReady, hasGitHubVault, fallbackVault, userName, settings.aiMode, settings.aiProvider, baseUrl, model, settings.anthropicApiKey, settings.jevApiKey, settings.chatEffort, vaultConfig.repo, vaultConfig.token, vaultConfig.branch])

  useEffect(() => {
    if (domain !== 'work') return
    let cancelled = false
    new BridgeCompanionClient().status()
      .then((status) => { rememberBridge(); if (!cancelled) setBridge(status.claude && status.vault ? 'ready' : 'offline') })
      .catch(() => { if (!cancelled) setBridge('offline') })
    return () => { cancelled = true }
  }, [domain])

  // Spoken words land in the message box as they are heard, after whatever was already typed there.
  const composerRef = useRef<{ getState(): { text: string }; setText(text: string): void } | undefined>(undefined)
  const typedRef = useRef('')
  useEffect(() => {
    if (borrow !== 'checking') return
    let cancelled = false
    void bridgeModelReady().then((ready) => { if (!cancelled) setBorrow(ready ? 'ready' : 'off') })
    return () => { cancelled = true }
  }, [borrow])

  const voice = useVoice({
    onListen: () => { typedRef.current = composerRef.current?.getState().text.trim() ?? '' },
    onText: (text) => composerRef.current?.setText([typedRef.current, text].filter(Boolean).join(' ')),
    onSend: () => {
      const text = composerRef.current?.getState().text.trim() ?? ''
      if (!text || sending || !companion) return voiceRef.current.stop()
      composerRef.current?.setText('')
      void sendText(text)
    },
    onProblem: (message) => appendTurn({ role: 'assistant', text: message, at: new Date().toISOString(), error: true }),
  })
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  // Opened from the "talk" shortcut or the widget: start listening once the chat can take a message.
  const talkStarted = useRef(false)
  useEffect(() => {
    if (!talk || talkStarted.current || !companion || bridge === 'checking' || borrow === 'checking') return
    talkStarted.current = true
    voiceRef.current.start()
    onTalkStarted?.()
  }, [talk, companion, bridge, borrow, onTalkStarted])

  function update(next: CompanionConversation) {
    conversationRef.current = next
    setConversation(next)
    saveConversation(domain, next)
  }

  function appendTurn(turn: CompanionTurn) {
    update({ ...conversationRef.current, turns: [...conversationRef.current.turns, turn] })
  }

  function failTurn(error: unknown) {
    const text = error instanceof CompanionError ? error.message : 'something went wrong'
    if (error instanceof CompanionError && error.kind === 'unreachable' && domain === 'work') setBridge('offline')
    appendTurn({ role: 'assistant', text, at: new Date().toISOString(), error: true })
    voiceRef.current.say(text, 'stop')
  }

  // One assistant turn per reply: its words, then its receipts and cards.
  function absorb(reply: AssistantReply) {
    for (const [id, undo] of Object.entries(reply.undos)) undosRef.current.set(id, undo)
    if (reply.pending) {
      for (const id of reply.pending.ids) pendingRef.current.set(id, reply.pending)
    }
    if (reply.model) setAnsweredBy(reply.model)
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
    voiceRef.current.sent()
    await sendText(textOf(message))
  }

  function pickFiles() {
    fileInput.current?.click()
  }

  async function attach(files: File[]) {
    setReading(true)
    for (const file of files) {
      try {
        const item = await readAttachment(file)
        setAttached((items) => [...items, item])
      } catch (error) {
        appendTurn({ role: 'assistant', text: error instanceof Error ? error.message : `can't attach ${file.name}`, at: new Date().toISOString(), error: true })
      }
    }
    setReading(false)
  }

  // The send button while files are attached: they can go with no words at all.
  function sendAttached() {
    const composer = runtime.thread.composer
    const text = composer.getState().text.trim()
    composer.setText('')
    void sendText(text)
  }

  async function sendText(text: string) {
    const attachments = attachedRef.current
    if ((!text && !attachments.length) || sending || !companion) return
    attachedRef.current = []
    setAttached([])
    expirePending()
    const before = conversationRef.current
    const turn: CompanionTurn = { role: 'user', text, at: new Date().toISOString(), ...(attachments.length ? { attachments } : {}) }
    const pinned = pinnedRef.current
    pinnedRef.current = false
    // Settled once per message: it carries on the thread, or the thread stays in the history and the message starts a new one.
    // Either way what is on screen afterwards is what the model was given.
    let kept: boolean | undefined
    const settle = (follows?: number) => {
      if (kept !== undefined) return kept
      // A thread opened about an email is about that email until a new chat is started, however long it sits and whatever the message says.
      kept = before.mail ? true : continuesThread({ turns: before.turns, follows, pinned, now: Date.now() })
      if (!kept) undosRef.current.clear()
      update({ ...(kept ? before : newConversation()), turns: [...(kept ? before.turns : []), turn] })
      return kept
    }
    historyRef.current = before.turns
    keepRef.current = settle
    // Shown at once; saved when settled. Work chat is never sent to Jev, so its thread settles on the clock alone.
    const shown = { ...before, turns: [...before.turns, turn] }
    conversationRef.current = shown
    setConversation(shown)
    if (domain === 'work') settle()
    setSending(true)
    try {
      const reply = await companion.send(text, attachments)
      settle()
      absorb(reply)
    } catch (error) {
      settle()
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

  // The work thread is a Claude Code session on this pc, so a terminal can pick it up where the chat left off.
  async function openInSessionRunner() {
    const { id, sessionId } = conversationRef.current
    if (!sessionId) return
    try {
      await new BridgeCompanionClient().openInSessionRunner(sessionId, conversationTitle(conversationRef.current).slice(0, 60))
      setOpenedId(id)
    } catch (error) {
      appendTurn({ role: 'assistant', text: error instanceof Error ? error.message.toLowerCase() : 'something went wrong', at: new Date().toISOString(), error: true })
    }
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
    pinnedRef.current = false
    show(newConversation())
  }

  function reopen(past: CompanionConversation) {
    expirePending()
    show(past)
    pinnedRef.current = true
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

  // The mail app handed a message over: a fresh thread opens about its whole conversation, and every message after stays on it.
  useEffect(() => {
    if (!mailId || domain !== 'personal') return
    const failed = (reason: string) => {
      show(newConversation())
      appendTurn({ role: 'assistant', text: reason, at: new Date().toISOString(), error: true })
    }
    if (!mail) {
      if (!mailOff) return
      failed('connect microsoft in settings to open that email')
      onMailTaken?.()
      return
    }
    let cancelled = false
    setOpeningMail(true)
    expirePending()
    mail.thread(mailId)
      .then((messages) => {
        if (cancelled) return
        show({ ...newConversation(), mail: attachMail(mailId, messages) })
      }, (error: unknown) => {
        if (!cancelled) failed(`could not open that email: ${error instanceof Error ? error.message.toLowerCase() : 'something went wrong'}`)
      })
      .finally(() => {
        if (cancelled) return
        setOpeningMail(false)
        onMailTaken?.()
      })
    return () => { cancelled = true }
  }, [mailId, mail, mailOff, domain])

  // While the bridge is still being looked for, a missing key is not yet the answer.
  const unavailable = domain === 'personal' ? !hasKey && borrow !== 'checking' : bridge === 'offline'

  async function copyPlan() {
    if (!await copyText(pastePrompt({ summary: summaryRef.current, userName }))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  const runtime = useExternalStoreRuntime({
    messages: conversation.turns,
    convertMessage: toMessage,
    isRunning: sending,
    isDisabled: unavailable || bridge === 'checking' || borrow === 'checking' || openingMail,
    onNew,
    onRespondToToolApproval,
  })
  composerRef.current = runtime.thread.composer
  const [hasText, setHasText] = useState(false)
  useEffect(() => {
    const composer = runtime.thread.composer
    const read = () => setHasText(composer.getState().text.trim().length > 0)
    read()
    return composer.subscribe(read)
  }, [runtime])
  const button = composerButton({ voiceSupported: voice.supported, voiceOn: voice.on, hasText, hasFiles: attached.length > 0 })

  useEffect(() => {
    if (!prefill || unavailable) return
    runtime.thread.composer.setText(prefill)
    onPrefilled?.()
  }, [prefill, unavailable])

  return <section className={`chat${docked ? ' is-docked' : ''}`} aria-label="chat">
    <header className="view-head">
      <h1>chat</h1>
      {!unavailable && domain === 'work' && conversation.sessionId && <button className="pill" type="button" disabled={sending || openedId === conversation.id} onClick={() => { void openInSessionRunner() }}>{openedId === conversation.id ? 'opened in session runner' : 'open in session runner'}</button>}
      {!unavailable && <Menu
        controls={<>
          <label className="menu-field">model<select className="picker" aria-label="model" value={model} onChange={(event) => onChangeSettings?.({ [modelField(domain, modelSettings)]: event.target.value })}>
            {modelChoices(domain, modelSettings).map((option) => <option key={option} value={option}>{option === autoModel && answeredBy ? `auto · ${modelShortName(answeredBy)}` : anthropic ? modelShortName(option) : option}</option>)}
          </select></label>
          {anthropic && model !== autoModel && <label className="menu-field">effort<select className="picker" aria-label="effort" value={settings.chatEffort} onChange={(event) => onChangeSettings?.({ chatEffort: event.target.value as AppSettings['chatEffort'] })}>
            {effortOptions.map((level) => <option key={level} value={level}>{level}</option>)}
          </select></label>}
        </>}
        items={[
          { label: 'new chat', onSelect: startNew, disabled: !conversation.turns.length && !conversation.mail },
          { label: history ? 'back to chat' : 'past chats', onSelect: () => setHistory(history ? undefined : loadHistory(domain)) },
          { label: 'upload', onSelect: pickFiles, disabled: reading },
        ]}
      />}
    </header>
    {unavailable
      ? <Empty>{domain === 'personal'
        ? settings.aiMode === 'paste'
          ? <button className="link" type="button" onClick={() => { void copyPlan() }}>{copied ? 'copied' : 'copy my plan for another ai app'}</button>
          : settings.aiMode === 'off'
            ? <>ai is off · <button className="link" type="button" onClick={onSettings}>turn it on in settings</button></>
            : <>no api key · <button className="link" type="button" onClick={onSettings}>add one in settings</button></>
        : 'only on the work pc'}</Empty>
      : <AssistantRuntimeProvider runtime={runtime}>
        <ActionHandlersContext.Provider value={handlers}>
          <ThreadPrimitive.Root className="thread">
            {history
              ? <HistoryList items={history} currentId={conversation.id} onOpen={reopen} onDelete={remove} onDeleteAll={removeAll} />
              : <ThreadPrimitive.Viewport className="thread-viewport">
                {conversation.mail && <p className="chat-about"><Icon name="mail" size={16} /><span>{conversation.mail.subject}</span>{conversation.mail.from && <small>{conversation.mail.from}</small>}</p>}
                <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
                <ThreadPrimitive.If running><div className="turn assistant is-pending" aria-live="polite">…</div></ThreadPrimitive.If>
              </ThreadPrimitive.Viewport>}
            <input ref={fileInput} type="file" hidden multiple accept={attachmentAccept} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void attach(files) }} />
            {attached.length > 0 && <ul className="attached" aria-label="attached">
              {attached.map((item, index) => <li key={`${item.name}-${index}`}>
                {item.kind === 'image' && item.data ? <img src={`data:${item.mediaType};base64,${item.data}`} alt={item.name} /> : <span>{item.name}</span>}
                <button type="button" aria-label={`remove ${item.name}`} onClick={() => setAttached((items) => items.filter((_, at) => at !== index))}><Icon name="close" size={14} /></button>
              </li>)}
            </ul>}
            <ComposerPrimitive.Root className="composer">
              <ComposerPrimitive.Input className="composer-input" aria-label="message" placeholder={bridge === 'checking' || borrow === 'checking' ? 'checking work pc' : openingMail ? 'opening email' : voice.state === 'listening' ? 'listening' : 'message'} rows={1} maxRows={6} />
              {button === 'voice'
                ? <button className={`composer-mic${voice.state !== 'idle' ? ` is-${voice.state}` : ''}`} type="button" aria-pressed={voice.on} aria-label={voice.on ? 'stop' : 'talk'} disabled={sending && !voice.on} onClick={voice.toggle}><Icon name="waveform" size={20} /></button>
                : attached.length
                  ? <button className="composer-send" type="button" aria-label="send" disabled={sending || reading} onClick={sendAttached}><Icon name="send" size={18} /></button>
                  : <ComposerPrimitive.Send className="composer-send" aria-label="send"><Icon name="send" size={18} /></ComposerPrimitive.Send>}
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
