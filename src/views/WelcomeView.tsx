import { useEffect, useRef, useState } from 'react'
import { newPersonSettings, type DeviceAccount } from '../account'
import { providerOf, providers, trimBaseUrl, type ProviderId } from '../companion/aiProvider'
import { configuredPersonalClientId, createPersonalGraphData, type PersonalGraphData } from '../data/personalGraphData'
import { openInChrome, useInstallPrompt } from '../installPrompt'
import { defaultSettings, loadSettings, type AiMode, type AppSettings } from '../settings'
import { accountFile, accountFileFrom, mergeAccountFile, type AccountFile } from '../settingsSync'
import { appOffers, saveGuide, uses, type Use } from '../tour'
import { Chips, Field, Segmented } from '../ui'
import { cameBackFromSignIn } from '../signInReturn'
import { SignInLog } from './SignInLog'

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

/** The ai step's answers. Nothing is picked for the person: `want` and `path` start unanswered. */
export type AiAnswers = { want?: boolean; path?: 'key' | 'paste'; provider: ProviderId; baseUrl: string; model: string; key: string; jevKey: string }

export const noAiAnswers: AiAnswers = { provider: 'anthropic', baseUrl: '', model: '', key: '', jevKey: '' }

/** Whether the ai step has been answered through: declined, copy and paste, or a key with everything its provider needs. */
export function aiAnswered(answers: AiAnswers): boolean {
  if (answers.want === false) return true
  if (!answers.want) return false
  if (answers.path === 'paste') return true
  // The provider with no address of its own has no model to start on either, so both are typed.
  const typed = providerOf(answers.provider).baseUrl !== null || (trimBaseUrl(answers.baseUrl).length > 0 && answers.model.trim().length > 0)
  return answers.path === 'key' && answers.key.trim().length > 0 && typed
}

/** The settings the ai step's answers come to. Only what the chosen path uses is kept. */
export function aiSettings(answers: AiAnswers): Pick<AppSettings, 'aiMode' | 'aiProvider' | 'aiBaseUrl' | 'aiModel' | 'anthropicApiKey' | 'jevApiKey'> {
  const aiMode: AiMode = !answers.want ? 'off' : answers.path === 'paste' ? 'paste' : 'key'
  const keyed = aiMode === 'key'
  const provider = providerOf(keyed ? answers.provider : undefined)
  return {
    aiMode,
    aiProvider: provider.id,
    aiBaseUrl: keyed && provider.baseUrl === null ? trimBaseUrl(answers.baseUrl) : '',
    aiModel: keyed && provider.baseUrl === null ? answers.model.trim() : '',
    anthropicApiKey: keyed ? answers.key.trim() : '',
    jevApiKey: keyed && provider.wire === 'anthropic' ? answers.jevKey.trim() : '',
  }
}

type Step = 'start' | 'name' | 'uses' | 'apps' | 'chat'

/** The questions in order. The apps are offered only to someone who picked what one of them does. */
export function welcomeQuestions(picked: readonly Use[]): Exclude<Step, 'start'>[] {
  return ['name', 'uses', ...(appOffers(picked).length ? ['apps' as const] : []), 'chat']
}

/** What a new person starts with: the ai answers, and the mail app's address only for someone who picked email. */
export function welcomeSettings(base: AppSettings, ai: AiAnswers, picked: readonly Use[]): AppSettings {
  return { ...newPersonSettings({ ...base, ...aiSettings(ai) }), ...(picked.includes('email') ? { mailAppUrl: defaultSettings.mailAppUrl } : {}) }
}

/** How long the install steps stand alone before staying in the browser is offered. */
export const browserDelayMs = 4000

/**
 * The first screen on an iPhone still in a Safari tab. Installing is the way on, so staying in
 * the browser is held back for {@link browserDelayMs} and then offered quietly, marked not recommended.
 * `shown` is for rendering a state directly; on screen the timer decides.
 */
