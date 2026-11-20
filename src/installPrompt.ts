import { useEffect, useState } from 'react'

/**
 * Whether to offer installing the app, and which way. Chrome hands over a real install dialog
 * (`beforeinstallprompt`) that a tap can open; iOS has no such API, so the most it gets is a
 * pointer to share → add to home screen. An android browser that isn't chrome (firefox) has no
 * dialog either, so it gets a way over to chrome, which does. An app already running from the home screen offers
 * nothing, and a dismissal holds for {@link dismissDays} before the offer comes back.
 */
export type InstallOffer = 'prompt' | 'ios' | 'chrome' | null

export const dismissDays = 14
const dismissedKey = 'my-brain.install-dismissed'

export function installOffer(o: { standalone: boolean; canPrompt: boolean; ios: boolean; otherAndroid?: boolean; dismissedAt: string | null; now: Date }): InstallOffer {
  if (o.standalone) return null
  if (o.dismissedAt) {
    const since = o.now.getTime() - new Date(o.dismissedAt).getTime()
    if (Number.isFinite(since) && since < dismissDays * 86_400_000) return null
  }
  if (o.canPrompt) return 'prompt'
  if (o.ios) return 'ios'
  if (o.otherAndroid) return 'chrome'
  return null
}

/** An android browser not built on chrome, so one that never hands over an install dialog. */
export function isOtherAndroid(userAgent: string): boolean {
  return /Android/.test(userAgent) && !userAgent.includes('Chrome/')
}

/** A link android opens in chrome, whatever browser it is tapped in. */
export function chromeUrl(url: string): string {
  const { host, pathname, search } = new URL(url)
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;end`
}

export function openInChrome(): void {
  location.href = chromeUrl(location.href)
}

/** iPhone, iPod, or an iPad, which since iPadOS 13 says it's a Mac but has touch. */
export function isIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

/** A phone or tablet: somewhere the app belongs on the home screen. */
export function isHandheld(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod|Android|Mobi/i.test(userAgent)) return true
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches)
    || (navigator as { standalone?: boolean }).standalone === true
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Chrome fires beforeinstallprompt once, early, often before the screen that wants it has mounted,
// so it is caught here at load and handed to whichever screen asks.
let deferred: BeforeInstallPromptEvent | null = null
// Chrome installs in the background and says little; this is how a screen knows to say it is done.
let installed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installed = true
    notify()
  })
}

function readDismissed(): string | null {
  try { return localStorage.getItem(dismissedKey) } catch { return null }
}

export function useInstallPrompt(): { offer: InstallOffer; canPrompt: boolean; installed: boolean; install: () => Promise<void>; dismiss: () => void } {
  const [, rerender] = useState(0)
  const [dismissedAt, setDismissedAt] = useState(readDismissed)

  useEffect(() => {
    const listener = () => rerender((count) => count + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  const ios = typeof navigator !== 'undefined' && isIOS(navigator.userAgent, navigator.maxTouchPoints)
  const otherAndroid = typeof navigator !== 'undefined' && isOtherAndroid(navigator.userAgent)
  const offer = installOffer({ standalone: isStandalone(), canPrompt: deferred !== null, ios, otherAndroid, dismissedAt, now: new Date() })

  async function install(): Promise<void> {
    const event = deferred
    if (!event) return
    // Chrome lets an event open its dialog once; a later tap needs the next event it fires.
    deferred = null
    try {
      await event.prompt()
      await event.userChoice
    } finally {
      notify()
    }
  }

  function dismiss(): void {
    const now = new Date().toISOString()
    setDismissedAt(now)
    try { localStorage.setItem(dismissedKey, now) } catch { /* stays dismissed for this visit */ }
  }

  return { offer, canPrompt: deferred !== null, installed, install, dismiss }
}
