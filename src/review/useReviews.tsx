import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { activeModel, baseUrlFor, providerOf, usesAnthropic } from '../companion/aiProvider'
import { AnthropicClient, type ChatClient } from '../companion/anthropicClient'
import { BridgeCompanionClient } from '../companion/bridgeCompanion'
import { mapCompanionError } from '../companion/companion'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured, type VaultStore } from '../companion/githubVault'
import { OpenAiCompatClient } from '../companion/openAiClient'
import { rungs } from '../companion/route'
import type { Domain, Task } from '../domain/types'
import type { ProductState } from '../productState'
import type { AppSettings } from '../settings'
import { ReviewView } from '../views/ReviewView'
import { loadBumps } from './bumpLog'
import { loadDigest } from './digest'
import { hasActivity } from './facts'
import { lastCompleted, owedReviews, seedMarkers, type Period, type ReviewKind, type ReviewMarkers } from './period'
import { createBridgeReviewer, createKeyReviewer, type Reviewer } from './reviewer'
import { localReviewStore, vaultReviewStore, type Review } from './review'
import { answerQuestion, countedReview, runReview, type ReviewDeps } from './runReview'

const markersKey = (domain: Domain) => `my-brain.${domain}.review-seen.v1`
const compact = (value: string) => value.replace(/\s+/g, '')

function loadMarkers(domain: Domain): ReviewMarkers {
  try {
    return JSON.parse(localStorage.getItem(markersKey(domain)) ?? '{}') as ReviewMarkers
  } catch {
    return {}
  }
}

function saveMarkers(domain: Domain, markers: ReviewMarkers): void {
  try {
    localStorage.setItem(markersKey(domain), JSON.stringify(markers))
  } catch {
    // The review shows again next time, which is the safe side.
  }
}

/** The weekly review runs on the middle model, the month and the year on the strongest; journal entries are read by the cheapest. */
const reviewRung = (kind: ReviewKind) => rungs[kind === 'week' ? 1 : 2]

type Shown = { period: Period; review: Review; writing: boolean; error?: string; owed: boolean }

export function useReviews({ domain, currentDay, tasks, product, settings, notesVault, userName }: {
  domain: Domain
  currentDay: string
  tasks: Task[]
  product: ProductState
  settings: AppSettings
  /** The onedrive notes folder, used when no github vault is set. */
  notesVault?: VaultStore
  userName?: string
}): { open: (kind: ReviewKind) => void; overlay: ReactNode } {
  const [shown, setShown] = useState<Shown>()
  const latest = useRef({ tasks, product })
  latest.current = { tasks, product }
  const started = useRef(false)

  const apiKey = compact(settings.anthropicApiKey)
  const baseUrl = baseUrlFor(settings)
  const anthropic = usesAnthropic(domain, settings)
  const chatModel = activeModel(domain, settings)
  const vaultConfig = { repo: normalizeRepo(settings.githubRepo), token: compact(settings.githubToken), branch: normalizeBranch(settings.vaultBranch) }

  const parts = useMemo(() => {
    const local = localReviewStore(domain)
    if (domain === 'work') return { store: local, reviewer: createBridgeReviewer({ client: new BridgeCompanionClient(), name: userName }) as Reviewer | undefined, journal: undefined }
    const vault = vaultConfigured(vaultConfig) ? new GitHubVault(vaultConfig) : notesVault
    const store = vault ? vaultReviewStore(vault, local) : local
    if (settings.aiMode !== 'key' || !apiKey || !baseUrl || !chatModel) return { store, reviewer: undefined, journal: undefined }
    const provider = providerOf(settings.aiProvider)
    const client: ChatClient = anthropic ? new AnthropicClient(apiKey) : new OpenAiCompatClient(apiKey, baseUrl, provider.id === 'custom' ? 'the ai service' : provider.label)
    const reviewer = createKeyReviewer({ client, name: userName, model: (kind) => anthropic ? reviewRung(kind).model : chatModel, effort: (kind) => anthropic ? reviewRung(kind).effort : undefined })
    const journal: ReviewDeps['journal'] = vault ? (range, fresh) => loadDigest({ vault, client, model: anthropic ? rungs[0].model : chatModel, range, fresh }) : undefined
    return { store, reviewer, journal }
  }, [domain, userName, notesVault, settings.aiMode, settings.aiProvider, apiKey, baseUrl, anthropic, chatModel, vaultConfig.repo, vaultConfig.token, vaultConfig.branch])

  const depsFor = (period: Period): ReviewDeps => ({ domain, period, today: currentDay, tasks: latest.current.tasks, product: latest.current.product, bumps: loadBumps(domain), ...parts })

  function show(period: Period, owed: boolean): void {
    const deps = depsFor(period)
    setShown({ period, review: countedReview(deps), writing: true, owed })
    runReview(deps)
      .then((review) => setShown((current) => current?.period.key === period.key && current.period.kind === period.kind ? { ...current, review, writing: false } : current))
      .catch((error: unknown) => setShown((current) => current?.period.key === period.key && current.period.kind === period.kind ? { ...current, writing: false, error: mapCompanionError(error).message } : current))
  }

  /** The next review that is owed and has something in it; empty periods are marked seen without a screen. */
  function showOwed(): void {
    let markers = loadMarkers(domain)
    if (!markers.week || !markers.month || !markers.year) {
      markers = seedMarkers(markers, currentDay)
      saveMarkers(domain, markers)
    }
    for (const period of owedReviews(markers, currentDay).reverse()) {
      if (hasActivity(depsFor(period))) { show(period, true); return }
      markers = { ...markers, [period.kind]: period.key }
      saveMarkers(domain, markers)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    showOwed()
  }, [])

  function close(): void {
    const closing = shown
    setShown(undefined)
    if (!closing?.owed) return
    saveMarkers(domain, { ...loadMarkers(domain), [closing.period.kind]: closing.period.key })
    showOwed()
  }

  async function answer(index: number, text: string): Promise<void> {
    if (!shown) return
    const review = await answerQuestion(parts.store, shown.review, index, text, currentDay)
    setShown((current) => current && { ...current, review })
  }

  const overlay = shown && <ReviewView key={`${shown.period.kind}:${shown.period.key}`} period={shown.period} review={shown.review} writing={shown.writing} error={shown.error}
    onRetry={() => show(shown.period, shown.owed)} onAnswer={answer} onClose={close} />
  return { open: (kind) => show(lastCompleted(kind, currentDay), false), overlay }
}
