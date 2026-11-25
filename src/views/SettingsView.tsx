import { useState } from 'react'
import { APP_BUILD_TIME, APP_COMMIT, checkForUpdate, useAppUpdate } from '../appUpdate'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured } from '../companion/githubVault'
import { setTrackerOff, signInToTracker } from '../domain/bodyTracker'
import type { Domain } from '../domain/types'
import { exportFileName, exportVault, saveExport } from '../notes/exportNotes'
import type { DeviceAccount } from '../account'
import { providerOf, providers } from '../companion/aiProvider'
import type { AiMode, AppSettings } from '../settings'
import { Card, Field, Segmented } from '../ui'
import { AccentPicker } from './AccentPicker'
import { IssuesCard } from './IssuesCard'
import { ShareCard } from './ShareCard'
import { WifiCard } from './Whereabouts'

/** Where each account that chat bills shows its spend. The key pages break it down per key. */
export const usageLinks = {
  anthropic: 'https://platform.claude.com/settings/keys',
  typesafe: 'https://console.typesafe.ai/keys',
  claudeCode: 'https://claude.ai/settings/usage',
}

export type ConnectionStatus = 'unconfigured' | 'disconnected' | 'connected'

export function SettingsView({ domain, accountName, connectionStatus, settings, syncing, syncError, canInstall, onInstall, onConnect, onDisconnect, onSync, onSettings, account, onAccount }: {
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
  account: DeviceAccount
  onAccount: (account: DeviceAccount) => void
}) {
  const update = useAppUpdate()
  const set = <K extends keyof AppSettings>(key: K) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onSettings((current) => ({ ...current, [key]: typeof current[key] === 'number' ? Number(event.target.value) : event.target.value }))

  const provider = providerOf(settings.aiProvider)
  // A model belongs to its provider, so a new pick starts on that provider's default.
  const pickProvider = (event: React.ChangeEvent<HTMLSelectElement>) => onSettings((current) => ({ ...current, aiProvider: providerOf(event.target.value).id, aiModel: '' }))

  return <>
    <header className="view-head"><h1>settings</h1></header>

    {domain === 'personal' && <Card title="microsoft account">
      {connectionStatus === 'connected'
        ? <><p className="note">{accountName}</p><div className="actions row-actions"><button className="primary" disabled={syncing} type="button" onClick={onSync}>{syncing ? 'syncing' : 'sync now'}</button><button className="plain" disabled={syncing} type="button" onClick={() => void onDisconnect()}>disconnect</button></div></>
        : <div className="actions"><button className="primary" disabled={syncing || connectionStatus === 'unconfigured'} type="button" onClick={() => void onConnect()}>{syncing ? 'connecting' : connectionStatus === 'unconfigured' ? 'no microsoft app id' : 'connect microsoft'}</button></div>}
      {syncError && <p className="note is-error" role="alert">{syncError}</p>}
      {(account.owner || settings.mailAppUrl) && <Field label="mail app"><input autoComplete="off" inputMode="url" value={settings.mailAppUrl} onChange={set('mailAppUrl')} placeholder="https://" /></Field>}
    </Card>}

    {domain === 'personal' && <Card title="workout tracker">
      <TrackerLink settings={settings} onSettings={onSettings} />
    </Card>}

    {domain === 'work' && <Card title="outlook tasks">
      <p className="note">{connectionStatus === 'connected' ? accountName : 'work bridge not reachable'}</p>
      <div className="actions"><button className="primary" disabled={syncing} type="button" onClick={onSync}>{syncing ? 'syncing' : 'sync now'}</button></div>
      {syncError && <p className="note is-error" role="alert">{syncError}</p>}
    </Card>}

    <Card title="chat">
      {domain === 'personal' ? <div className="stack">
        <Segmented<AiMode> label="ai" value={settings.aiMode} onChange={(aiMode) => onSettings((current) => ({ ...current, aiMode }))} options={[{ value: 'key', label: 'api key' }, { value: 'paste', label: 'copy & paste' }, { value: 'off', label: 'off' }]} />
        {settings.aiMode === 'key' && <>
          <Field label="ai provider"><select value={provider.id} onChange={pickProvider}>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
          {provider.baseUrl === null && <Field label="base url"><input autoComplete="off" autoCapitalize="off" inputMode="url" spellCheck={false} value={settings.aiBaseUrl} onChange={set('aiBaseUrl')} placeholder="https://" /></Field>}
          <Field label="api key"><input type="password" autoComplete="off" value={settings.anthropicApiKey} onChange={set('anthropicApiKey')} placeholder={provider.keyHint} /></Field>
          {provider.wire === 'anthropic'
            ? <Field label="jev api key"><input type="password" autoComplete="off" value={settings.jevApiKey} onChange={set('jevApiKey')} /></Field>
            : <Field label="model"><input autoComplete="off" autoCapitalize="off" spellCheck={false} list="ai-models" value={settings.aiModel} onChange={set('aiModel')} placeholder={provider.defaultModel} /><datalist id="ai-models">{provider.models.map((model) => <option key={model} value={model} />)}</datalist></Field>}
          {provider.id === 'anthropic' && <div className="links">
            <a href={usageLinks.anthropic} target="_blank" rel="noreferrer">anthropic keys</a>
            <a href={usageLinks.typesafe} target="_blank" rel="noreferrer">typesafe keys</a>
          </div>}
        </>}
        <div className="grid-2">
          <Field label="github repo"><input autoComplete="off" value={settings.githubRepo} onChange={set('githubRepo')} placeholder="owner/name" /></Field>
          <Field label="branch"><input autoComplete="off" value={settings.vaultBranch} onChange={set('vaultBranch')} /></Field>
        </div>
        <Field label="github token"><input type="password" autoComplete="off" value={settings.githubToken} onChange={set('githubToken')} /></Field>
        <VaultCheck settings={settings} />
      </div> : <>
        <p className="note">claude code on this pc, through the work bridge</p>
        <div className="links"><a href={usageLinks.claudeCode} target="_blank" rel="noreferrer">claude code usage</a></div>
      </>}
    </Card>

    {domain === 'personal' && <WifiCard settings={settings} onSettings={onSettings} />}

    {domain === 'personal' && <Card title="notes">
      <NotesExport settings={settings} />
    </Card>}

    {domain === 'personal' && (account.owner || settings.issueToken) && <IssuesCard settings={settings} onSettings={onSettings} />}

    <Card title="capacity">
      <div className="grid-2">
        {domain === 'work'
          ? <Field label="workday minutes"><input inputMode="numeric" min="0" step="30" type="number" value={settings.workdayCapacityMin} onChange={set('workdayCapacityMin')} /></Field>
          : <Field label="weekly ceiling minutes"><input inputMode="numeric" min="0" step="30" type="number" value={settings.personalWeeklyCeilingMin} onChange={set('personalWeeklyCeilingMin')} /></Field>}
        <Field label="floors"><input value={settings.floors.join(', ')} onChange={(event) => onSettings((current) => ({ ...current, floors: event.target.value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 4) }))} placeholder={domain === 'work' ? 'email, expenses' : 'dishes, laundry'} /></Field>
      </div>
    </Card>

    {domain === 'personal' && <ShareCard account={account} settings={settings} />}

    {!account.owner && <Card title="work space">
      <Segmented label="work space" value={account.workSpace ? 'on' : 'off'} onChange={(value) => onAccount({ ...account, workSpace: value === 'on' })} options={[{ value: 'off', label: 'off' }, { value: 'on', label: 'on' }]} />
    </Card>}

    <Card title="color">
      <AccentPicker />
    </Card>

    <Card title="app">
      <p className="note">build {APP_COMMIT} · {new Date(APP_BUILD_TIME).toLocaleString()}</p>
      <div className="actions row-actions">
        <button className={update.ready ? 'primary' : 'secondary'} disabled={update.checking} type="button" onClick={() => void checkForUpdate()}>{update.checking ? 'checking…' : update.ready ? (update.byHand ? 'update ready · install' : 'update ready · restart') : 'check for updates'}</button>
        {canInstall && <button className="primary" type="button" onClick={onInstall}>install on this device</button>}
      </div>
    </Card>
  </>
}