export function InstallSteps({ onContinue, shown }: { onContinue: () => void; shown?: boolean }) {
  const [late, setLate] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), browserDelayMs)
    return () => clearTimeout(timer)
  }, [])
  return <main className="welcome">
    <h1>steps to install</h1>
    <ol className="welcome-steps">
      <li>tap share</li>
      <li>add to home screen</li>
      <li>open my brain from the home screen</li>
    </ol>
    {(shown ?? late) && <div className="welcome-later">
      <button className="link-button" type="button" onClick={onContinue}>continue in the browser</button>
      <small>not recommended</small>
    </div>}
  </main>
}

const headings: Record<Exclude<Step, 'start'>, string> = { name: 'about you', uses: 'what for?', apps: 'get the apps', chat: 'use ai?' }

/**
 * The first screens on a device that has never been set up.
 *
 * Connect microsoft comes first, because it answers the question the workout tracker has to ask:
 * an account whose app folder already holds settings.json is one of your own devices, and goes
 * straight in with nothing typed; one that holds none is a new person, who is asked a name and how
 * they want ai, and saves them there. Skipping keeps everything on this device and asks the same
 * two things.
 *
 * The ai step asks the workout tracker's questions in its order: whether to use ai at all, then a
 * key of your own or copy and paste into another ai app, then the provider (anthropic unless
 * changed), its key, and a jev key.
 *
 * Between the two a new person picks what the app is for (src/tour.ts). The picks choose the steps
 * of the tour that follows, and picking email or workouts offers my mail or workout tracker.
 */
