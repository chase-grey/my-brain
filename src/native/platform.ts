import { Capacitor } from '@capacitor/core'

/** True inside the android shell, false in a browser or the installed web app. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

/**
 * The shell opens `mybrain://chat/talk`-style links from the widget. They map onto the app's hash routes, so
 * `mybrain://chat/talk` becomes `#chat/talk` and `mybrain://task/abc` becomes `#task/abc`.
 */
export function hashForAppUrl(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'mybrain:') return undefined
  const route = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, '')
  return route ? `#${route}` : undefined
}

/** Follows widget and shortcut links into the app, on a cold start and while it is already open. */
export async function followAppLinks(): Promise<void> {
  if (!isNativeApp()) return
  const { App } = await import('@capacitor/app')
  const follow = (url: string | undefined) => {
    const hash = url ? hashForAppUrl(url) : undefined
    if (hash && location.hash !== hash) location.hash = hash
  }
  const launch = await App.getLaunchUrl()
  follow(launch?.url)
  await App.addListener('appUrlOpen', (event) => follow(event.url))
}
