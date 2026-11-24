import { chatModel, chatModelOptions, type AppSettings } from '../settings'
import type { Domain } from '../domain/types'

/**
 * Where the personal chat's key goes. The same presets as the workout tracker: three services that
 * take browser calls, and a hand-typed base url for anything else that speaks OpenAI's
 * chat-completions wire. The key itself stays in `anthropicApiKey`, whichever service it is for.
 */
export type ProviderId = 'anthropic' | 'openai' | 'openrouter' | 'custom'

/** Which request format a provider speaks. Anthropic has its own; the rest copy OpenAI's. */
export type Wire = 'anthropic' | 'openai'

export type Provider = {
  id: ProviderId
  label: string
  wire: Wire
  /** The api root, or null when the user types one (`aiBaseUrl`). */
  baseUrl: string | null
  /** The model a fresh pick starts on. Anthropic's comes from `anthropicModel` instead. */
  defaultModel: string
  models: string[]
  /** What a key from this service looks like, as the field's placeholder. */
  keyHint: string
}

export const providers: readonly Provider[] = [
  { id: 'anthropic', label: 'anthropic', wire: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultModel: '', models: [], keyHint: 'sk-ant-' },
  { id: 'openai', label: 'openai', wire: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini', 'gpt-5'], keyHint: 'sk-' },
  { id: 'openrouter', label: 'openrouter', wire: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini', models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'], keyHint: 'sk-or-' },
  { id: 'custom', label: 'other (openai-compatible)', wire: 'openai', baseUrl: null, defaultModel: '', models: [], keyHint: 'api key' },
]

/** The provider a settings value names; anthropic when unset or unknown. */
export function providerOf(id: string | undefined): Provider {
  return providers.find((provider) => provider.id === id) ?? providers[0]
}

/** `url` without trailing slashes, so a path can be joined onto it. */
export function trimBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

type ProviderSettings = Pick<AppSettings, 'aiProvider' | 'aiBaseUrl' | 'aiModel' | 'anthropicModel'>

/** The api root for these settings. Empty when a custom provider has no url yet, which nothing should be sent to. */
export function baseUrlFor(settings: Pick<AppSettings, 'aiProvider' | 'aiBaseUrl'>): string {
  return providerOf(settings.aiProvider).baseUrl ?? trimBaseUrl(settings.aiBaseUrl)
}

/** Whether this space's chat speaks to anthropic: the work chat always (Claude Code), the personal one by its provider. */
export function usesAnthropic(domain: Domain, settings: Pick<AppSettings, 'aiProvider'>): boolean {
  return domain === 'work' || providerOf(settings.aiProvider).wire === 'anthropic'
}

/** The model this space's chat asks for. */
export function activeModel(domain: Domain, settings: ProviderSettings): string {
  if (usesAnthropic(domain, settings)) return chatModel(domain, settings.anthropicModel)
  return settings.aiModel.trim() || providerOf(settings.aiProvider).defaultModel
}

/** What the model picker lists. */
export function modelChoices(domain: Domain, settings: ProviderSettings): readonly string[] {
  if (usesAnthropic(domain, settings)) return chatModelOptions(domain)
  const current = activeModel(domain, settings)
  const listed = providerOf(settings.aiProvider).models
  return current && !listed.includes(current) ? [current, ...listed] : listed
}

/** The settings field the model picker writes. */
export function modelField(domain: Domain, settings: Pick<AppSettings, 'aiProvider'>): 'anthropicModel' | 'aiModel' {
  return usesAnthropic(domain, settings) ? 'anthropicModel' : 'aiModel'
}
