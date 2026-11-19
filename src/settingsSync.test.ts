import { describe, expect, it } from 'vitest'
import type { DeviceAccount } from './account'
import { defaultSettings } from './settings'
import { accountFileFrom, mergeAccountFile } from './settingsSync'

const now = '2026-11-15T12:00:00.000Z'
const friend: DeviceAccount = { setupComplete: true, owner: false, name: 'Sam', workSpace: false, updatedAt: '2026-11-15T09:00:00.000Z' }

describe('settings sync', () => {
  it('pushes when the account has no settings yet', () => {
    const merged = mergeAccountFile({ account: { ...friend, updatedAt: undefined }, settings: defaultSettings }, undefined, now)
    expect(merged.push).toBe(true)
    expect(merged.account.updatedAt).toBe(now)
  })

  it('gives a device that never synced everything the account holds', () => {
    const remote = accountFileFrom({ ...friend, owner: true, name: 'Chase', workSpace: true }, { ...defaultSettings, anthropicApiKey: 'sk-ant-1', githubRepo: 'me/vault' }, '2026-11-14T00:00:00.000Z')
    const merged = mergeAccountFile({ account: { setupComplete: true, owner: false, name: '', workSpace: false }, settings: { ...defaultSettings, workdayCapacityMin: 300 } }, remote, now)
    expect(merged.settings).toMatchObject({ anthropicApiKey: 'sk-ant-1', githubRepo: 'me/vault', workdayCapacityMin: 300 })
    expect(merged.account).toMatchObject({ owner: true, name: 'Chase', workSpace: true, updatedAt: '2026-11-14T00:00:00.000Z' })
    expect(merged.push).toBe(false)
  })

  it('never lets an empty field blank a filled one', () => {
    const remote = accountFileFrom(friend, { ...defaultSettings, anthropicApiKey: '' }, '2026-11-15T10:00:00.000Z')
    const merged = mergeAccountFile({ account: { ...friend, updatedAt: undefined }, settings: { ...defaultSettings, anthropicApiKey: 'sk-ant-local' } }, remote, now)
    expect(merged.settings.anthropicApiKey).toBe('sk-ant-local')
    expect(merged.push).toBe(true)
  })

  it('lets the newer side win where both carry a value', () => {
    const remote = accountFileFrom(friend, { ...defaultSettings, anthropicApiKey: 'sk-old', githubRepo: 'sam/notes' }, '2026-11-15T08:00:00.000Z')
    const merged = mergeAccountFile({ account: friend, settings: { ...defaultSettings, anthropicApiKey: 'sk-new' } }, remote, now)
    expect(merged.settings).toMatchObject({ anthropicApiKey: 'sk-new', githubRepo: 'sam/notes' })
    expect(merged.push).toBe(true)

    const older = mergeAccountFile({ account: { ...friend, updatedAt: '2026-11-15T07:00:00.000Z' }, settings: { ...defaultSettings, anthropicApiKey: 'sk-new' } }, remote, now)
    expect(older.settings.anthropicApiKey).toBe('sk-old')
  })

  it('keeps ownership once either side has it', () => {
    const remote = accountFileFrom(friend, defaultSettings, '2026-11-15T10:00:00.000Z')
    const merged = mergeAccountFile({ account: { ...friend, owner: true, updatedAt: undefined }, settings: defaultSettings }, remote, now)
    expect(merged.account.owner).toBe(true)
    expect(merged.push).toBe(true)
  })

  it('does not push when the copies already agree', () => {
    const settings = { ...defaultSettings, anthropicApiKey: 'sk-1' }
    const remote = accountFileFrom(friend, settings, friend.updatedAt!)
    expect(mergeAccountFile({ account: friend, settings }, remote, now).push).toBe(false)
  })
})
