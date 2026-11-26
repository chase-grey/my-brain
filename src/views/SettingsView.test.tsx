import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DeviceAccount } from '../account'
import type { Domain } from '../domain/types'
import { defaultSettings, type AppSettings } from '../settings'
import { SettingsView } from './SettingsView'

const account: DeviceAccount = { setupComplete: true, owner: true, name: '', workSpace: true }
const render = (domain: Domain, settings: Partial<AppSettings> = {}, syncedAt?: number) => renderToStaticMarkup(<SettingsView domain={domain} connectionStatus={syncedAt ? 'connected' : 'disconnected'} syncedAt={syncedAt} settings={{ ...defaultSettings, ...settings }} syncing={false} canInstall={false} onInstall={() => {}} onConnect={async () => {}} onDisconnect={async () => {}} onSync={() => {}} onSettings={() => {}} account={account} onAccount={() => {}} />)

it('links each space to where its chat spend shows, beside the ai settings', () => {
  const personal = render('personal', { aiMode: 'key', aiProvider: 'anthropic' })
  const work = render('work')
  expect(personal).toContain('platform.claude.com/settings/keys')
  expect(personal).toContain('console.typesafe.ai/keys')
  expect(personal).not.toContain('claude.ai/settings/usage')
  expect(work).toContain('claude.ai/settings/usage')
  expect(work).not.toContain('platform.claude.com')
  expect(work).not.toContain('typesafe')
})

it('leaves the key links out when chat does not run on an anthropic key', () => {
  expect(render('personal', { aiMode: 'key', aiProvider: 'openai' })).not.toContain('platform.claude.com')
  expect(render('personal', { aiMode: 'off' })).not.toContain('platform.claude.com')
})

it('says when each space last synced, beside sync now, and nothing before a first sync', () => {
  const at = new Date('2026-11-24T09:05:00').getTime()
  expect(render('personal', {}, at)).toMatch(/sync now.*synced nov 24, 9:05/)
  expect(render('work', {}, at)).toMatch(/sync now.*synced nov 24, 9:05/)
  expect(render('work')).not.toContain('synced ')
})
