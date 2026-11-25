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

/** How long a sign-in window may stay open. msal's own minute runs out while a password and a code are still being typed. */
export const signInWindowMs = 10 * 60_000
