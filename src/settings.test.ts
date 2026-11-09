import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings, loadSettings, saveSettings } from './settings'

function fakeStorage() {
  const data = new Map<string, string>()
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, data }
}

afterEach(() => vi.unstubAllGlobals())

describe('settings', () => {
  it('persists companion fields for personal only', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    const settings = { ...defaultSettings, anthropicApiKey: 'sk-ant-1', githubRepo: 'chase-grey/homebase', githubToken: 'ghp', vaultBranch: 'notes' }
    saveSettings(settings, 'personal')
    saveSettings(settings, 'work')
    expect(loadSettings('personal')).toMatchObject({ anthropicApiKey: 'sk-ant-1', githubRepo: 'chase-grey/homebase', githubToken: 'ghp', vaultBranch: 'notes' })
    expect(storage.data.get('my-brain.work.settings.v1')).not.toContain('sk-ant-1')
    expect(loadSettings('work')).toMatchObject({ anthropicApiKey: '', vaultBranch: 'main' })
  })

  it('keeps the model and effort per space, for work too', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    saveSettings({ ...defaultSettings, anthropicModel: 'claude-opus-5-5', chatEffort: 'low' }, 'work')
    expect(loadSettings('work')).toMatchObject({ anthropicModel: 'claude-opus-5-5', chatEffort: 'low' })
    expect(loadSettings('personal')).toMatchObject({ anthropicModel: 'claude-sonnet-5-5', chatEffort: 'high' })
    storage.setItem('my-brain.personal.settings.v1', JSON.stringify({ chatEffort: 'extreme' }))
    expect(loadSettings('personal').chatEffort).toBe('high')
  })

  it('falls back to defaults for corrupt companion values', () => {
    const storage = fakeStorage()
    storage.setItem('my-brain.personal.settings.v1', JSON.stringify({ anthropicApiKey: 7, anthropicModel: '', vaultBranch: null }))
    vi.stubGlobal('localStorage', storage)
    expect(loadSettings('personal')).toMatchObject({ anthropicApiKey: '', anthropicModel: 'claude-sonnet-5-5', vaultBranch: 'main' })
  })
})
