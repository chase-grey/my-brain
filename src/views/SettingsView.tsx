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

    <Card title="chat">
      {domain === 'personal' ? <div className="stack">
        <Field label="anthropic api key"><input type="password" autoComplete="off" value={settings.anthropicApiKey} onChange={set('anthropicApiKey')} /></Field>
        <Field label="model"><select value={settings.anthropicModel} onChange={set('anthropicModel')}>{companionModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></Field>
        <div className="grid-2">
          <Field label="github repo"><input autoComplete="off" value={settings.githubRepo} onChange={set('githubRepo')} placeholder="owner/name" /></Field>
          <Field label="branch"><input autoComplete="off" value={settings.vaultBranch} onChange={set('vaultBranch')} /></Field>
        </div>
        <Field label="github token"><input type="password" autoComplete="off" value={settings.githubToken} onChange={set('githubToken')} /></Field>
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

    {canInstall && <Card title="app"><div className="actions"><button className="primary" type="button" onClick={onInstall}>install on this device</button></div></Card>}
  </>
}
