import { useEffect, useState } from 'react'

/**
 * Whether to offer installing the app, and which way. Chrome hands over a real install dialog
 * (`beforeinstallprompt`) that a tap can open; iOS has no such API, so the most it gets is a
 * pointer to share → add to home screen. An app already running from the home screen offers
 * nothing, and a dismissal holds for {@link dismissDays} before the offer comes back.
 */
export type InstallOffer = 'prompt' | 'ios' | null

export const dismissDays = 14
const dismissedKey = 'my-brain.install-dismissed'

export function installOffer(o: { standalone: boolean; canPrompt: boolean; ios: boolean; dismissedAt: string | null; now: Date }): InstallOffer {
  if (o.standalone) return null
  if (o.dismissedAt) {
    const since = o.now.getTime() - new Date(o.dismissedAt).getTime()
    if (Number.isFinite(since) && since < dismissDays * 86_400_000) return null
  }
  if (o.canPrompt) return 'prompt'
  if (o.ios) return 'ios'
  return null
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
    notify()
  })
}

function readDismissed(): string | null {
  try { return localStorage.getItem(dismissedKey) } catch { return null }
}

export function useInstallPrompt(): { offer: InstallOffer; canPrompt: boolean; install: () => Promise<void>; dismiss: () => void } {
  const [, rerender] = useState(0)
  const [dismissedAt, setDismissedAt] = useState(readDismissed)

  useEffect(() => {
    const listener = () => rerender((count) => count + 1)
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])

  const ios = typeof navigator !== 'undefined' && isIOS(navigator.userAgent, navigator.maxTouchPoints)
  const offer = installOffer({ standalone: isStandalone(), canPrompt: deferred !== null, ios, dismissedAt, now: new Date() })

  async function install(): Promise<void> {
    const event = deferred
    if (!event) return
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') {
      deferred = null
      notify()
    }
  }

  function dismiss(): void {
    const now = new Date().toISOString()
    setDismissedAt(now)
    try { localStorage.setItem(dismissedKey, now) } catch { /* stays dismissed for this visit */ }
  }

  return { offer, canPrompt: deferred !== null, install, dismiss }
}
