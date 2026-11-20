import { isHandheld, isIOS, isOtherAndroid, isStandalone, openInChrome, useInstallPrompt } from '../installPrompt'

/**
 * Where a setup link lands. A phone or tablet still in a browser tab is offered the home screen
 * first; anywhere else (a laptop, or the installed app itself) the link is all there is, and the
 * app opens on today.
 */
export function setupLanding(o: { handheld: boolean; standalone: boolean }): 'install' | 'today' {
  return o.handheld && !o.standalone ? 'install' : 'today'
}

export function landsOnInstall(): boolean {
  if (typeof navigator === 'undefined') return false
  return setupLanding({ handheld: isHandheld(navigator.userAgent, navigator.maxTouchPoints), standalone: isStandalone() }) === 'install'
}

/**
 * The welcome a setup link opens on a phone, after it has already set this browser up.
 *
 * On android the browser's storage is the installed app's, so installing carries the setup along.
 * An iPhone gives the installed app storage of its own that Safari can't reach, so there the way
 * in is to open the app and connect microsoft, which brings the same settings down from the
 * account's settings.json.
 */
export function SetupLanding({ name, onDone }: { name: string; onDone: () => void }) {
  const { canPrompt, install } = useInstallPrompt()
  const ios = typeof navigator !== 'undefined' && isIOS(navigator.userAgent, navigator.maxTouchPoints)

  return <main className="welcome">
    <h1>{name.trim() ? `welcome, ${name.trim()}` : 'welcome'}</h1>
    <div className="welcome-fill stack">
      {ios ? <>
        <section className="stack">
          <h2 className="welcome-sub">already installed</h2>
          <ol className="welcome-steps">
            <li>open my brain</li>
            <li>connect microsoft</li>
          </ol>
        </section>
        <section className="stack">
          <h2 className="welcome-sub">not installed</h2>
          <ol className="welcome-steps">
            <li>tap share</li>
            <li>add to home screen</li>
            <li>open my brain</li>
            <li>connect microsoft</li>
          </ol>
        </section>
      </> : canPrompt
        ? <button className="primary" type="button" onClick={() => void install().then(onDone)}>install app</button>
        : typeof navigator !== 'undefined' && isOtherAndroid(navigator.userAgent)
          ? <button className="primary" type="button" onClick={openInChrome}>open in chrome</button>
          : null}
    </div>
    <div className="actions welcome-actions">
      <button className="plain" type="button" onClick={onDone}>continue in the browser</button>
    </div>
  </main>
}
