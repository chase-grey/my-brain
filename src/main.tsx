import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { followAppLinks, isNativeApp } from './native/platform'
import { followReminderTaps } from './native/reminders'
import { APP_COMMIT, watchForUpdates } from './appUpdate'
import { shellUpdates } from './native/update'
import { applyAccent, loadAccent } from './accent'
import { isSignInResponse, signInArrival, takeSignInResponse } from './signInReturn'

// Microsoft sends the sign-in popup, and the hidden frame that renews a sign-in, back to this page with the result in the url.
const arrival = signInArrival(isSignInResponse(), window.parent !== window || Boolean(window.opener), isNativeApp())
if (arrival === 'pass') {
  // msal 5 no longer reads the popup or frame from the opener: this page has to hand the result back itself. Without it a renewal waits until it times out.
  void import('@azure/msal-browser/redirect-bridge').then((bridge) => bridge.broadcastResponseToMainFrame())
} else {
  // The android shell signs in by sending the whole page to microsoft, and the app finishes that sign-in itself as it starts.
  if (arrival === 'keep') takeSignInResponse()
  startApp()
}

function startApp(): void {
  // Before the first paint, so the app never opens in a color that is about to change.
  applyAccent(loadAccent())

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  void followAppLinks()
  void followReminderTaps()

  // The android shell carries its own copy of the app, so it looks at the release its builds are published to instead of a page.
  if (import.meta.env.PROD) watchForUpdates(isNativeApp() ? shellUpdates(APP_COMMIT) : undefined)

  // The android shell serves the app itself and intercepts fetches, so a service worker would only get in the way.
  if ('serviceWorker' in navigator && import.meta.env.PROD && !isNativeApp()) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      }).catch(() => {
        // Offline support is progressive enhancement.
      })
    })
  }
}
