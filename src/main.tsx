import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { followAppLinks, isNativeApp } from './native/platform'
import { watchForUpdates } from './appUpdate'
import { applyAccent, loadAccent } from './accent'

/** Microsoft sends the sign-in popup, and the hidden frame that renews a sign-in, back to this page with the result in the url. */
function isSignInResponse(): boolean {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search)
  return params.has('state') && (params.has('code') || params.has('error'))
}

// The android shell signs in by redirecting the whole page, and the app picks that result up itself when it starts.
if (isSignInResponse() && !isNativeApp()) {
  // msal 5 no longer reads the popup or frame from the opener: this page has to hand the result back itself. Without it a renewal waits until it times out.
  void import('@azure/msal-browser/redirect-bridge').then((bridge) => bridge.broadcastResponseToMainFrame())
} else {
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

  // The android shell carries its own copy of the app, so there is no published page to compare with.
  if (import.meta.env.PROD && !isNativeApp()) watchForUpdates()

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
