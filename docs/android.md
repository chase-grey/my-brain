# android shell

The phone app is the same web app inside a Capacitor shell (`android/`). The shell exists for three things a
browser cannot do on Android: a home-screen widget, speech recognition inside the app, and later an always-on
assistant. GitHub Pages keeps serving the web build for the PC and anyone else.

## voice

Voice lives in `src/voice/`. The mic button in the chat composer hears one message and sends it. The
**hands-free** pill in the chat header keeps going: listen, send, speak the reply, listen again, until it is
turned off, the tab is hidden, or nothing was heard three times in a row. Replies are only spoken in hands-free.

- In a browser, listening and speaking use the Web Speech API. Chrome on Android needs the network to recognize.
- In the shell, the webview has no speech recognition, so `src/voice/nativeSpeech.ts` goes through the phone's
  recognizer and text-to-speech engine (`@capacitor-community/speech-recognition`, `@capacitor-community/text-to-speech`).
  No interim text is shown there; the caption says "listening" until the phrase is done.
- `#chat/talk` opens the chat already in hands-free. The web manifest shortcut, the android icon shortcut, and the
  widget's talk button all go there.

## widget

`TodayWidget` (Java, `android/app/src/main/java/com/chasegrey/mybrain/`) draws today's open commitments with the
same hints as the today card, plus a talk button. The web app pushes the lines whenever they change through the
`Widget` Capacitor plugin (`src/native/widget.ts` → `WidgetPlugin.java`), which stores them in shared preferences
and redraws every placed widget. Taps are `mybrain://` links: `mybrain://today`, `mybrain://task/<id>`,
`mybrain://chat/talk`. `src/native/platform.ts` turns those into hash routes on launch and while the app is open.

## building

Needs Android Studio (or the SDK plus JDK 17+). Nothing on the build PC is required beyond Node for the web part.

```sh
npm run build:android   # web build with base "/" then cap sync android
npm run android         # opens android/ in Android Studio; run on the phone from there
```

`vite build --mode capacitor` uses base `/` because the shell serves from `https://localhost`, while the Pages
build uses `/my-brain/`. Vite only reads `.env`, `.env.local`, and `.env.capacitor*` in that mode, so keep
`VITE_MICROSOFT_CLIENT_ID` in `.env.local` if the shell should sign in to Microsoft.

The web build lands in `android/app/src/main/assets/public` and is ignored by git. Commit the rest of `android/`.

Signing and Play: the app id is `com.chasegrey.mybrain`. For a single-user install, a debug build from Android
Studio or a signed APK sideloaded is enough; the internal testing track works if the Play listing is wanted.

## one-time manual steps

1. **Entra app registration**: add `https://localhost/` as a redirect URI under the *Single-page application*
   platform of the app behind `VITE_MICROSOFT_CLIENT_ID`. Inside the shell, sign-in uses the redirect flow in the
   webview and comes back to that origin. Without it, connecting Microsoft in the shell fails with a redirect
   mismatch.
2. **Install Android Studio** on the PC that will build, open `android/`, let Gradle sync, plug in the phone with
   USB debugging on, run.
3. On the phone, long-press the home screen, add the **today** widget, and allow the microphone the first time the
   mic is tapped.

## not done yet

- The Anthropic key and GitHub token still live in web storage inside the shell, same as in the browser. Moving them
  into the Android keystore needs a secure-storage plugin and an async settings load.
- The "hey ..." wake word and registering as the phone's assistant (step 4 of the plan).
- Nothing here has been compiled: the build PC had no Android SDK or JDK when this was written. Expect small
  fixes on the first Gradle build.
