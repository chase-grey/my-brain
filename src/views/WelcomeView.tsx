import { useEffect, useRef, useState } from 'react'
import { newPersonSettings, type DeviceAccount } from '../account'
import { configuredPersonalClientId, createPersonalGraphData, type PersonalGraphData } from '../data/personalGraphData'
import { loadSettings, type AppSettings } from '../settings'
import { accountFile, accountFileFrom, mergeAccountFile, type AccountFile } from '../settingsSync'
import { Field } from '../ui'

// What was typed survives the android shell's redirect sign-in, which leaves the page and comes back.
const draftKey = 'my-brain-welcome-draft'

function readDraft(): { name: string; key: string } {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(draftKey) ?? '{}') as { name?: unknown; key?: unknown }
    return { name: typeof parsed.name === 'string' ? parsed.name : '', key: typeof parsed.key === 'string' ? parsed.key : '' }
  } catch {
    return { name: '', key: '' }
  }
}

function writeDraft(draft: { name: string; key: string } | undefined): void {
  try {
    if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft))
    else sessionStorage.removeItem(draftKey)
  } catch {
    // Without session storage a redirect sign-in just asks for the name again.
  }
}

/**
 * Whether this is an iPhone or iPad showing the app in a Safari tab rather than from the home
 * screen. iOS gives an installed app its own storage, so a setup done in the tab is not there when
 * the icon is opened.
 */
export function inIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined') return false
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)
  const standalone = (navigator as { standalone?: boolean }).standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
  return ios && !standalone
}

/**
 * The first screen on a device that has never been set up. Connecting microsoft is making the
 * account: an account that already has settings.json is one of your own devices and takes them,
 * and one that has none is a new person starting fresh. Skipping keeps everything on this device.
 */
export function WelcomeView({ onDone }: { onDone: (account: DeviceAccount, settings: AppSettings) => void }) {
  const [draft] = useState(readDraft)
  const [name, setName] = useState(draft.name)
  const [key, setKey] = useState(draft.key)
  const [installFirst, setInstallFirst] = useState(inIosBrowserTab)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const clientId = configuredPersonalClientId()
  const finishing = useRef(false)

  function typed(): AppSettings {
    const base = loadSettings('personal')
    return { ...base, anthropicApiKey: key.trim() || base.anthropicApiKey }
  }

  async function finishWith(data: PersonalGraphData): Promise<void> {
    if (finishing.current) return
    finishing.current = true
    try {
      const now = new Date().toISOString()
      const remote = await data.sidecar.readJson<AccountFile>(accountFile)
      const fresh: DeviceAccount = { setupComplete: true, owner: false, name: name.trim(), workSpace: false }
      if (remote) {
        const merged = mergeAccountFile({ account: fresh, settings: typed() }, remote, now)
        writeDraft(undefined)
        onDone(merged.account, merged.settings)
        return
      }
      const account = { ...fresh, updatedAt: now }
      const settings = newPersonSettings(typed())
      await data.sidecar.writeJson(accountFile, accountFileFrom(account, settings, now))
      writeDraft(undefined)
      onDone(account, settings)
    } catch (caught) {
      finishing.current = false
      setError(caught instanceof Error ? caught.message.toLowerCase() : 'could not reach onedrive')
      setBusy(false)
    }
  }

  // Back from a redirect sign-in, or already signed in from an earlier visit: carry on from there.
  useEffect(() => {
    if (!clientId) return
    void createPersonalGraphData(clientId).then((data) => {
      if (data.auth.account()) {
        setBusy(true)
        void finishWith(data)
      }
    }).catch(() => {
      // Signing in from the button reports its own error.
    })
  }, [])

  async function connect(): Promise<void> {
    if (!clientId) return
    setBusy(true)
    setError(undefined)
    writeDraft({ name, key })
    try {
      const data = await createPersonalGraphData(clientId)
      await data.auth.signIn()
      await finishWith(data)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.toLowerCase() : 'sign in failed')
      setBusy(false)
    }
  }

  function skip(): void {
    writeDraft(undefined)
    onDone({ setupComplete: true, owner: false, name: name.trim(), workSpace: false }, newPersonSettings(typed()))
  }

  if (installFirst) {
    return <main className="welcome">
      <h1>install first</h1>
      <ol className="welcome-steps">
        <li>tap share</li>
        <li>add to home screen</li>
        <li>open my brain from the home screen</li>
      </ol>
      <button className="plain" type="button" onClick={() => setInstallFirst(false)}>continue in the browser</button>
    </main>
  }

  return <main className="welcome">
    <h1>my brain</h1>
    <div className="stack">
      <Field label="name"><input autoComplete="given-name" value={name} onChange={(event) => setName(event.target.value)} /></Field>
      <Field label="anthropic api key"><input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} /></Field>
    </div>
    <div className="actions welcome-actions">
      {clientId && <button className="primary" disabled={busy} type="button" onClick={() => void connect()}>{busy ? 'connecting' : 'connect microsoft'}</button>}
      <button className={clientId ? 'plain' : 'primary'} disabled={busy} type="button" onClick={skip}>{clientId ? 'skip' : 'start'}</button>
    </div>
    {error && <p className="note is-error" role="alert">{error}</p>}
  </main>
}
