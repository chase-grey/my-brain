import { useEffect, useMemo, useRef, useState } from 'react'
import { isOld } from '../domain/age'
import { currentStore } from '../domain/shopping'
import { guessBatch, guessPrompt, guessRequest, parseGuesses, type TaskGuess } from '../domain/taskGuess'
import type { Domain, Project, Task } from '../domain/types'
import { autoModel, type AppSettings } from '../settings'
import { activeModel, baseUrlFor, providerOf, usesAnthropic } from './aiProvider'
import { AnthropicClient, textOf, type ChatClient } from './anthropicClient'
import { BridgeCompanionClient } from './bridgeCompanion'
import { BridgeModelClient, bridgeModelReady, bridgeReachedBefore } from './bridgeModel'
import { OpenAiCompatClient } from './openAiClient'
import { rungs } from './route'

export type GuessModel = { client: ChatClient; model: string; effort?: string }

type Bridge = { reached: () => boolean; ready: () => Promise<boolean> }

/**
 * Who guesses for this space. Work tasks only ever go to Claude Code on the work pc. Personal ones go where the
 * personal chat goes: the bridge when this device has one, the personal key when it does not. Nothing when there
 * is neither, and the tasks are sorted by hand as before.
 */
export async function guessModel(domain: Domain, settings: AppSettings, bridge: Bridge = { reached: bridgeReachedBefore, ready: () => bridgeModelReady() }): Promise<GuessModel | undefined> {
  const cheapest = rungs[0]
  if (domain === 'work') {
    return await bridge.ready() ? { client: new BridgeModelClient(new BridgeCompanionClient()), ...cheapest } : undefined
  }
  if (settings.aiMode === 'off') return undefined
  const apiKey = settings.anthropicApiKey.replace(/\s+/g, '')
  const baseUrl = baseUrlFor(settings)
  const anthropic = usesAnthropic('personal', settings)
  const picked = activeModel('personal', settings)
  const provider = providerOf(settings.aiProvider)
  const keyed = settings.aiMode === 'key' && apiKey && baseUrl && (anthropic || (picked && picked !== autoModel))
  const keyClient = () => anthropic ? new AnthropicClient(apiKey) : new OpenAiCompatClient(apiKey, baseUrl, provider.id === 'custom' ? 'the ai service' : provider.label)
  if (bridge.reached() && await bridge.ready()) return { client: new BridgeModelClient(new BridgeCompanionClient(), keyed && anthropic ? keyClient() : undefined), ...cheapest }
  if (!keyed) return undefined
  return anthropic ? { client: keyClient(), ...cheapest } : { client: keyClient(), model: picked }
}

/** One request for up to a batch of tasks. */
export async function guessTasks(tasks: Task[], domain: Domain, projects: Project[], { client, model, effort }: GuessModel): Promise<Record<string, TaskGuess>> {
  const response = await client.createMessage({
    model, system: guessPrompt(domain, projects), messages: [{ role: 'user', content: guessRequest(tasks) }], max_tokens: 2500,
    ...(effort ? { output_config: { effort } } : {}),
  })
  return parseGuesses(textOf(response.content), tasks, domain, projects)
}

/** A guess is made once for a task's wording and kept on the device. `on` is the day it was made. */
export type KeptGuesses = Record<string, { title: string; on: string; guess: TaskGuess }>

// v2: a guess can carry a reminder. The guesses kept before it could are made again.
const storageKey = (domain: Domain) => `my-brain.${domain}.taskGuesses.v2`

/** Guesses leave when their task is no longer waiting to be sorted, and in any case once they are old. */
export function prunedGuesses(kept: KeptGuesses, waitingIds: ReadonlySet<string> | undefined, now: string): KeptGuesses {
  return Object.fromEntries(Object.entries(kept).filter(([id, entry]) => !isOld(entry.on, now) && (!waitingIds || waitingIds.has(id))))
}

export function loadGuesses(domain: Domain, now = new Date().toISOString()): KeptGuesses {
  try {
    const kept = JSON.parse(localStorage.getItem(storageKey(domain)) ?? '{}') as KeptGuesses
    for (const entry of Object.values(kept)) if (entry.guess?.storeType) entry.guess.storeType = currentStore(entry.guess.storeType)
    return prunedGuesses(kept, undefined, now)
  } catch {
    return {}
  }
}

function saveGuesses(domain: Domain, kept: KeptGuesses): void {
  try {
    localStorage.setItem(storageKey(domain), JSON.stringify(kept))
    localStorage.removeItem(`my-brain.${domain}.taskGuesses.v1`)
  } catch {
    // Guessed again next time.
  }
}

const sameWords = (task: Task) => `${task.id}\n${task.title}`

/**
 * Guesses for the tasks waiting to be sorted, asked for in the background a batch at a time. Each wording is
 * asked about once a session: a failed or empty answer leaves the task to be sorted by hand, never asked in a loop.
 */
export function useTaskGuesses({ domain, tasks, projects, settings }: { domain: Domain; tasks: Task[]; projects: Project[]; settings: AppSettings }): Record<string, TaskGuess> {
  const [kept, setKept] = useState<Partial<Record<Domain, KeptGuesses>>>({})
  const [round, setRound] = useState(0)
  const asked = useRef(new Set<string>())
  const busy = useRef(false)
  const current = useMemo(() => kept[domain] ?? loadGuesses(domain), [kept, domain])
  const waiting = tasks.filter((task) => current[task.id]?.title !== task.title && !asked.current.has(sameWords(task)))
  const signature = waiting.map(sameWords).join('\n\n')
  const latest = useRef({ tasks, projects, settings, current, waiting })
  latest.current = { tasks, projects, settings, current, waiting }

  useEffect(() => {
    const { tasks, projects, settings, current, waiting } = latest.current
    if (!waiting.length || busy.current) return
    const batch = waiting.slice(0, guessBatch)
    busy.current = true
    void (async () => {
      let called = false
      try {
        const model = await guessModel(domain, settings)
        if (!model) return
        called = true
        for (const task of batch) asked.current.add(sameWords(task))
        const guesses = await guessTasks(batch, domain, projects, model)
        const on = new Date().toISOString()
        const next = prunedGuesses({ ...current, ...Object.fromEntries(batch.filter((task) => guesses[task.id]).map((task) => [task.id, { title: task.title, on, guess: guesses[task.id] }])) }, new Set(tasks.map((task) => task.id)), on)
        saveGuesses(domain, next)
        setKept((all) => ({ ...all, [domain]: next }))
      } catch {
        // No guess for these; they are sorted by hand.
      } finally {
        busy.current = false
        // The next batch, or whatever arrived while this one was out. With no model there is nothing to go round for.
        if (called) setRound((value) => value + 1)
      }
    })()
  }, [signature, domain, round, settings.aiMode, settings.aiProvider, settings.anthropicApiKey, settings.aiBaseUrl, settings.aiModel])

  return useMemo(() => Object.fromEntries(tasks.filter((task) => current[task.id]?.title === task.title).map((task) => [task.id, current[task.id].guess])), [tasks, current])
}
