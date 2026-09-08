import type { Domain } from './domain/types'

export type AppSettings = {
  themeColor: string
  workdayCapacityMin: number
  personalWeeklyCeilingMin: number
  floors: string[]
}

export const defaultSettings: AppSettings = {
  themeColor: '#a855f7',
  workdayCapacityMin: 420,
  personalWeeklyCeilingMin: 360,
  floors: [],
}

export const themeColorPresets = [
  { label: 'Purple', value: '#a855f7' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Magenta', value: '#d946ef' },
  { label: 'Indigo', value: '#6366f1' },
] as const

const settingsStorageKey = (domain: Domain) => `my-brain.${domain}.settings.v1`
const hexColorPattern = /^#[0-9a-f]{6}$/i

export function loadSettings(domain: Domain): AppSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(settingsStorageKey(domain)) ?? '{}') as Partial<AppSettings>
    if (stored.themeColor && hexColorPattern.test(stored.themeColor)) {
      return {
        ...defaultSettings,
        ...stored,
        themeColor: stored.themeColor,
        floors: Array.isArray(stored.floors) ? stored.floors.slice(0, 4) : [],
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
    const capacity = domain === 'work' ? { workdayCapacityMin: settings.workdayCapacityMin } : { personalWeeklyCeilingMin: settings.personalWeeklyCeilingMin }
    localStorage.setItem(settingsStorageKey(domain), JSON.stringify({ themeColor, floors, ...capacity }))
  } catch {
    // Keep the in-memory setting usable if persistence is unavailable.
  }
}
