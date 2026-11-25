# android shell

The phone app is the same web app inside a Capacitor shell (`android/`). The shell exists for three things a
browser cannot do on Android: a home-screen widget, speech recognition inside the app, reading sleep and screen
time for the rest slice, and later an always-on assistant. GitHub Pages keeps serving the web build for the PC and anyone else.

## voice

Voice lives in `src/voice/`. The mic button in the chat composer starts a conversation: it listens, sends when the
speaker has stopped for two seconds, speaks the reply, and listens again, until it is tapped again, hears
"stop listening", or the tab is hidden. Words appear in the message box as they are heard and stay there if
listening ends before they are sent. The recognizer stops at every breath, so `dictate` chains its stretches;
a breath never sends. Replies are only spoken while a conversation is on.

- In a browser, listening and speaking use the Web Speech API. Chrome on Android needs the network to recognize.
- In the shell, the webview has no speech recognition, so `src/voice/nativeSpeech.ts` goes through the phone's
  recognizer and text-to-speech engine (`@capacitor-community/speech-recognition`, `@capacitor-community/text-to-speech`).
  No interim text arrives there; the words show up a phrase at a time.
- `#chat/talk` opens the chat already listening. The web manifest shortcut, the android icon shortcut, and the
  widget's talk button all go there.

## widget

`TodayWidget` (Java, `android/app/src/main/java/com/chasegrey/mybrain/`) draws today's open commitments with the
same hints as the today card, plus a talk button. The web app pushes the lines whenever they change through the
`Widget` Capacitor plugin (`src/native/widget.ts` → `WidgetPlugin.java`), which stores them in shared preferences
and redraws every placed widget. Taps are `mybrain://` links: `mybrain://today`, `mybrain://task/<id>`,
`mybrain://chat/talk`. `src/native/platform.ts` turns those into hash routes on launch and while the app is open.

## sleep and screen time

The rest slice reads the phone through the `Health` plugin (`src/native/health.ts` -> `HealthPlugin.java`). It only
reads, and nothing leaves the phone except the daily totals the app keeps for itself.

- Sleep comes from Health Connect, so whatever writes sleep there (the Pixel's bedtime tracking, a watch, a ring)
  is the source. It needs Android 14 or later. `connect sleep` on the rest slice raises the Health Connect prompt.
- Screen time is the usage record (`UsageStatsManager`): time with any app in front, the home screen left out.
  `allow screen time` opens Android's usage access screen, where the switch for my brain is turned on.
- The phone holds daily screen time for about a week, so the app reads on every open and return to the front and
  keeps the days itself (`mergeRestDays` in `src/domain/rest.ts`, 400 days). A week without opening the app
  leaves a gap; those days are left out of the slice.
- The days live on the phone only. The PC's rest slice does not see them.

## texts

The chat drafts a text only when asked, and never sends one. The draft card's `open in messages` is an `sms:`
link, which the shell hands to the phone's messaging app with the words filled in. Nothing reads messages, so
the shell asks for no SMS permission.

## building

GitHub builds the app on every push to main (`.github/workflows/android.yml`) and replaces the apk on the
`android` release, so the phone always installs from the same address:
https://github.com/chase-grey/my-brain/releases/download/android/my-brain.apk. The work PC cannot run Android
Studio (it is blocked there), so this is how the app gets built. Each build is signed with the key in the repo
secrets `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`, which is what lets a new apk install over the
last one and keep the app's data. The key exists only in those secrets; replacing it means uninstalling the app once.

## updates

The phone does not need a reinstall for each change. Every build also publishes the web part of the app
(`web-<commit>.zip`) and `update.json` on the same release. `update.json` names the commit and a fingerprint of the
native part: the `android/` folder, `capacitor.config.ts` and the versions of the capacitor packages.

- **Web part changed, native part the same** (nearly every push): the app downloads the zip into its own files,
  and at a quiet moment has the shell serve that folder instead of the copy inside the apk, then reloads. The
  rules for a quiet moment, the dot and `update ready · restart` are the web app's (`src/appUpdate.ts`). The shell
  remembers the folder, so a cold start opens on it too.
- **Native part changed**: the web part is not taken on its own. The more menu and settings read
  `update ready · install`; the button downloads the apk and opens android's installer, which asks before it
  installs (and, the first time, asks to let My Brain install apps). A new apk starts from its own copy again.
- A downloaded build that starts twice without the app coming up is dropped, the copy inside the apk is used,
  and that build is not downloaded again.
- The app only ever downloads from the `android` release (`UpdatePlugin.java` holds the address).

`src/native/update.ts` decides which of the two a published build needs; `UpdatePlugin.java` does the downloading.

To build on a PC instead, it needs Android Studio (or the SDK plus JDK 21). Nothing else is required beyond Node
for the web part.

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

1. **Entra app registration**: `https://localhost/` is a redirect URI under the *Single-page application*
   platform of the app behind `VITE_MICROSOFT_CLIENT_ID` (added 2026-11-19). Inside the shell, sign-in uses the
   redirect flow in the webview and comes back to that origin. Nothing to do unless the registration is remade.
2. **Install the apk** on the phone from the address under building, allowing the browser to install apps the
   first time.
3. On the phone, long-press the home screen, add the **today** widget, and allow the microphone the first time the
   mic is tapped.
4. On progress, open the rest slice, tap **connect sleep** and **allow screen time**, then set the two goals.

## not done yet

- The Anthropic key and GitHub token still live in web storage inside the shell, same as in the browser. Moving them
  into the Android keystore needs a secure-storage plugin and an async settings load.
- The "hey ..." wake word and registering as the phone's assistant (step 4 of the plan).
