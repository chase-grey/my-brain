import type { Domain } from './domain/types'

export const defaultCompanionModel = 'claude-sonnet-5-5'
export const companionModelOptions = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const

export type AppSettings = {
  workdayCapacityMin: number
  personalWeeklyCeilingMin: number
  floors: string[]
  anthropicApiKey: string
  anthropicModel: string
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
  githubRepo: '',
  githubToken: '',
  vaultBranch: 'main',
  mailAppUrl: 'https://chase-grey.github.io/my-mail/',
}

const settingsStorageKey = (domain: Domain) => `my-brain.${domain}.settings.v1`
const companionFields = ['anthropicApiKey', 'anthropicModel', 'githubRepo', 'githubToken', 'vaultBranch', 'mailAppUrl'] as const

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
      anthropicModel: companion.anthropicModel || defaultCompanionModel,
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
    localStorage.setItem(settingsStorageKey(domain), JSON.stringify({ floors: settings.floors, ...scoped }))
  } catch {
    // Keep the in-memory setting usable if persistence is unavailable.
  }
}
