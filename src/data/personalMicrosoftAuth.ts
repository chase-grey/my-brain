import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  LogLevel,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser'
import { isNativeApp } from '../native/platform'
import { keepSignIn, signInReturnUrl } from '../site'
import { keptSignInResponse, placeHeld, rememberPlace, signInWindowMs } from '../signInReturn'
import { errorWords, noteSignIn } from '../signInLog'

/** msal's own lines go in the sign-in log only around a sign-in, so renewing a token all day does not fill it. */
let msalLines = 0
const msalLinesPerSignIn = 60
/** msal says the same line for every token it hands out; each is kept once per sign-in. */
const msalSaid = new Set<string>()
function watchMsal(): void {
  msalLines = msalLinesPerSignIn
  msalSaid.clear()
}

export const personalGraphScopes = [
  'Tasks.ReadWrite',
  'Files.ReadWrite.AppFolder',
  'Calendars.ReadWrite',
  'Mail.Read',
] as const

export class PersonalMicrosoftAuth {
  private constructor(private readonly client: PublicClientApplication) {}

  static async create(
    clientId: string,
    redirectUri = signInReturnUrl(),
  ): Promise<PersonalMicrosoftAuth> {
    const client = new PublicClientApplication({
      auth: {
        clientId,
        authority: 'https://login.microsoftonline.com/consumers',
        redirectUri,
      },
      cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
      system: {
        popupBridgeTimeout: signInWindowMs,
        loggerOptions: {
          logLevel: LogLevel.Info,
          piiLoggingEnabled: false,
          loggerCallback: (level, message, containsPii) => {
            if (containsPii) return
            // The line without its clock and request id, which this log does not need.
            const said = message.slice(message.lastIndexOf(' - ') + 3)
            if (level > LogLevel.Warning && (msalLines <= 0 || msalSaid.has(said))) return
            msalLines -= 1
            msalSaid.add(said)
            noteSignIn(`msal ${LogLevel[level].toLowerCase()}`, said)
          },
        },
      },
    })
    // Coming back from a redirect sign-in (the android shell signs in this way), with the result taken out of the address before the app started.
    const returned = keptSignInResponse()
    watchMsal()
    noteSignIn('start', { native: isNativeApp(), answer: returned ? 'kept' : 'none', returnTo: redirectUri })
    try {
      await client.initialize()
      keepSignIn()
      const redirected = await client.handleRedirectPromise(returned ? { hash: returned, navigateToLoginRequestUrl: false } : undefined).finally(placeHeld)
      if (redirected) client.setActiveAccount(redirected.account)
      noteSignIn('started', { signedInByAnswer: Boolean(redirected), accounts: client.getAllAccounts().length })
    } catch (error) {
      noteSignIn('start failed', errorWords(error))
      throw error
    }
    return new PersonalMicrosoftAuth(client)
  }

  /** Popups do not exist in the shell's webview, so there the whole page goes to microsoft and comes back. */
  private get byRedirect(): boolean {
    return isNativeApp()
  }

  account(): AccountInfo | undefined {
    return this.client.getActiveAccount() ?? this.client.getAllAccounts()[0]
  }

  async signIn(): Promise<AccountInfo> {
    watchMsal()
    noteSignIn('sign in', { how: this.byRedirect ? 'redirect' : 'popup', page: window.location.pathname })
    try {
      if (this.byRedirect) {
        rememberPlace()
        notePageLeaving()
        await this.client.loginRedirect({ scopes: [...personalGraphScopes] })
        return new Promise<AccountInfo>(() => {}) // the page is leaving; the account arrives through create() on return
      }
      const result = await this.client.loginPopup({ scopes: [...personalGraphScopes] })
      this.client.setActiveAccount(result.account)
      noteSignIn('signed in')
      return result.account
    } catch (error) {
      noteSignIn('sign in failed', errorWords(error))
      throw error
    }
  }

  async signOut(): Promise<void> {
    const account = this.account()
    if (!account) return
    if (this.byRedirect) await this.client.logoutRedirect({ account })
    else await this.client.logoutPopup({ account })
  }

  async accessToken(interactive = false): Promise<string> {
    const account = this.account()
    if (!account) {
      if (interactive) {
        await this.signIn()
        return await this.accessToken(false)
      }
      throw new InteractionRequiredAuthError('sign_in_required', 'connect a microsoft account first')
    }

    try {
      const result = await this.client.acquireTokenSilent({ account, scopes: [...personalGraphScopes] })
      return result.accessToken
    } catch (error) {
      noteSignIn('token failed', { asked: interactive ? 'by hand' : 'quietly', error: errorWords(error) })
      if (!interactive || !(error instanceof InteractionRequiredAuthError)) throw error
      watchMsal()
      try {
        if (this.byRedirect) {
          rememberPlace()
          notePageLeaving()
          await this.client.acquireTokenRedirect({ account, scopes: [...personalGraphScopes] })
          return new Promise<string>(() => {})
        }
        const result = await this.client.acquireTokenPopup({ account, scopes: [...personalGraphScopes] })
        return result.accessToken
      } catch (again) {
        noteSignIn('reconnect failed', errorWords(again))
        throw again
      }
    }
  }
}

/** Whether the page ever left for microsoft, and whether it was only put aside and brought back. */
function notePageLeaving(): void {
  window.addEventListener('pagehide', (event) => noteSignIn('page leaving', { kept: event.persisted }), { once: true })
  window.addEventListener('pageshow', (event) => { if (event.persisted) noteSignIn('page brought back') }, { once: true })
}
