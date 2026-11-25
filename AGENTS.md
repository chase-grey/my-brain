# project guidance

## ui copy and voice

- Keep interface copy short, direct, and natural. It should sound like the product owner, not like generated marketing or explanatory prose.
- Do not add subtitles, eyebrow text, helper copy, empty-state commentary, or other explanatory text unless it communicates something the user actually needs in that moment.
- Remove filler such as “Do these when their moment fits. They won’t block other suggestions.” Do not explain behavior that is already obvious from the interface.
- Use lowercase text for all interface-authored titles, subtitles, headings, navigation labels, button labels, form labels, options, placeholders, and similar controls.
- Preserve the original casing of user-entered content, proper nouns, acronyms, and data from external systems.
- Prefer familiar, plain labels over clever, polished, motivational, or conversational copy.
- When new copy is necessary and the wording is not obvious, ask the product owner what they would say or offer a few short lowercase options for them to choose from. Use their answer as the voice reference for similar copy.
- Do not block straightforward implementation on a copy interview when an established label or existing product-owner phrasing already provides a clear answer.

## color

The only colors are the theme tokens at the top of `src/styles.css`: the neutrals and the one accent. No red, yellow, amber or green for errors, warnings, delete, behind or success, and no new color tokens. Where something needs emphasis, use the accent, the text color or weight. The life wheel's eight area hues (`wheelHue`) name the areas and are the one exception. `src/styles.test.ts` fails on any other color.

The accent itself can be changed: settings has a swatch for the app's color and one for a color of my own, mixed on three sliders or typed as hex, kept on the device (`src/accent.ts`, `AccentPicker`; the pattern is `~/.claude/patterns/custom-accent.md`). Style against `--accent` and `--on-accent` only, never the default's hex, so everything follows it. The picker's own swatches and slider tracks are written in the component, the one place a color sits outside the tokens.

## updates

A new deploy reaches an open tab or installed window on its own (`src/appUpdate.ts`, the pattern in `~/.claude/patterns/app-update.md`; my-mail carries the same file). The app reloads onto it at a quiet moment: off screen, just reopened and not yet touched, or left alone for five minutes. It never reloads over an open sheet, a draft, or a screen that called `holdUpdates`. Until the reload happens, the more menu wears a dot and offers `update ready · restart`, and the settings button says the same. A new screen whose state a reload would lose calls `holdUpdates()`. Do not reload any other way.

