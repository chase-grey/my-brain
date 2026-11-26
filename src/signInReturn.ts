// Coming back from microsoft. A sign-in ends on this page with its result in the address, in one of three
// ways: a popup, the hidden frame that renews a sign-in, or (in the android shell) the whole page.

const PLACE_KEY = 'signIn.place'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type Address = { hash: string; pathname: string; search: string }

/** Microsoft's answer to a sign-in, as it arrives in the address. */
export function isSignInResponse(hash: string = window.location.hash, search: string = window.location.search): boolean {
  const params = new URLSearchParams(hash.slice(1) || search)
  return params.has('state') && (params.has('code') || params.has('error'))
}

/**
 * How this page hands the answer on. A popup or a frame passes it to the window that asked, in the shell as
 * anywhere else. Only the shell's own page, which left for microsoft whole, keeps the answer for itself.
 */
export function signInArrival(response: boolean, framed: boolean, native: boolean): 'none' | 'pass' | 'keep' {
  if (!response) return 'none'
  return native && !framed ? 'keep' : 'pass'
}

/** Before the whole page leaves for microsoft: the screen to come back to. */
export function rememberPlace(store: Store = sessionStorage, hash: string = window.location.hash): void {
  store.setItem(PLACE_KEY, hash)
}

let kept: string | undefined
let cameBack = false

/**
 * Takes the answer out of the address before the app starts, and puts back the screen the sign-in was started
 * from. Left in the address, the app would open on today and write its own hash over the answer before it was read.
 */
export function takeSignInResponse(
  store: Store = sessionStorage,
  address: Address = window.location,
  replace: (url: string) => void = (url) => history.replaceState(null, '', url),
): void {
  kept = address.hash
  cameBack = true
  const place = store.getItem(PLACE_KEY) ?? ''
  store.removeItem(PLACE_KEY)
  replace(`${address.pathname}${address.search}${place}`)
}

/** The answer taken on the way in, given out once so a failed sign-in is not tried again from the same answer. */
export function keptSignInResponse(): string | undefined {
  const response = kept
  kept = undefined
  return response
}

let letGo: (() => void) | undefined

/**
 * Holds the screen that was just put back until the kept answer has been read. msal empties the address as soon
 * as it has an answer, wherever the answer came from, and the app follows an emptied address to today.
 * Called before the app starts, so this hears of the emptying before the app does.
 */
export function holdPlace(page: Window = window): void {
  const place = page.location.hash
  if (!place) return
  const back = (event: Event) => {
    // Only an emptied address is undone. Anywhere else it goes is somewhere he chose to go.
    if (page.location.hash !== '') return
    event.stopImmediatePropagation()
    page.history.replaceState(null, '', `${page.location.pathname}${page.location.search}${place}`)
  }
  page.addEventListener('hashchange', back, true)
  page.addEventListener('popstate', back, true)
  const stop = () => {
    page.removeEventListener('hashchange', back, true)
    page.removeEventListener('popstate', back, true)
    letGo = undefined
  }
  letGo = stop
  // A sign-in that is never read (no microsoft app id) must not hold the address for good.
  page.setTimeout(stop, 60_000)
}

/** The kept answer has been read. The emptying is told to the page a moment after it happens, so the hold outlasts it. */
export function placeHeld(page: Window = window): void {
  const stop = letGo
  if (!stop) return
  page.setTimeout(stop, 1000)
}

/** This page is the whole app coming back from microsoft, so a sign-in that fails now has no button waiting to say so. */
export function cameBackFromSignIn(): boolean {
  return cameBack
}

/** How long a sign-in window may stay open. msal's own minute runs out while a password and a code are still being typed. */
export const signInWindowMs = 10 * 60_000
