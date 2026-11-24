// The app update pattern shared by my-brain, my-mail and the workout tracker (~/.claude/patterns/app-update.md).
// A new deploy is noticed while the app is open. It is reloaded onto without asking only at a quiet moment;
// otherwise settings wears a dot and its button restarts onto the new build.
import { useSyncExternalStore } from 'react'

// Build stamp baked in by vite `define` (vite.config.ts). Shown in settings so a device stuck on a stale copy is easy to spot.
export const APP_COMMIT = __APP_COMMIT__
export const APP_BUILD_TIME = __BUILD_TIME__

const pageUrl = import.meta.env.BASE_URL
// Apps on the same host share session storage when one opens the other, so every key carries the app's path.
const fromKey = `update:${pageUrl}:from`
const placeKey = `update:${pageUrl}:place`
const reloadedForKey = `update:${pageUrl}:reloaded-for`

/** After this long with no touch or key, an open app counts as left alone. */
export const idleMs = 5 * 60_000
/** Coming back to the app asks for the published page at most this often. */
const returnCheckMs = 60_000
/** An app left open asks this often. */
const backgroundCheckMs = 30 * 60_000

// --- is there a newer build ---------------------------------------------------

/** The build's entry script as index.html names it. Every deploy gives it a new hashed name. */
export function entryScript(html: string): string | undefined {
  return /<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/.exec(html)?.[1]
}

/** The published page names a different build than the one running. */
export function isNewBuild(html: string, running: string | undefined): boolean {
  const published = entryScript(html)
  return Boolean(published && running && published !== running)
}

type UpdateState = {
  /** A newer build is published; this page is still the old one. */
  ready: boolean
  /** A check is in flight from the settings button. */
  checking: boolean
  /** The one-line answer to show, keyed so the same text twice shows again. */
  toast: { id: number; text: string } | null
}

let state: UpdateState = { ready: false, checking: false, toast: null }
const listeners = new Set<() => void>()
function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export function useAppUpdate(): UpdateState {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => state, () => state)
}

let toastId = 0
export function showUpdateToast(text: string): void {
  set({ toast: { id: ++toastId, text } })
}
export function dismissUpdateToast(id: number): void {
  if (state.toast?.id === id) set({ toast: null })
}

/** The entry script this page was loaded with. Undefined on a dev server and in the android shell, where there is nothing to compare. */
let running: string | undefined
let published: string | undefined

/** Ask for the published page past every cache and compare its build with the one running. */
async function look(): Promise<'new' | 'current' | 'failed'> {
  try {
    const response = await fetch(pageUrl, { cache: 'no-store' })
    if (!response.ok) return 'failed'
    const name = entryScript(await response.text())
    if (!name) return 'failed'
    if (name === running) return 'current'
    published = name
    set({ ready: true })
    return 'new'
  } catch {
    return 'failed'
  }
}

// --- when a reload would not be noticed ----------------------------------------

export type Moment = {
  /** The app is not on screen. */
  hidden: boolean
  /** Something half-done is open: a sheet, a field being typed in, or a screen that asked to be left alone. */
  held: boolean
  /** A touch or key has landed since the app last came on screen. */
  touchedSinceShown: boolean
  /** How long since the last touch or key. */
  idleMs: number
}

/** A reload now would not interrupt anything: nothing half-done, and nobody is using the app. */
export function isQuietMoment(moment: Moment): boolean {
  if (moment.held) return false
  return moment.hidden || !moment.touchedSinceShown || moment.idleMs >= idleMs
}

const holds = new Set<symbol>()

/** Keep the app from reloading itself while something that a reload would lose is on screen. Returns the release. */
export function holdUpdates(): () => void {
  const hold = Symbol('hold')
  holds.add(hold)
  return () => { holds.delete(hold) }
}

