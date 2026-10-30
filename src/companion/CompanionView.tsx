import { useEffect, useMemo, useRef, useState } from 'react'
import type { Domain } from '../domain/types'
import type { AppSettings } from '../settings'
import { AnthropicClient } from './anthropicClient'
import { BridgeCompanionClient } from './bridgeCompanion'
import { CompanionError, createAnthropicCompanion, createBridgeCompanion, type Companion } from './companion'
import { buildSystemPrompt } from './companionPrompt'
import { clearConversation, loadConversation, saveConversation, type CompanionConversation } from './companionStore'
import type { CompanionActions, PlanSummary } from './companionTools'
import { GitHubVault, vaultConfigured } from './githubVault'

type BridgeState = 'checking' | 'ready' | 'offline'

export function CompanionView({ domain, settings, actions, summary }: {
  domain: Domain
  settings: AppSettings
  actions: CompanionActions
  summary: PlanSummary
}) {
  const [conversation, setConversation] = useState<CompanionConversation>(() => loadConversation(domain))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [bridge, setBridge] = useState<BridgeState>(domain === 'work' ? 'checking' : 'ready')
  const conversationRef = useRef(conversation)
  const actionsRef = useRef(actions)
  const summaryRef = useRef(summary)
  const endRef = useRef<HTMLDivElement>(null)
  conversationRef.current = conversation
  actionsRef.current = actions
  summaryRef.current = summary

  const vaultConfig = { repo: settings.githubRepo.trim(), token: settings.githubToken.trim(), branch: settings.vaultBranch.trim() || 'main' }
  const hasVault = domain === 'personal' && vaultConfigured(vaultConfig)
  const hasKey = domain === 'work' || settings.anthropicApiKey.trim().length > 0

  const companion = useMemo<Companion | undefined>(() => {
    const systemPrompt = () => buildSystemPrompt({ domain, summary: summaryRef.current, vaultAvailable: domain === 'work' ? true : hasVault })
    if (domain === 'work') {
      return createBridgeCompanion({ client: new BridgeCompanionClient(), sessionId: () => conversationRef.current.sessionId, systemPrompt })
    }
    if (!hasKey) return undefined
    return createAnthropicCompanion({
      client: new AnthropicClient(settings.anthropicApiKey.trim()),
      model: settings.anthropicModel,
      history: () => conversationRef.current.turns,
      systemPrompt,
      actions: () => actionsRef.current,
      vault: hasVault ? new GitHubVault(vaultConfig) : undefined,
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

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [conversation.turns.length, sending])

  function update(next: CompanionConversation) {
    conversationRef.current = next
    setConversation(next)
    saveConversation(domain, next)
  }

  async function send(event: React.FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending || !companion) return
    const now = new Date().toISOString()
    update({ ...conversationRef.current, turns: [...conversationRef.current.turns, { role: 'user', text, at: now }] })
    setDraft('')
    setSending(true)
    try {
      const reply = await companion.send(text)
      update({ ...conversationRef.current, sessionId: reply.sessionId ?? conversationRef.current.sessionId, turns: [...conversationRef.current.turns, { role: 'assistant', text: reply.text || 'done', at: new Date().toISOString() }] })
    } catch (error) {
      const message = error instanceof CompanionError ? error.message : 'something went wrong'
      if (error instanceof CompanionError && error.kind === 'unreachable' && domain === 'work') setBridge('offline')
      update({ ...conversationRef.current, turns: [...conversationRef.current.turns, { role: 'assistant', text: message, at: new Date().toISOString(), error: true }] })
    } finally {
      setSending(false)
    }
  }

  function reset() {
    clearConversation(domain)
    update({ version: 1, turns: [] })
  }

  const unavailable = domain === 'personal' ? !hasKey : bridge === 'offline'
  const emptyCopy = domain === 'personal' ? 'add an anthropic key in settings' : 'only on the work pc'

  return <section className="companion-view" aria-labelledby="companion-title">
    <div className="section-heading companion-heading">
      <h1 id="companion-title">companion</h1>
      {conversation.turns.length > 0 && <button className="text-action" type="button" onClick={reset}>new conversation</button>}
    </div>
    {unavailable ? <div className="list-empty"><p>{emptyCopy}</p></div> : <>
      <div className="companion-turns" aria-live="polite">
        {conversation.turns.map((turn, index) => <article className={`companion-turn ${turn.role}${turn.error ? ' is-error' : ''}`} key={`${turn.at}-${index}`}>
          <p>{turn.text}</p>
        </article>)}
        {sending && <article className="companion-turn assistant is-pending"><p>…</p></article>}
        <div ref={endRef} />
      </div>
      <form className="quick-item companion-composer" onSubmit={(event) => void send(event)}>
        <input aria-label="message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={bridge === 'checking' ? 'checking work pc' : 'message'} disabled={sending || bridge === 'checking'} />
        <button type="submit" disabled={!draft.trim() || sending || bridge === 'checking'}>send</button>
      </form>
    </>}
  </section>
}