The installed android app follows the same rules (Chase, 2026-11-25: no reinstalling for each change). Every push publishes the web part beside the apk, and the app downloads it and moves onto it at a quiet moment (`src/native/update.ts`, `UpdatePlugin.java`). Only a change to the native part (anything under `android/`, the shell's config, a capacitor package) needs the apk; then the button reads `update ready · install`, downloads it and opens android's installer, and nothing installs or reloads on its own. Keep native changes rare and together, since each one costs Chase an install. `update.test.ts` holds the choice between the two.

## status bar

Chase, 2026-11-25. The android shell draws the app under the phone's status bar and tells the page how tall it is. `--top-inset` in `src/styles.css` holds that height, and anything at the top edge (the top bar, a full-screen layer, the rail, a height worked out from the screen) pads itself by it. Never use `env(safe-area-inset-top)` directly: older phones report it wrong, and the shell's own number comes first. `shell.test.ts` holds this.

## monitors

Chase, 2026-11-25, after two asks. `src/fitColumns.ts` lays out every screen made of cards (today, progress, goals, settings, trips, the work dashboard) from the size of the window in both directions, and `fitColumns.test.ts` holds the rules.

- A window with height to spare stacks the cards into fewer columns and draws them larger, up to 1.35 times, rather than leaving a row of small cards over an empty window.
- Columns are added, and the cards shrunk back, only when the cards would otherwise run past the bottom of the window.
- Cards never go under 22rem wide, and the block of cards sits centred.
- A new screen made of cards joins `deckViews` in `App.tsx`. Do not give one a fixed column count or a width cap of its own.
- The side rail shows the screens from the … menu as buttons of its own while it has the height (`src/rail.ts`, `rail.test.ts`). Only what does not fit stays under …, and with nothing left under it the … is not drawn. A new screen is added to `moreViewsFor` with an icon, never to the rail or the menu alone.
- The phone is untouched: none of this applies under 48rem.

## localhost on the work pc

Chase, 2026-11-25. Epic's network blocks `chase-grey.github.io`, so on the work pc my-brain, my-mail and workout-tracker are served from `http://localhost:5270/` by `npm run local` (`scripts/local-apps.mjs`), side by side under the paths github pages gives them.

- It serves what is deployed: each app is built from `origin/main` in `<repo>/.worktrees/local`, checked every five minutes. It never serves a working tree. Never `rm -rf` that worktree, its `node_modules` is a junction to the real one.
- Microsoft knows a localhost copy only by its root (`http://localhost/`, any port), so sign-in returns to the root page, which hands the result back (`signInReturnUrl` in `src/site.ts`). Do not build a redirect address any other way.
- A sign-in is kept when the browser closes, on every device (Chase, 2026-11-25): `keepSignIn` gives msal's key cookie a 90 day life, renewed on each open. Without it every browser restart comes back signed out.
- A link from one app to another goes through `besideThisApp`, so a local copy opens the local sibling. A new link to a sibling app does the same.
- The bridge allows that origin (`$AllowedOrigins` in `work/bridge/work-bridge.ps1`).
- `site.test.ts` holds these; my-mail carries the same file.

## restarting the bridge

`npm run bridge` runs `work/bridge/work-bridge.ps1` (the work side is a separate private repo checked out at `work/`), a PowerShell HttpListener on port 47321. To restart it after an edit, stop only that process, by PID:

```powershell
# HttpListener binds through http.sys, so Get-NetTCPConnection reports PID 4 (System) for the port; find the bridge by its command line instead.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*work-bridge.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','work/bridge/work-bridge.ps1' -PassThru | Select-Object -ExpandProperty Id
```

Never kill powershell.exe by image name (`taskkill /IM`, `Stop-Process -Name`): every Session Runner terminal on this machine is a powershell.exe hosting a Claude session, and one such line killed all of them, twice, on 2026-11-05. A global hook now denies kills by image name; kill by PID.

## chat voice and context

Chase, 2026-11-25. `speech.test.ts`, `stopPhrase.test.ts`, `context.test.ts` and `ChatView.test.tsx` hold these.

- A spoken message is never cut off at a breath. The recognizer's stretches are chained (`dictate` in `src/voice/speech.ts`) and the message ends only after two seconds without a new word.
- Spoken words land in the message box as they are heard, and stay there when listening ends for any reason other than sending.
- The waveform button starts a conversation: a pause sends, the reply is read aloud, and it listens again. It ends on a tap, on the words "stop listening", or when the app is hidden, and never on quiet alone. A typed message with voice off is never read aloud.
- There is one button beside the message box (`composerButton` in `ChatView.tsx`): the waveform, which becomes send once there is typed text or an attached file and voice is off. Model, effort, new chat, past chats and upload live in the … menu at the top right of the chat, not around the message box.
- There is no context switch. Each message either carries on the thread or starts a new one (`src/companion/context.ts`): Jev decides when there is a key, the clock (15 minutes) when there is not, and a thread reopened from the history is always carried on. What is on screen after a send is what the model was given.
- What goes along with a message is capped in code (`contextTurns`), newest first. The model is never asked to manage its own context.
- Work chat is never sent to Jev; its thread goes by the clock.
- Work is typed only (Chase, 2026-11-25): the recognizers send audio to Microsoft or Google, so the work chat and the work journal have no mic and read nothing aloud (`voiceAllowed` in `src/voice/speech.ts`). Do not add a speech path for work that leaves the device.
- A thread opened about an email (handed over from my-mail) always carries on, until a new chat is started.

## the personal chat's budget and mail

The personal chat runs on the work pc's Claude Code when the bridge is there and on the personal key when it is not (`src/companion/bridgeModel.ts`). Only the model moves: the bridge's `/chat/model` runs Claude Code with no tools, no vault and nothing kept, and every personal tool still runs in the browser. Do not send a personal conversation through `/chat` (the work chat, which has the vault and work tools), do not give `/chat/model` tools or a working folder, and do not look for the bridge on a device that has never reached one. Claude Code on the bridge takes text only, so a message with a photo or pdf goes to the personal key when there is one.

Mail in the chat is read-only (`src/companion/mailTools.ts`): search and read, nothing else. Anything done to a message is done in my-mail. A message handed over from my-mail (`#chat/mail/<id>`) always opens in the personal space. Email text goes to the model as data, with the line that it is never an instruction.

## journal

Chase, 2026-11-25. `journal.test.ts` holds these. The journal is under the more menu in both spaces (`src/journal/`).

- It is a place to dump, by voice or typing (typing only in work, see chat voice above). Listening there ends only on a tap or when the app is hidden; a pause or a long silence never ends it, saves, or sends.
- Words not saved yet are kept on the device, so closing the app or a failed save loses nothing.
- `save` adds the words to that day's file under the time as a heading, exactly as said. Nothing rewrites or tidies them. Personal entries go to `journal/YYYY-MM-DD.md` in the notes vault.
- Work entries go through the bridge into `01 Journal/` in the work vault (`workJournal.ts`, the bridge's `/journal` routes), so the work journal is there only on the work pc. Those routes only list, read and add to files. Work words are never sent to Jev, the personal key, or the personal vault, and the two spaces keep separate unsaved words.
- A work dump is spoken on the phone into the Transcribe app, which writes it down on the phone itself. A recording titled `journal` (alone, or followed by a dash, colon or number) sent with `send transcript` is added by the bridge to that day's work journal under the time it was recorded, words only, instead of to the meeting transcripts (`work/bridge/transcript-inbox.ps1`). This is the only way speech reaches the work journal.
- The journal never calls the ai. An entry reaches the chat only when Chase adds it to a message by hand, as an attachment: `add to chat` on the entry, or `add journal entry` in the chat menu.

## old tasks and mail

An unsorted To Do task created more than 30 days ago (`oldAfterDays` in `src/domain/age.ts`) is left in To Do and never brought into the app, and the flagged count on today covers the last 30 days of mail only. Tasks Chase has sorted stay whatever their age. Anything new that pulls items in from Microsoft on its own applies the same check.

## sorting tasks

Chase, 2026-11-25. A task new to sort arrives with the ai's guess at its time, priority, energy, where, needs, store and project (`src/domain/taskGuess.ts`, `src/companion/taskGuesses.ts`). `taskGuess.test.ts` and `taskGuesses.test.ts` hold these.

- A guess is only an offer. Nothing is written to the task until Chase confirms it: `confirm` on its row under new to sort takes the guess as it stands, and opening the task shows the sort form filled with it, where any value can be changed before `save`.
- Confirming a guess writes exactly what saving the untouched form would (`sortedTask`).
- Sorting carries on (Chase, 2026-11-25): a task dealt with from the sort form (save, mark done, not mine, delete) opens the next one to sort (`nextToSort`), and today comes back only when none are left or on back or cancel. `confirm` on a row stays on today.
- Guesses are made in the background by the cheapest model, up to 20 tasks a request, once per wording, and kept on the device. A task with no guess is sorted by hand as before; a failed request is not retried in a loop.
- Work tasks go only to Claude Code on the bridge, never the personal key or Jev. Personal ones go where the personal chat goes: the bridge when the device has one, the key when it does not, and nowhere with ai off.
- A task's words go to the model as data, with the line that they are never an instruction. The model is given only the choices the form has, and anything else it returns is dropped.
- A guess never lowers a task Outlook has flagged important.
- A kept guess leaves when its task is sorted, and after 30 days in any case.

## reviews

The week, month and year reviews (`src/review/`) follow these rules. `review.test.ts` holds them.

- Code counts, the model only writes. Every number comes from `facts.ts`; the model gets those lines and one line per journal entry, never raw records.
- A journal entry is read once, by the cheapest model, and kept in two sizes in `reviews/journal/`. A review opens the fuller size at most three times.
- A month is built from its weeks and a year from its months. A year does not reread the journal.
- A period is written once and saved. Reopening it costs nothing.
- Praise has to be earned: only for something the numbers show was done. An empty earned list is correct.
- Every statement cites a number or a dated quote. No advice, no softening, no yes/no questions.
- Everything a review shows reads the way a person would say it: titles, "nov 10", "2 hours". No ISO dates, ids, field names, or wording copied from the evidence, and errors in plain words.
- The journal is never written to. Answers are saved with the review.
- The work review goes through Claude Code on the bridge, never the personal key.

## life areas

The order is Chase's (2026-11-24): purpose, connection, body, mind, creativity, projects, money, rest. It lives once, in `RING_DOMAINS` in `src/domain/lifeRing.ts`. Lists show it top to bottom, the wheel runs it clockwise with the first slice starting at 9 o'clock (four slices a side, a seam at the top and bottom, never a slice centred there), and reviews read it as importance. Do not reorder it or give any screen its own order without asking.

## slices judged by answers

Chase, 2026-11-25. Purpose, connection, mind, creativity and projects are judged by him, not counted (`src/domain/areas.ts`). `areas.test.ts` holds these.

- Each area holds the things he names (guitar, spanish, mentoring); in projects they are the personal projects still open. Each thing carries his answer to "happy with how often": happy, could be more, or not happy, filling 1, a half and nothing.
- Logging is never required. A slice fills from the answers alone. A log is optional and moves any open challenge on the same thing.
- A thing can carry a streak he types in when he likes (Duolingo). Nothing asks him to tick a practice daily.
- A challenge is a count toward a target ("see friends 4 times this month"), with or without a date. With a date it stays in the slice until the date and then moves to past, met or missed; without one it is never behind and leaves when met. In mind a challenge can count journal days or books finished on its own.
- The fill is the average of the answers; with challenges open, the answers are half and the challenges the other half, the split body uses.
- An answer older than 35 days is due: the slice dims, keeps its last fill, and the month review asks again. An old answer never counts as fresh.
- A slice is flagged when a thing is "not happy" or a challenge is behind.
- These five areas take no 28-day target. Body, money and rest keep their own readings.
- Journal days are counted from file names. An entry is never opened for this.
- Logs, finished challenges and finished books are kept 400 days.

## money and rest extras

- Money shows the saving rate (newest income minus newest spending) and says when the newest numbers are more than a month old.
- Rest keeps the monthly felt rating beside the phone's numbers; it is quoted in reviews and asked at the month review, and never changes the fill. One rating per 28 days: a second replaces the first.
- Bedtime is a third rest measure: nights asleep by a time he sets, read from the phone's sleep record (`bedMin`, minutes after noon). It shows only once the phone has sent one.

## body slice

The body slice follows workout-tracker (Chase, 2026-11-24), on every device (2026-11-25). The tracker posts a summary to its backend's `share` route (its side is `src/lib/brainShare.ts` there) and `src/domain/bodyTracker.ts` reads it with the tracker account key. `bodyTracker.test.ts` holds the rules.

- The tracker judges every week and goal. Nothing is re-scored here.
- The account key is `trackerToken` in settings and rides to the other devices in settings.json like the other keys. It comes from the sign-in under settings, or on its own on a device that is signed in to the tracker (both apps are served from `chase-grey.github.io`, so they share storage there, and the tracker leaves the same summary under `wt.share.body`).
- The streak fills the slice (Chase, 2026-11-25: not week specific, and close to full while the streak holds). It reads the last eight weeks: a week hit or saved by freezes kept the streak, and each missed week takes an eighth off. Goals behind their line take off up to a fifth: the share behind, out of every goal met or committed to. So with no week missed in the eight, body never reads under 80%. Met counts every goal the tracker shows as reached, committed or not.
- The slice's card shows what takes it under 100%: weeks missed and goals behind, each with the percent it costs. The goals row opens the goals by name, and `open workout tracker` lands on the tracker's goals (`?tab=progress` there).
- Today shows nothing from the tracker (Chase, 2026-11-25): training is tracked in workout-tracker. Here it appears only in the body slice on progress and in reviews.
- A week that ended with no word from the tracker counts as missed, and the streak is not shown until the tracker reports again.
- With a summary, body needs no 28-day target and the targets form does not ask for one. Without one, body works like every other area.
- Reviews read the body area from the same summary.

## money slice

The money slice follows money goals (Chase, 2026-11-25). `src/domain/money.ts` holds the rules and `money.test.ts` holds them to it.

- A money goal is one of three kinds: reach an amount by a date, pay a loan off by a date, or keep so many months of spending in savings.
- The numbers come from screenshots or are typed in. A screenshot is read once with the personal key, the numbers are shown to be checked before they are saved, and the picture is not kept. Account numbers are never kept.
- Pace is a straight line from the figure on the day the goal was set to the target on its date. On or ahead of the line fills that goal's share; behind fills the share of the expected ground that was covered. Every goal weighs the same.
- Today is the yardstick, so numbers that have gone stale read as behind until new ones arrive.
- With a money goal set, money needs no 28-day target and the targets form does not ask for one. Without one, money works like every other area.
- The chat is told the latest figures and where each goal stands, and reviews read the money area from the same goals.
- Nothing links to a bank. Do not add an aggregator or store a bank login without asking.

## rest slice

The rest slice reads the phone (Chase, 2026-11-25): sleep from Health Connect and screen time from Android's usage record, each against a goal Chase sets. `src/domain/rest.ts` holds the rules and `rest.test.ts` holds them to it.

- The slice reads the last 28 days: the share of nights that reached the sleep goal and the share of days under the screen time limit, each weighing the same.
- Today's screen time is still running and is left out. A day the phone has nothing for is left out, not counted as missed.
- With a goal that has days behind it, rest needs no 28-day target. Without one, rest works like every other area.
- The app only reads. Days are kept on the phone for 400 days and then dropped.

## texts and people

- The chat drafts a text only when Chase asks for one. The draft always opens in the messaging app and is sent from there; the app never sends a message and has no approve-to-send of its own (Chase, 2026-11-25).
- A draft sounds like Chase: his wording, length and casing, nothing a person would not actually text.
- The app does not read messages.
- Connection is logged when Chase is with someone (`saw someone`). Never infer it from texts or calls, and do not track who he has been out of touch with (Chase, 2026-11-25).

## time available

Chat is told how much time there is right now only when it is known: a length picked on today, or what the calendar shows (clear until the next event, in one until it ends, nothing else today). A default is never passed along as a fact. Until a length is picked, the picker starts on the longest choice that fits before the next event, and on the shortest during one (`freeNow` and `fittingMinutes` in `src/domain/calendar.ts`). With no calendar read it starts on 1h and chat hears no number. An event shown as free holds no time.

The work calendar comes from classic Outlook through the bridge (`GET /calendar`). The work space shows it on today and uses it for the picker and the time line; the events themselves are never given to chat.

Time for tasks ends at 9pm (`dayEndHour`; Chase, 2026-11-25). A clear stretch runs to 9pm, not midnight. Past 9pm the picker starts with nothing chosen, no tasks are suggested, and chat is told the day is over, in both spaces, until a length is picked after 9pm. A length picked earlier does not carry past 9pm or into the next day. Anything new that offers work to do applies the same end. `calendar.test.ts` and `companion.test.ts` hold these.

## keeping things in

From the security scan of 2026-11-25. `account.test.ts` and `ChatView.test.tsx` hold the first two.

- A setup link (`#setup=`) is taken only by a device that is not set up yet (`takesSetupLink` in `src/account.ts`). On a device that is, it is dropped: a link must never put keys, a vault or a model address over the ones already there.
- A reply never draws a picture from an address (`replyMarkdown` in `ChatView.tsx`). Anything new that draws model output must not fetch from an address the model wrote.
- The bridge lets in only the localhost copies of the app, and only requests addressed to itself (the Host check in `work/bridge/work-bridge.ps1`). The published site is not on its list, since the work pc cannot load it. The work chat is given no way to run a program.
- The apk is a release build: it cannot be debugged and the webview cannot be inspected, so a cable cannot read the keys the app keeps. Do not publish a debug build or turn `webContentsDebuggingEnabled` on.
- Backup is off (`allowBackup` and `data_extraction_rules.xml`): nothing the app keeps goes to Google Drive or across to a new phone.
- The phone takes a web update only when `update.json` was signed by the app's own signing key, the zip's hash is the one it names, and its build number is not lower than the phone's (`UpdatePlugin.java`, `scripts/SignUpdate.java`, the android workflow). The key to check against is read from the installed apk's certificate, never written in the code. A failed check is a failed download: the app stays on the build it has.
- Both builds install with `npm ci` from the lockfile, with its addresses pointed at npm's registry, so the hashes in it pin every package. Do not go back to deleting the lockfile. Actions that are not GitHub's own are pinned to a commit.
