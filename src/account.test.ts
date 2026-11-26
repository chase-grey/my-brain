import { describe, expect, it } from 'vitest'
import { accountStorageKey, applyDeviceSetup, deviceSetupFrom, loadAccount, newAccount, setupFromHash, setupLink, showsWork, takesSetupLink } from './account'
import { defaultSettings } from './settings'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get length() { return data.size },
    key: (index: number) => [...data.keys()][index] ?? null,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
}

describe('device account', () => {
  it('starts a fresh device on the welcome flow', () => {
    const storage = fakeStorage({ 'msal.token': 'x' })
    expect(loadAccount(storage)).toEqual(newAccount)
    expect(storage.data.has(accountStorageKey)).toBe(false)
  })

  it('treats a device that already held my-brain data as the owner', () => {
    const storage = fakeStorage({ 'my-brain.personal.settings.v1': '{}' })
    const account = loadAccount(storage)
    expect(account).toMatchObject({ setupComplete: true, owner: true, workSpace: true })
    expect(account.updatedAt).toBeUndefined()
    expect(JSON.parse(storage.data.get(accountStorageKey)!)).toMatchObject({ owner: true })
  })

  it('reads a saved account back', () => {
    const saved = { setupComplete: true, owner: false, name: 'Sam', workSpace: false, updatedAt: '2026-11-15T10:00:00Z' }
    expect(loadAccount(fakeStorage({ [accountStorageKey]: JSON.stringify(saved) }))).toEqual(saved)
  })

  it('shows the work space to the owner and to anyone who turned it on', () => {
    expect(showsWork({ ...newAccount, owner: true })).toBe(true)
    expect(showsWork({ ...newAccount, workSpace: true })).toBe(true)
    expect(showsWork(newAccount)).toBe(false)
  })
})

describe('setup link', () => {
  const account = { setupComplete: true, owner: true, name: 'Chase', workSpace: true }
  const settings = { ...defaultSettings, anthropicApiKey: 'sk-ant-1', githubRepo: 'me/vault', githubToken: 'ghp_1', homeWifi: 'home' }

  it('carries the account and its keys in the fragment and reads them back', () => {
    const link = setupLink('https://chase-grey.github.io/my-brain/#today', deviceSetupFrom(account, settings))
    expect(link.startsWith('https://chase-grey.github.io/my-brain/#setup=')).toBe(true)
    expect(link).not.toContain('?')
    const setup = setupFromHash(new URL(link).hash)
    expect(setup).toMatchObject({ owner: true, name: 'Chase', workSpace: true, settings: { anthropicApiKey: 'sk-ant-1', githubRepo: 'me/vault', githubToken: 'ghp_1' } })
    expect(setup?.settings).not.toHaveProperty('homeWifi')
  })

  it('ignores hashes that are not a setup link', () => {
    expect(setupFromHash('#today')).toBeUndefined()
    expect(setupFromHash('#setup=not-base64-json')).toBeUndefined()
  })

  it('sets a new device up as the account the link names', () => {
    const friend = applyDeviceSetup({ owner: false, name: 'Sam', workSpace: false, settings: { anthropicApiKey: 'sk-ant-2' } }, defaultSettings)
    expect(friend.account).toEqual({ setupComplete: true, owner: false, name: 'Sam', workSpace: false })
    expect(friend.settings).toMatchObject({ anthropicApiKey: 'sk-ant-2', mailAppUrl: '' })
    expect(applyDeviceSetup({ owner: true, name: '', workSpace: true, settings: {} }, defaultSettings).settings.mailAppUrl).toBe(defaultSettings.mailAppUrl)
  })
})

it('takes a setup link only on a device that is not set up yet', () => {
  expect(takesSetupLink(newAccount)).toBe(true)
  expect(takesSetupLink({ setupComplete: true, owner: true, name: 'Chase', workSpace: true })).toBe(false)
  expect(takesSetupLink({ setupComplete: true, owner: false, name: 'Sam', workSpace: false })).toBe(false)
})
