import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser'
import { isNativeApp } from '../native/platform'

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
    redirectUri = `${window.location.origin}${import.meta.env.BASE_URL}`,
  ): Promise<PersonalMicrosoftAuth> {
    const client = new PublicClientApplication({
      auth: {
        clientId,
        authority: 'https://login.microsoftonline.com/consumers',
        redirectUri,
      },
      cache: { cacheLocation: BrowserCacheLocation.LocalStorage },
    })
    await client.initialize()
    // Coming back from a redirect sign-in (the android shell signs in this way) lands here with the result in the hash.
    const redirected = await client.handleRedirectPromise()
    if (redirected) client.setActiveAccount(redirected.account)
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
    if (this.byRedirect) {
      await this.client.loginRedirect({ scopes: [...personalGraphScopes] })
      return new Promise<AccountInfo>(() => {}) // the page is leaving; the account arrives through create() on return
    }
    const result = await this.client.loginPopup({ scopes: [...personalGraphScopes] })
    this.client.setActiveAccount(result.account)
    return result.account
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
      if (!interactive || !(error instanceof InteractionRequiredAuthError)) throw error
      if (this.byRedirect) {
        await this.client.acquireTokenRedirect({ account, scopes: [...personalGraphScopes] })
        return new Promise<string>(() => {})
      }
      const result = await this.client.acquireTokenPopup({ account, scopes: [...personalGraphScopes] })
      return result.accessToken
    }
  }
}
