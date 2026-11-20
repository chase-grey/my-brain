import { useEffect, useRef, useState } from 'react'
import { newPersonSettings, type DeviceAccount } from '../account'
import { configuredPersonalClientId, createPersonalGraphData, type PersonalGraphData } from '../data/personalGraphData'
import { openInChrome, useInstallPrompt } from '../installPrompt'
import { loadSettings, type AppSettings } from '../settings'
import { accountFile, accountFileFrom, mergeAccountFile, type AccountFile } from '../settingsSync'
import { Field } from '../ui'

/** How setup ended: a new account opens on chat with a request typed, when it has a key to answer it. */
export type WelcomeFinish = { kickoff?: string }

export const kickoffText = 'plan my week'

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

/** The first word of the name on the microsoft account, to start the name field with. */
export function firstName(accountName: string | undefined): string {
  return accountName?.trim().split(/\s+/)[0] ?? ''
}

type Step = 'start' | 'name' | 'chat'
const questions: Step[] = ['name', 'chat']

/**
 * The first screens on a device that has never been set up.
 *
 * Connect microsoft comes first, because it answers the question the workout tracker has to ask:
 * an account whose app folder already holds settings.json is one of your own devices, and goes
 * straight in with nothing typed; one that holds none is a new person, who is asked a name and a
 * key and saves them there. Skipping keeps everything on this device and asks the same two things.
 */
export function WelcomeView({ onDone }: { onDone: (account: DeviceAccount, settings: AppSettings, finish?: WelcomeFinish) => void }) {
  const clientId = configuredPersonalClientId()
  const [step, setStep] = useState<Step>(clientId ? 'start' : 'name')
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [installFirst, setInstallFirst] = useState(inIosBrowserTab)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const data = useRef<PersonalGraphData | undefined>(undefined)
  const checking = useRef(false)
  // Android: chrome's install dialog, or the way over to chrome, offered before anything is typed. iOS gets "install first" above.
  const install = useInstallPrompt()
  const installButton = install.installed
    ? <p className="note">installed. open my brain from your apps</p>
    : install.offer === 'prompt'
    ? <button className="primary" type="button" onClick={() => void install.install()}>install app</button>
    : install.offer === 'chrome' && <button className="primary" type="button" onClick={openInChrome}>open in chrome</button>

  function fail(caught: unknown, fallback: string): void {
    setError(caught instanceof Error ? caught.message.toLowerCase() : fallback)
    setBusy(false)
  }

  /** Signed in: take the account's settings if it has any, or go on to ask a new person's. */
  async function afterSignIn(signedIn: PersonalGraphData): Promise<void> {
    if (checking.current) return
    checking.current = true
    try {
      const remote = await signedIn.sidecar.readJson<AccountFile>(accountFile)
      if (remote) {
        const blank: DeviceAccount = { setupComplete: true, owner: false, name: '', workSpace: false }
        const merged = mergeAccountFile({ account: blank, settings: loadSettings('personal') }, remote, new Date().toISOString())
        onDone(merged.account, merged.settings)
        return
      }
      data.current = signedIn
      setName((current) => current || firstName(signedIn.auth.account()?.name))
      setBusy(false)
      setStep('name')
    } catch (caught) {
      checking.current = false
      fail(caught, 'could not reach onedrive')
    }
  }

  // Back from the android shell's redirect sign-in, or signed in on an earlier visit: carry on.
  useEffect(() => {
    if (!clientId) return
    void createPersonalGraphData(clientId).then((signedIn) => {
      if (!signedIn.auth.account()) return
      setBusy(true)
      void afterSignIn(signedIn)
    }).catch(() => {
      // Signing in from the button reports its own error.
    })
  }, [])

  async function connect(): Promise<void> {
    if (!clientId || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const signedIn = await createPersonalGraphData(clientId)
      await signedIn.auth.signIn()
      await afterSignIn(signedIn)
    } catch (caught) {
      fail(caught, 'sign in failed')
    }
  }

  async function finish(): Promise<void> {
    if (busy) return
    const base = loadSettings('personal')
    const settings = newPersonSettings({ ...base, anthropicApiKey: key.trim() || base.anthropicApiKey })
    const now = new Date().toISOString()
    const account: DeviceAccount = { setupComplete: true, owner: false, name: name.trim(), workSpace: false, ...(data.current ? { updatedAt: now } : {}) }
    const ending: WelcomeFinish = settings.anthropicApiKey.trim() ? { kickoff: kickoffText } : {}
    if (!data.current) {
      onDone(account, settings, ending)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await data.current.sidecar.writeJson(accountFile, accountFileFrom(account, settings, now))
      onDone(account, settings, ending)
    } catch (caught) {
      fail(caught, 'could not reach onedrive')
    }
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

  if (step === 'start') {
    return <main className="welcome">
      <h1>my brain</h1>
      <div className="welcome-fill" />
      {error && <p className="note is-error" role="alert">{error}</p>}
      <div className="actions welcome-actions">
        {installButton}
        <button className={installButton ? 'secondary' : 'primary'} disabled={busy} type="button" onClick={() => void connect()}>{busy ? 'connecting' : 'connect microsoft'}</button>
        <button className="plain" disabled={busy} type="button" onClick={() => setStep('name')}>skip</button>
      </div>
    </main>
  }

  const index = questions.indexOf(step)
  const last = step === 'chat'
  // Signed in, there is nothing to go back to: the account is already chosen.
  const canGoBack = step === 'chat' || (Boolean(clientId) && !data.current)
  const ready = step !== 'name' || name.trim().length > 0
  const next = () => {
    if (!ready || busy) return
    if (last) void finish()
    else setStep('chat')
  }
  const nextLabel = last ? (busy ? 'starting' : key.trim() ? 'start' : 'skip') : 'next'

  return <main className="welcome">
    <div className="welcome-top">
      {canGoBack ? <button className="plain" type="button" disabled={busy} onClick={() => setStep(step === 'chat' ? 'name' : 'start')}>back</button> : <span />}
      <div className="welcome-dots" role="img" aria-label={`step ${index + 1} of ${questions.length}`}>
        {questions.map((item) => <span key={item} className={item === step ? 'is-current' : ''} />)}
      </div>
    </div>
    <h1>{step === 'name' ? 'about you' : 'chat'}</h1>
    <form className="stack welcome-fill" onSubmit={(event) => { event.preventDefault(); next() }}>
      {step === 'name' && <Field label="name"><input autoComplete="given-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field>}
      {step === 'chat' && <Field label="anthropic api key"><input type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-ant-" /></Field>}
    </form>
    {error && <p className="note is-error" role="alert">{error}</p>}
    <div className="actions welcome-actions">
      <button className="primary" type="button" disabled={!ready || busy} onClick={next}>{nextLabel}</button>
    </div>
  </main>
}