/** A sheet is open or something written is on screen: true for every app, with no hold needed. */
function midEdit(): boolean {
  if (document.querySelector('dialog[open]')) return true
  // A draft counts whether or not the cursor is still in it.
  for (const area of document.querySelectorAll('textarea')) if (area.value.trim()) return true
  if (document.querySelector('[contenteditable="true"]')?.textContent?.trim()) return true
  const active = document.activeElement
  return active instanceof HTMLInputElement && active.value !== ''
}

// --- reloading, and coming back to the same place ------------------------------

let place: string | undefined

/** Say which screen is showing, so a reload comes back to it. Apps that keep the screen in the url do not need this. */
export function notePlace(current: string): void {
  place = current
}

/** The screen a reload left from. Good for the next load only. */
export function takeResumePlace(): string | null {
  try {
    const stored = sessionStorage.getItem(placeKey)
    sessionStorage.removeItem(placeKey)
    return stored
  } catch {
    return null
  }
}

/** The toast for the load after a reload the settings button asked for. Null when this load was not one of those. */
export function afterReloadToast(from: string | null, now: string): string | null {
  if (from == null) return null
  return from === now ? 'you’re on the latest version' : `updated to ${now}`
}

function reload(announce: boolean): void {
  try {
    if (announce) sessionStorage.setItem(fromKey, APP_COMMIT)
    if (published) sessionStorage.setItem(reloadedForKey, published)
    if (place) sessionStorage.setItem(placeKey, place)
  } catch {
    // Blocked storage costs only the toast and the place.
  }
  window.location.reload()
}

function announceReload(): void {
  let from: string | null = null
  try {
    from = sessionStorage.getItem(fromKey)
    sessionStorage.removeItem(fromKey)
  } catch {
    return
  }
  const text = afterReloadToast(from, APP_COMMIT)
  if (text) showUpdateToast(text)
}

/**
 * The settings button. With a newer build already found it restarts onto it. Otherwise it asks: a newer build
 * reloads onto it; nothing newer, or no answer, stays put and says so.
 */
export async function checkForUpdate(): Promise<void> {
  if (state.ready || !running) return reload(true)
  set({ checking: true })
  const outcome = await look()
  if (outcome === 'new') return reload(true)
  set({ checking: false })
  showUpdateToast(outcome === 'current' ? 'you’re on the latest version' : 'couldn’t check — are you offline?')
}

/**
 * Watch for new deploys while the app is open. Call once at startup, in a production build served over the web.
 * A check runs on open, on every return to the app and on a slow timer. A newer build is reloaded onto at the
 * first quiet moment, once per build so a stale answer cannot loop; until then `ready` drives the dot and the button.
 */
export function watchForUpdates(): void {
  announceReload()
  running = document.querySelector('script[src*="/assets/"]')?.getAttribute('src') ?? undefined
  if (!running) return

  let checked = 0
  let touched = false
  let lastTouch = Date.now()

  const reloadIfQuiet = () => {
    if (!state.ready || !published) return
    try {
      if (sessionStorage.getItem(reloadedForKey) === published) return
    } catch {
      return
    }
    const quiet = isQuietMoment({
      hidden: document.visibilityState === 'hidden',
      held: holds.size > 0 || midEdit(),
      touchedSinceShown: touched,
      idleMs: Date.now() - lastTouch,
    })
    if (quiet) reload(false)
  }

  const check = async (gapMs: number) => {
    if (!state.ready && document.visibilityState === 'visible' && Date.now() - checked >= gapMs) {
      checked = Date.now()
      await look()
    }
    reloadIfQuiet()
  }

  const onTouch = () => {
    touched = true
    lastTouch = Date.now()
  }
  for (const type of ['pointerdown', 'keydown', 'wheel', 'touchmove']) window.addEventListener(type, onTouch, { capture: true, passive: true })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') touched = false
    void check(returnCheckMs)
  })
  window.addEventListener('focus', () => void check(returnCheckMs))
  setInterval(() => void check(backgroundCheckMs), 60_000)
  void check(0)
}
