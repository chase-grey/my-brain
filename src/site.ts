// Where this copy of the app is served from. The work pc cannot reach github pages, so there the apps are
// served side by side from localhost, under the same paths (scripts/local-apps.mjs in my-brain).

const PAGES = 'https://chase-grey.github.io'

/** Where microsoft sends a sign-in back to. A localhost copy is registered only by its root, whatever the port. */
export function signInReturnUrl(origin: string = window.location.origin, base: string = import.meta.env.BASE_URL): string {
  return new URL(origin).hostname === 'localhost' ? `${origin}/` : `${origin}${base}`
}

/** A link to one of the other apps, pointed at the copy served beside this one when this is not the published site. */
export function besideThisApp(url: string, origin: string = typeof window === 'undefined' ? PAGES : window.location.origin, base: string = import.meta.env.BASE_URL): string {
  if (base === '/' || origin === PAGES || !url.startsWith(`${PAGES}/`)) return url
  return `${origin}${url.slice(PAGES.length)}`
}
