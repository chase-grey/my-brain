import type { DeviceAccount } from './account'
import type { AppSettings } from './settings'

/**
 * Personal settings ride to settings.json in the account's OneDrive app folder, so a new device
 * only has to connect microsoft. The app folder is private to whoever signed in, so the keys go
 * too, which is the one place this differs from the workout tracker's public sheet.
 *
 * Work settings stay on the device: the work space reaches a bridge on one particular pc.
 */
export const accountFile = 'settings.json'

export const syncedFields = ['aiMode', 'aiProvider', 'aiBaseUrl', 'aiModel', 'anthropicApiKey', 'jevApiKey', 'anthropicModel', 'chatEffort', 'githubRepo', 'githubToken', 'vaultBranch', 'mailAppUrl', 'trackerToken', 'issueToken', 'homeWifi', 'workWifi', 'backOn'] as const
export type SyncedSettings = Pick<AppSettings, typeof syncedFields[number]>

export type AccountFile = {
  version: 1
  updatedAt: string
  owner: boolean
  name: string
  workSpace: boolean
  settings: Partial<SyncedSettings>
}

function pickSynced(settings: AppSettings): SyncedSettings {
  return Object.fromEntries(syncedFields.map((field) => [field, settings[field]])) as SyncedSettings
}

export function accountFileFrom(account: DeviceAccount, settings: AppSettings, updatedAt: string): AccountFile {
  return { version: 1, updatedAt, owner: account.owner, name: account.name, workSpace: account.workSpace, settings: pickSynced(settings) }
}

/** Stable JSON, keys sorted, so two copies that agree compare equal whatever order their keys arrived in. */
function canonical(value: Partial<SyncedSettings>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key as keyof SyncedSettings]]))
}

/** A value worth carrying: an empty string or list is a field nobody filled in, not a deliberate blank. */
function carries(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  return value !== undefined && value !== null
}

function filled(settings: Partial<SyncedSettings>): Partial<SyncedSettings> {
  return Object.fromEntries(Object.entries(settings).filter(([field, value]) => (syncedFields as readonly string[]).includes(field) && carries(value)))
}

export type MergedAccount = { account: DeviceAccount; settings: AppSettings; push: boolean }

/**
 * This device's account and personal settings with the account's copy folded in.
 *
 * The newer side wins field by field, but only where it carries a value, so a copy saved before
 * a key was entered never blanks it. A device that has never synced has no claim to be newer and
 * takes the account's copy. Ownership is never given up in a merge: once a device or the account
 * says owner, both stay owner.
 */
export function mergeAccountFile(local: { account: DeviceAccount; settings: AppSettings }, remote: AccountFile | undefined, now: string): MergedAccount {
  if (!remote || typeof remote !== 'object' || typeof remote.updatedAt !== 'string') {
    const updatedAt = local.account.updatedAt ?? now
    return { account: { ...local.account, updatedAt }, settings: local.settings, push: true }
  }
  const localIsNewer = local.account.updatedAt !== undefined && local.account.updatedAt > remote.updatedAt
  const localSynced = filled(pickSynced(local.settings))
  const remoteSynced = filled(remote.settings ?? {})
  const settings = { ...local.settings, ...(localIsNewer ? { ...remoteSynced, ...localSynced } : { ...localSynced, ...remoteSynced }) }
  const owner = local.account.owner || remote.owner === true
  const newer = localIsNewer ? local.account : remote
  const account: DeviceAccount = {
    setupComplete: true,
    owner,
    name: carries(newer.name) ? newer.name : (localIsNewer ? remote.name : local.account.name) ?? '',
    workSpace: newer.workSpace === true,
    updatedAt: localIsNewer ? local.account.updatedAt : remote.updatedAt,
  }
  // Push when this device brought something the account's copy lacks, so the next device gets it.
  const push = localIsNewer || owner !== (remote.owner === true) || canonical(filled(pickSynced(settings))) !== canonical(remoteSynced)
  return { account, settings, push }
}
