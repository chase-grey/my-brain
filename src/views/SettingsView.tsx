import { useState } from 'react'
import { APP_BUILD_TIME, APP_COMMIT, checkForUpdate } from '../appUpdate'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured } from '../companion/githubVault'
import type { Domain } from '../domain/types'
import { companionModelOptions, type AppSettings } from '../settings'
import { Card, Field } from '../ui'

export type ConnectionStatus = 'unconfigured' | 'disconnected' | 'connected'

export function SettingsView({ domain, accountName, connectionStatus, settings, syncing, syncError, canInstall, onInstall, onConnect, onDisconnect, onSync, onSettings }: {
  domain: Domain
  accountName?: string
  connectionStatus: ConnectionStatus
  syncing: boolean
  syncError?: string
  settings: AppSettings
  canInstall: boolean
  onInstall: () => void
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onSync: () => void
  onSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}) {
  // Waiting for the new worker to take over takes a moment; an unchanged button invites a second tap.
  const [updating, setUpdating] = useState(false)
  const set = <K extends keyof AppSettings>(key: K) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onSettings((current) => ({ ...current, [key]: typeof current[key] === 'number' ? Number(event.target.value) : event.target.value }))

  return <>
    <header className="view-head"><h1>settings</h1></header>

    {domain === 'personal' && <Card title="microsoft account">
      {connectionStatus === 'connected'
        ? <><p className="note">{accountName}</p><div className="actions row-actions"><button className="primary" disabled={syncing} type="button" onClick={onSync}>{syncing ? 'syncing' : 'sync now'}</button><button className="plain" disabled={syncing} type="button" onClick={() => void onDisconnect()}>disconnect</button></div></>
        : <div className="actions"><button className="primary" disabled={syncing || connectionStatus === 'unconfigured'} type="button" onClick={() => void onConnect()}>{syncing ? 'connecting' : connectionStatus === 'unconfigured' ? 'no microsoft app id' : 'connect microsoft'}</button></div>}
      {syncError && <p className="note is-error" role="alert">{syncError}</p>}
      <Field label="mail app"><input autoComplete="off" inputMode="url" value={settings.mailAppUrl} onChange={set('mailAppUrl')} placeholder="https://" /></Field>
    </Card>}

    {domain === 'work' && <Card title="outlook tasks">
      <p className="note">{connectionStatus === 'connected' ? accountName : 'work bridge not reachable'}</p>
      <div className="actions"><button className="primary" disabled={syncing} type="button" onClick={onSync}>{syncing ? 'syncing' : 'sync now'}</button></div>
      {syncError && <p className="note is-error" role="alert">{syncError}</p>}
    </Card>}

    <Card title="chat">
      {domain === 'personal' ? <div className="stack">
        <Field label="anthropic api key"><input type="password" autoComplete="off" value={settings.anthropicApiKey} onChange={set('anthropicApiKey')} /></Field>
        <Field label="model"><select value={settings.anthropicModel} onChange={set('anthropicModel')}>{companionModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></Field>
        <div className="grid-2">
          <Field label="github repo"><input autoComplete="off" value={settings.githubRepo} onChange={set('githubRepo')} placeholder="owner/name" /></Field>
          <Field label="branch"><input autoComplete="off" value={settings.vaultBranch} onChange={set('vaultBranch')} /></Field>
        </div>
        <Field label="github token"><input type="password" autoComplete="off" value={settings.githubToken} onChange={set('githubToken')} /></Field>
        <VaultCheck settings={settings} />
      </div> : <p className="note">claude code on this pc, through the work bridge</p>}
    </Card>

    <Card title="capacity">
      <div className="grid-2">
        {domain === 'work'
          ? <Field label="workday minutes"><input inputMode="numeric" min="0" step="30" type="number" value={settings.workdayCapacityMin} onChange={set('workdayCapacityMin')} /></Field>
          : <Field label="weekly ceiling minutes"><input inputMode="numeric" min="0" step="30" type="number" value={settings.personalWeeklyCeilingMin} onChange={set('personalWeeklyCeilingMin')} /></Field>}
        <Field label="floors"><input value={settings.floors.join(', ')} onChange={(event) => onSettings((current) => ({ ...current, floors: event.target.value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 4) }))} placeholder={domain === 'work' ? 'email, expenses' : 'dishes, laundry'} /></Field>
      </div>
    </Card>

    <Card title="app">
      <p className="note">build {APP_COMMIT} · {new Date(APP_BUILD_TIME).toLocaleString()}</p>
      <div className="actions row-actions">
        <button className="secondary" disabled={updating} type="button" onClick={() => { setUpdating(true); void checkForUpdate() }}>{updating ? 'checking' : 'check for updates & reload'}</button>
        {canInstall && <button className="primary" type="button" onClick={onInstall}>install on this device</button>}
      </div>
    </Card>
  </>
}

// Lists the vault with the same client the chat uses, so a wrong repo, branch, or token shows up here instead of mid-conversation.
function VaultCheck({ settings }: { settings: AppSettings }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ text: string; error: boolean }>()
  const config = { repo: normalizeRepo(settings.githubRepo), token: settings.githubToken.replace(/\s+/g, ''), branch: normalizeBranch(settings.vaultBranch) }

  async function check() {
    setBusy(true)
    try {
      if (!vaultConfigured(config)) throw new Error('needs a github repo as owner/name and a token')
      const notes = await new GitHubVault(config).listNotes()
      setResult({ text: `${config.repo} on ${config.branch} · ${notes.length} notes`, error: false })
    } catch (error) {
      setResult({ text: error instanceof Error ? error.message : 'check failed', error: true })
    } finally {
      setBusy(false)
    }
  }

  return <div className="actions row-actions">
    <button className="secondary" disabled={busy} type="button" onClick={() => void check()}>{busy ? 'checking' : 'check vault'}</button>
    {result && <p className={`note${result.error ? ' is-error' : ''}`} role="status">{result.text}</p>}
  </div>
}
