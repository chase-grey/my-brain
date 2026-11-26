// What a microsoft sign-in did on this device, step by step. The phone app cannot be inspected from a computer,
// so a sign-in that fails there leaves this to be read afterwards (settings, `sign-in log`).
// It holds steps, error codes and the names of what came back. Never a token, a code, an address's answer or an email.

const KEY = 'signIn.log'
const MAX_LINES = 150

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Anything long enough to be a token or a code is cut out, whatever a caller passed in. */
export function scrub(text: string): string {
  return text.replace(/[A-Za-z0-9._~+/=-]{40,}/g, '…').replace(/[^\s@]+@[^\s@]+/g, '…')
}

function words(detail: unknown): string {
  if (detail == null) return ''
  if (typeof detail === 'string') return detail
  if (typeof detail !== 'object') return String(detail)
  return Object.entries(detail).filter(([, value]) => value !== undefined).map(([key, value]) => `${key}=${String(value)}`).join(' ')
}

/** Adds a line. Storage that is full or blocked costs only the line. */
export function noteSignIn(step: string, detail?: unknown, store: Store = localStorage, now: Date = new Date()): void {
  try {
    const lines = (store.getItem(KEY) ?? '').split('\n').filter(Boolean)
    lines.push(scrub(`${now.toISOString()} ${step} ${words(detail)}`.trim()))
    store.setItem(KEY, lines.slice(-MAX_LINES).join('\n'))
  } catch {
    // Nothing to do.
  }
}

export function signInLog(store: Store = localStorage): string {
  try {
    return store.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

/** An error as the log keeps it: msal's code and the reason under it, which its message leaves out. */
export function errorWords(error: unknown): string {
  if (error && typeof error === 'object') {
    const { errorCode, subError, errorMessage, name, message } = error as Record<string, unknown>
    if (typeof errorCode === 'string') return [errorCode, subError, typeof errorMessage === 'string' ? errorMessage.slice(0, 200) : undefined].filter(Boolean).join(' · ')
    if (typeof message === 'string') return `${String(name ?? 'error')} · ${message.slice(0, 200)}`
  }
  return String(error)
}

/** What microsoft put in the address, by name only: which fields came back, and the error when it is one. */
export function answerShape(hash: string, search = ''): string {
  const params = new URLSearchParams(hash.replace(/^#/, '') || search.replace(/^\?/, ''))
  const names = [...params.keys()]
  if (!names.length) return 'nothing'
  const said = ['error', 'error_subcode', 'error_description'].filter((name) => params.has(name)).map((name) => `${name}=${(params.get(name) ?? '').slice(0, 200)}`)
  return [`fields ${names.join(',')}`, ...said].join(' ')
}

/** The app's lines and the android shell's, in the order they happened. Every line starts with its time. */
export function mergeLogs(app: string, shell: string): string {
  return [...app.split('\n'), ...shell.split('\n')].filter(Boolean).sort((a, b) => a.slice(0, 24).localeCompare(b.slice(0, 24))).join('\n')
}