export function WelcomeView({ onDone }: { onDone: (account: DeviceAccount, settings: AppSettings, finish?: WelcomeFinish) => void }) {
  const clientId = configuredPersonalClientId()
  const [step, setStep] = useState<Step>(clientId ? 'start' : 'name')
  const [name, setName] = useState('')
  const [ai, setAi] = useState<AiAnswers>(noAiAnswers)
  const [picked, setPicked] = useState<Use[]>([])
  const answerAi = (change: Partial<AiAnswers>) => setAi((current) => ({ ...current, ...change }))
  const [installFirst, setInstallFirst] = useState(inIosBrowserTab)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const data = useRef<PersonalGraphData | undefined>(undefined)
  const checking = useRef(false)
  // Android: chrome's install dialog, or the way over to chrome, offered before anything is typed. iOS gets the install steps above.
  const install = useInstallPrompt()
  const [installSkipped, setInstallSkipped] = useState(false)
  // One thing to do at a time: the install while there is one to do, and connecting only after it.
  const installStep = !installSkipped && (install.installed || install.offer === 'prompt' || install.offer === 'chrome')

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
    }).catch((caught: unknown) => {
      // Signing in from the button reports its own error. Coming back from microsoft there is no button waiting.
      if (cameBackFromSignIn()) fail(caught, 'sign in failed')
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
    const settings = welcomeSettings(base, ai, picked)
    const now = new Date().toISOString()
    const account: DeviceAccount = { setupComplete: true, owner: false, name: name.trim(), workSpace: false, ...(data.current ? { updatedAt: now } : {}) }
    const ending: WelcomeFinish = settings.aiMode === 'key' ? { kickoff: kickoffText } : {}
    // A new person is shown around. One of your own devices never gets here: it took its settings above.
    const showAround = () => saveGuide({ uses: picked, seen: [], done: false })
    if (!data.current) {
      showAround()
      onDone(account, settings, ending)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      await data.current.sidecar.writeJson(accountFile, accountFileFrom(account, settings, now))
      showAround()
      onDone(account, settings, ending)
    } catch (caught) {
      fail(caught, 'could not reach onedrive')
    }
  }

  if (installFirst) return <InstallSteps onContinue={() => setInstallFirst(false)} />

  if (step === 'start') {
    return <main className="welcome">
      <h1>my brain</h1>
      <div className="welcome-fill" />
      {error && <p className="note is-error" role="alert">{error}</p>}
      {error && <SignInLog />}
      {installStep && install.installed && <p className="note is-good" role="status">✓ installed! search for My Brain from your apps to open</p>}
      {installStep
        ? <div className="actions welcome-actions">
          {!install.installed && (install.offer === 'prompt'
            ? <button className="primary" type="button" onClick={() => void install.install()}>install app</button>
            : <button className="primary" type="button" onClick={openInChrome}>open in chrome</button>)}
          <button className="plain" type="button" onClick={() => setInstallSkipped(true)}>skip</button>
        </div>
        : <div className="actions welcome-actions">
          <button className="primary" disabled={busy} type="button" onClick={() => void connect()}>{busy ? 'connecting' : 'connect microsoft'}</button>
          <button className="plain" disabled={busy} type="button" onClick={() => setStep('name')}>skip</button>
        </div>}
    </main>
  }

  const questions = welcomeQuestions(picked)
  const offers = appOffers(picked)
  const index = questions.indexOf(step)
  const last = step === 'chat'
  // Signed in, there is nothing to go back to: the account is already chosen.
  const canGoBack = index > 0 || (Boolean(clientId) && !data.current)
  const ready = step === 'name' ? name.trim().length > 0 : step === 'chat' ? aiAnswered(ai) : true
  const provider = providerOf(ai.provider)
  const next = () => {
    if (!ready || busy) return
    if (last) void finish()
    else setStep(questions[index + 1])
  }
  const nextLabel = last ? (busy ? 'starting' : 'start') : 'next'

  return <main className="welcome">
    <div className="welcome-top">
      {canGoBack ? <button className="plain" type="button" disabled={busy} onClick={() => setStep(index > 0 ? questions[index - 1] : 'start')}>back</button> : <span />}
      <div className="welcome-dots" role="img" aria-label={`step ${index + 1} of ${questions.length}`}>
        {questions.map((item) => <span key={item} className={item === step ? 'is-current' : ''} />)}
      </div>
    </div>
    <h1>{headings[step]}</h1>
    <form className="stack welcome-fill" onSubmit={(event) => { event.preventDefault(); next() }}>
      {step === 'name' && <Field label="name"><input autoComplete="given-name" autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field>}
      {step === 'uses' && <Chips<Use> label="what for" options={uses.map((use) => ({ value: use, label: use }))} values={picked} onToggle={(use) => setPicked((current) => current.includes(use) ? current.filter((item) => item !== use) : uses.filter((item) => item === use || current.includes(item)))} />}
      {step === 'apps' && <div className="welcome-apps">
        {offers.map((offer) => <a key={offer.id} className="primary" href={offer.url} target="_blank" rel="noreferrer">get {offer.name}</a>)}
      </div>}
      {step === 'chat' && <>
        <Segmented label="use ai" value={ai.want === undefined ? '' : ai.want ? 'yes' : 'no'} onChange={(value) => answerAi({ want: value === 'yes' })} options={[{ value: 'yes', label: 'yes' }, { value: 'no', label: 'not now' }]} />
        {ai.want && <div className="field"><span>how?</span><Segmented label="how" value={ai.path ?? ''} onChange={(value) => answerAi({ path: value as AiAnswers['path'] })} options={[{ value: 'key', label: 'my api key' }, { value: 'paste', label: 'copy & paste' }]} /></div>}
        {ai.want && ai.path === 'key' && <>
          <Field label="ai provider"><select value={provider.id} onChange={(event) => answerAi({ provider: providerOf(event.target.value).id })}>{providers.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
          {provider.baseUrl === null && <Field label="base url"><input autoComplete="off" autoCapitalize="off" inputMode="url" spellCheck={false} value={ai.baseUrl} onChange={(event) => answerAi({ baseUrl: event.target.value })} placeholder="https://" /></Field>}
          {provider.baseUrl === null && <Field label="model"><input autoComplete="off" autoCapitalize="off" spellCheck={false} value={ai.model} onChange={(event) => answerAi({ model: event.target.value })} /></Field>}
          <Field label="api key"><input type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={ai.key} onChange={(event) => answerAi({ key: event.target.value })} placeholder={provider.keyHint} /></Field>
          {provider.wire === 'anthropic' && <Field label="jev api key (optional)"><input type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} value={ai.jevKey} onChange={(event) => answerAi({ jevKey: event.target.value })} /></Field>}
        </>}
      </>}
    </form>
    {error && <p className="note is-error" role="alert">{error}</p>}
    <div className="actions welcome-actions">
      <button className={step === 'apps' ? 'plain' : 'primary'} type="button" disabled={!ready || busy} onClick={next}>{nextLabel}</button>
    </div>
  </main>
}
