import type { Domain } from './domain/types'

export const defaultCompanionModel = 'claude-sonnet-5-5'
export const companionModelOptions = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const
export const effortOptions = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = typeof effortOptions[number]
export const defaultEffort: Effort = 'high'

/** The short name the pickers show and the alias Claude Code takes: claude-sonnet-5-5 -> sonnet. */
export function modelShortName(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d.*$/, '') || model
}

export type AppSettings = {
  workdayCapacityMin: number
  personalWeeklyCeilingMin: number
  floors: string[]
  anthropicApiKey: string
  anthropicModel: string
  chatEffort: Effort
  githubRepo: string
  githubToken: string
  vaultBranch: string
  mailAppUrl: string
}

export const defaultSettings: AppSettings = {
  workdayCapacityMin: 420,
  personalWeeklyCeilingMin: 360,
  floors: [],
  anthropicApiKey: '',
  anthropicModel: defaultCompanionModel,
  chatEffort: defaultEffort,
  githubRepo: '',
  githubToken: '',
  vaultBranch: 'main',
  mailAppUrl: 'https://chase-grey.github.io/my-mail/',
}

const settingsStorageKey = (domain: Domain) => `my-brain.${domain}.settings.v1`
const companionFields = ['anthropicApiKey', 'githubRepo', 'githubToken', 'vaultBranch', 'mailAppUrl'] as const
// Model and effort are per space: the work chat picks them for Claude Code, the personal one for the api.
const chatFields = ['anthropicModel', 'chatEffort'] as const

function effort(value: unknown): Effort {
  return effortOptions.includes(value as Effort) ? value as Effort : defaultEffort
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function minutes(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

export function loadSettings(domain: Domain): AppSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(settingsStorageKey(domain)) ?? '{}') as Partial<Record<keyof AppSettings, unknown>>
    const companion = Object.fromEntries(companionFields.map((field) => [field, text(stored[field], defaultSettings[field])])) as Pick<AppSettings, typeof companionFields[number]>
    return {
      workdayCapacityMin: minutes(stored.workdayCapacityMin, defaultSettings.workdayCapacityMin),
      personalWeeklyCeilingMin: minutes(stored.personalWeeklyCeilingMin, defaultSettings.personalWeeklyCeilingMin),
      floors: Array.isArray(stored.floors) ? stored.floors.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
      ...companion,
      anthropicModel: text(stored.anthropicModel, '') || defaultCompanionModel,
      chatEffort: effort(stored.chatEffort),
      vaultBranch: companion.vaultBranch || 'main',
    }
  } catch {
    // Storage can be unavailable or contain old data; defaults remain usable.
  }
  return defaultSettings
}

export function saveSettings(settings: AppSettings, domain: Domain): void {
  try {
    const scoped = domain === 'work'
      ? { workdayCapacityMin: settings.workdayCapacityMin }
      : {
        personalWeeklyCeilingMin: settings.personalWeeklyCeilingMin,
        ...Object.fromEntries(companionFields.map((field) => [field, settings[field]])),
      }
    const chat = Object.fromEntries(chatFields.map((field) => [field, settings[field]]))
    localStorage.setItem(settingsStorageKey(domain), JSON.stringify({ floors: settings.floors, ...chat, ...scoped }))
  } catch {
    // Keep the in-memory setting usable if persistence is unavailable.
  }
}
