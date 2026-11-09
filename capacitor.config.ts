import type { CapacitorConfig } from '@capacitor/cli'

// The android shell around the web app. The web build it wraps is `npm run build:android`, which uses base "/"
// because the shell serves the app from https://localhost rather than from the github pages subpath.
const config: CapacitorConfig = {
  appId: 'com.chasegrey.mybrain',
  appName: 'My Brain',
  webDir: 'dist',
  android: {
    // msal signs in by redirect inside the webview and comes back to https://localhost, which the shell serves itself.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    // microsoft's sign-in pages have to load inside the webview so their redirect can land back on the app.
    allowNavigation: ['login.microsoftonline.com', 'login.live.com', '*.microsoftonline.com', '*.live.com', '*.msauth.net', '*.msftauth.net'],
  },
}

export default config
