import { defaultSettings, type AppSettings } from './settings'

/**
 * Who this device belongs to, kept apart from the per-space settings.
 *
 * `owner` marks Chase's devices: the habits, the mail app, the HomeBase layout and the work space
 * were all written around one person, and everyone else starts without them. A device that already
 * held my-brain data before accounts existed is the owner's (see {@link loadAccount}).
 *
 * `updatedAt` is when the synced part last changed here. Undefined means this device has never
 * taken part in a sync, so whatever the account's settings.json holds wins on the first one.
 */
export type DeviceAccount = {
  setupComplete: boolean
  owner: boolean
  name: string
  /** Show the work space. Always on for the owner; the bridge it needs runs on an Epic pc. */
  workSpace: boolean
  updatedAt?: string
}

export type AccountStorage = Pick<Storage, 'getItem' | 'setItem' | 'key' | 'length'>

export const accountStorageKey = 'my-brain.account.v1'

export const newAccount: DeviceAccount = { setupComplete: false, owner: false, name: '', workSpace: false }

const legacyOwner: DeviceAccount = { setupComplete: true, owner: true, name: '', workSpace: true }

function heldDataBefore(storage: AccountStorage): boolean {
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (key?.startsWith('my-brain.') && key !== accountStorageKey) return true
  }
  return false
}

export function loadAccount(storage: AccountStorage = localStorage): DeviceAccount {
  try {
    const stored = storage.getItem(accountStorageKey)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<DeviceAccount>
      return {
        setupComplete: parsed.setupComplete === true,
        owner: parsed.owner === true,
        name: typeof parsed.name === 'string' ? parsed.name : '',
        workSpace: parsed.workSpace === true,
        ...(typeof parsed.updatedAt === 'string' ? { updatedAt: parsed.updatedAt } : {}),
      }
    }
    if (heldDataBefore(storage)) {
      saveAccount(legacyOwner, storage)
      return legacyOwner
    }
  } catch {
    // Storage can be unavailable in privacy modes; the welcome flow still runs.
  }
  return newAccount
}

export function saveAccount(account: DeviceAccount, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(accountStorageKey, JSON.stringify(account))
  } catch {
    // The in-memory account stays usable.
  }
}

export function showsWork(account: DeviceAccount): boolean {
  return account.owner || account.workSpace
}

/** Settings a person starts with when the device is not the owner's: nothing pointing at Chase's own tools. */
export function newPersonSettings(base: AppSettings = defaultSettings): AppSettings {
  return { ...base, mailAppUrl: '' }
}

// ---------------------------------------------------------------------------------------------
// The link that sets up another of your devices. It carries the account and its keys in the
// fragment, which never leaves the device that opens it, so it is not in Pages' request logs.
// Whoever holds the link holds the keys.

export const setupLinkFields = ['aiMode', 'aiProvider', 'aiBaseUrl', 'aiModel', 'anthropicApiKey', 'jevApiKey', 'anthropicModel', 'chatEffort', 'githubRepo', 'githubToken', 'vaultBranch', 'mailAppUrl'] as const
export type SetupLinkSettings = Partial<Pick<AppSettings, typeof setupLinkFields[number]>>
export type DeviceSetup = { owner: boolean; name: string; workSpace: boolean; settings: SetupLinkSettings }

const setupParam = 'setup'

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}

export function deviceSetupFrom(account: DeviceAccount, settings: AppSettings): DeviceSetup {
  const carried: SetupLinkSettings = {}
  for (const field of setupLinkFields) {
    const value = settings[field]
    if (value) Object.assign(carried, { [field]: value })
  }
  return { owner: account.owner, name: account.name, workSpace: account.workSpace, settings: carried }
}

export function setupLink(appUrl: string, setup: DeviceSetup): string {
  return `${appUrl.split('#')[0]}#${setupParam}=${toBase64Url(JSON.stringify(setup))}`
}

/** The setup a link carried, from `location.hash`; undefined for any other hash. */
export function setupFromHash(hash: string): DeviceSetup | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const value = params.get(setupParam)
  if (!value) return undefined
  try {
    const parsed = JSON.parse(fromBase64Url(value)) as Partial<DeviceSetup>
    const settings: SetupLinkSettings = {}
    for (const field of setupLinkFields) {
      const item = (parsed.settings as Record<string, unknown> | undefined)?.[field]
      if (typeof item === 'string' && item) Object.assign(settings, { [field]: item })
    }
    return { owner: parsed.owner === true, name: typeof parsed.name === 'string' ? parsed.name : '', workSpace: parsed.workSpace === true, settings }
  } catch {
    return undefined
  }
}

/** What a device holds after opening a setup link: the account it names, with that account's keys over its own. */
export function applyDeviceSetup(setup: DeviceSetup, settings: AppSettings): { account: DeviceAccount; settings: AppSettings } {
  return {
    account: { setupComplete: true, owner: setup.owner, name: setup.name, workSpace: setup.workSpace },
    settings: { ...(setup.owner ? settings : newPersonSettings(settings)), ...setup.settings },
  }
}
