import type { Domain } from './domain/types'

export const defaultCompanionModel = 'claude-sonnet-5-5'
export const companionModelOptions = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'] as const

export type AppSettings = {
  themeColor: string
  workdayCapacityMin: number
  personalWeeklyCeilingMin: number
  floors: string[]
  anthropicApiKey: string
  anthropicModel: string
  githubRepo: string
  githubToken: string
  vaultBranch: string
}

export const defaultSettings: AppSettings = {
  themeColor: '#a855f7',
  workdayCapacityMin: 420,
  personalWeeklyCeilingMin: 360,
  floors: [],
  anthropicApiKey: '',
  anthropicModel: defaultCompanionModel,
  githubRepo: '',
  githubToken: '',
  vaultBranch: 'main',
}

export const themeColorPresets = [
  { label: 'Purple', value: '#a855f7' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Magenta', value: '#d946ef' },
  { label: 'Indigo', value: '#6366f1' },
] as const

const settingsStorageKey = (domain: Domain) => `my-brain.${domain}.settings.v1`
const hexColorPattern = /^#[0-9a-f]{6}$/i
const companionFields = ['anthropicApiKey', 'anthropicModel', 'githubRepo', 'githubToken', 'vaultBranch'] as const

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

export function loadSettings(domain: Domain): AppSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(settingsStorageKey(domain)) ?? '{}') as Partial<Record<keyof AppSettings, unknown>>
    if (typeof stored.themeColor === 'string' && hexColorPattern.test(stored.themeColor)) {
      const companion = Object.fromEntries(companionFields.map((field) => [field, text(stored[field], defaultSettings[field])])) as Pick<AppSettings, typeof companionFields[number]>
      return {
        ...defaultSettings,
        ...(stored as Partial<AppSettings>),
        themeColor: stored.themeColor,
        floors: Array.isArray(stored.floors) ? stored.floors.slice(0, 4) : [],
        ...companion,
        anthropicModel: companion.anthropicModel || defaultCompanionModel,
        vaultBranch: companion.vaultBranch || 'main',
      }
    }
  } catch {
    // Storage can be unavailable or contain old data; defaults remain usable.
  }
  return defaultSettings
}

export function applySettings(settings: AppSettings): void {
  document.documentElement.style.setProperty('--theme-accent', settings.themeColor)
}

export function saveSettings(settings: AppSettings, domain: Domain): void {
  try {
    const { themeColor, floors } = settings
    const scoped = domain === 'work'
      ? { workdayCapacityMin: settings.workdayCapacityMin }
      : {
        personalWeeklyCeilingMin: settings.personalWeeklyCeilingMin,
        ...Object.fromEntries(companionFields.map((field) => [field, settings[field]])),
      }
    localStorage.setItem(settingsStorageKey(domain), JSON.stringify({ themeColor, floors, ...scoped }))
  } catch {
    // Keep the in-memory setting usable if persistence is unavailable.
  }
}
