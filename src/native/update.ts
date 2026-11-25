import { registerPlugin } from '@capacitor/core'
import type { UpdateSource } from '../appUpdate'

// How the installed android app moves onto a new build without a reinstall (android/…/UpdatePlugin.java).
// The github build publishes the web part beside the apk, and the shell downloads it and serves it in place of
// its own copy. Only a change to the native part needs the apk, and that one is installed from the button.

/**
 * What the release holds: the commit of its web part, the fingerprint of its native part, and the number of the
 * github build that made it. The shell hands this over only when it was signed with the app's own key.
 */
export type Published = { web: string; native: string; build?: number }
/** What this phone has: the commit running, the native part installed, a download that would not start, and the newest build it has taken. */
export type Installed = { web: string; native: string; bad: string; build: number }

type UpdatePlugin = {
  info(): Promise<{ native: string; bad: string; build: number }>
  check(): Promise<Published>
  fetchWeb(options: { name: string }): Promise<void>
  apply(): Promise<void>
  installApk(): Promise<void>
  confirm(): Promise<void>
}

const Update = registerPlugin<UpdatePlugin>('Update')

/**
 * What a published build asks of this phone. A different native part needs the apk, and its web part is not
 * taken on its own because it may call native code this apk does not have. A build that was downloaded and would
 * not start is not downloaded again, and neither is one older than what the phone already has.
 */
export function nextStep(published: Published, installed: Installed): 'none' | 'web' | 'apk' {
  if (!published.web || !published.native) return 'none'
  if (published.native !== installed.native) return 'apk'
  if (published.web === installed.web || published.web === installed.bad) return 'none'
  if (typeof published.build !== 'number' || published.build < installed.build) return 'none'
  return 'web'
}

/** The android shell's builds, for `watchForUpdates`. */
export function shellUpdates(running: string): UpdateSource {
  let step: 'none' | 'web' | 'apk' = 'none'
  // The app came up on whatever build the shell is serving, so the shell can trust it.
  void Update.confirm().catch(() => {})
  return {
    running,
    async look() {
      const [published, here] = await Promise.all([Update.check(), Update.info()])
      step = nextStep(published, { web: running, ...here })
      if (step === 'none') return undefined
      if (step === 'apk') return { name: `apk ${published.native}`, byHand: true }
      await Update.fetchWeb({ name: published.web })
      return { name: published.web }
    },
    move: () => (step === 'apk' ? Update.installApk() : Update.apply()),
  }
}