function TrackerLink({ settings, onSettings }: { settings: AppSettings; onSettings: React.Dispatch<React.SetStateAction<AppSettings>> }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function connect(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const trackerToken = await signInToTracker(email.trim(), password)
      setTrackerOff(false)
      setPassword('')
      onSettings((current) => ({ ...current, trackerToken }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'sign in failed')
    } finally {
      setBusy(false)
    }
  }

  function disconnect() {
    setTrackerOff(true)
    onSettings((current) => ({ ...current, trackerToken: '' }))
  }

  if (settings.trackerToken) return <><p className="note">connected</p><div className="actions row-actions"><button className="plain" type="button" onClick={disconnect}>disconnect</button></div></>
  return <form className="stack" onSubmit={(event) => void connect(event)}>
    <Field label="email"><input type="email" autoComplete="username" autoCapitalize="off" spellCheck={false} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
    <Field label="password"><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
    <div className="actions"><button className="primary" disabled={busy || !email.trim() || !password} type="submit">{busy ? 'connecting' : 'connect'}</button></div>
    {error && <p className="note is-error" role="alert">{error}</p>}
  </form>
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

// Downloads the whole vault from GitHub as a zip; with standard links on, [[wikilinks]] become relative markdown links for apps that don't read them.
function NotesExport({ settings }: { settings: AppSettings }) {
  const [standardLinks, setStandardLinks] = useState(false)
  const [progress, setProgress] = useState<string>()
  const [result, setResult] = useState<{ text: string; error: boolean }>()
  const config = { repo: normalizeRepo(settings.githubRepo), token: settings.githubToken.replace(/\s+/g, ''), branch: normalizeBranch(settings.vaultBranch) }

  async function run() {
    setResult(undefined)
    setProgress('starting')
    try {
      if (!vaultConfigured(config)) throw new Error('needs a github repo as owner/name and a token')
      const blob = await exportVault(config, { standardLinks, onProgress: (done, total) => setProgress(`${done} of ${total}`) })
      await saveExport(blob, exportFileName(config.repo))
      setResult({ text: 'exported', error: false })
    } catch (error) {
      setResult({ text: error instanceof Error ? error.message : 'export failed', error: true })
    } finally {
      setProgress(undefined)
    }
  }

  return <div className="stack">
    <label className="check"><input type="checkbox" checked={standardLinks} onChange={(event) => setStandardLinks(event.target.checked)} /> convert [[links]] to markdown links</label>
    <div className="actions row-actions">
      <button className="secondary" disabled={Boolean(progress)} type="button" onClick={() => void run()}>{progress ?? 'export notes'}</button>
      {result && <p className={`note${result.error ? ' is-error' : ''}`} role="status">{result.text}</p>}
    </div>
  </div>
}
