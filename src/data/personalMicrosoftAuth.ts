import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo,
} from '@azure/msal-browser'

export const personalGraphScopes = [
  'Tasks.ReadWrite',
  'Files.ReadWrite.AppFolder',
  'Calendars.ReadWrite',
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
    return new PersonalMicrosoftAuth(client)
  }

  account(): AccountInfo | undefined {
    return this.client.getActiveAccount() ?? this.client.getAllAccounts()[0]
  }

  async signIn(): Promise<AccountInfo> {
    const result = await this.client.loginPopup({ scopes: [...personalGraphScopes] })
    this.client.setActiveAccount(result.account)
    return result.account
  }

  async signOut(): Promise<void> {
    const account = this.account()
    if (account) await this.client.logoutPopup({ account })
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
      const result = await this.client.acquireTokenPopup({ account, scopes: [...personalGraphScopes] })
      return result.accessToken
    }
  }
}
