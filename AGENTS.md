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

The accent is worn, not saved for emphasis alone (Chase, 2026-11-25: use it more, the way workout-tracker does): on the screen you are on in the tab bar and rail, the chosen space and the chosen option of any picker, the new task button, the ring of an open task, what I said in the chat, the chat's one button, secondary buttons, and anything that reads as loud, earned or needing me. Tints are mixed from `--accent` in place, never a new token. A new control of one of these kinds wears it the same way; titles, body text and card grounds stay neutral.

The accent itself can be changed: settings has a swatch for the app's color and one for a color of my own, mixed on three sliders or typed as hex, kept on the device (`src/accent.ts`, `AccentPicker`; the pattern is `~/.claude/patterns/custom-accent.md`). Style against `--accent` and `--on-accent` only, never the default's hex, so everything follows it. The picker's own swatches and slider tracks are written in the component, the one place a color sits outside the tokens.

## nothing left to do

Chase, 2026-11-25. A list that is empty because everything on it was dealt with is celebrated, not reported: the accent dot with the check cut out (`Done` in `src/ui.tsx`), no words, as my-mail's empty inbox. Today and this week on today wear it when nothing is due. The pattern is `~/.claude/patterns/empty-states.md`. An empty list that owes nothing either way (no notes yet, nothing found, loading) keeps its plain words (`Empty`). `done.test.tsx` holds this.

## done today

Chase, 2026-11-25. `doneToday.test.ts` and `motion.test.tsx` hold these.

- Today ends with a `done today` card: what was ticked off today in this space, tasks, store items and routines, newest first (`doneToday` in `src/domain/doneToday.ts`). It is not drawn until something is done, and "today" is the day on this device's clock, not the utc day.
- A task ticked off leaves the list it was on and turns up there. The today card keeps its count, and wears the check when everything due is done.
- Each row's check takes the task back.
- Personal care keeps its own card and checks and is not repeated there.

## motion

Chase, 2026-11-25. `motion.test.tsx` holds these; the styles are the last block of `src/styles.css`.

- A ticked task is seen done before it leaves: the check pops with a ring and sparks, the title strikes, and the row folds away (`TaskRow` in `src/ui.tsx`, `leaveMs`). The tick is saved when the row has gone, or at once if the screen is left first; a second tap while it is leaving takes it back. A new list of tasks uses `TaskRow` and gets this.
- A check pops only when it was just ticked there, never for one already done when the list was drawn.
- What arrives (a screen's pieces, a card, a row) only fades and moves up or down. Never sideways, never a whole card scaled: the card screens are measured while it plays, and nothing stops animations to measure, since that starts every one of them again.
- An animation on a card ends with `backwards`, never `both` or `forwards`: a card that keeps the last frame becomes its own layer and its menu opens under the next card.
- Every animation sits inside `prefers-reduced-motion: no-preference`, and with motion turned down a tick is saved at once.
- Motion wears the accent like everything else; no new colors.

## welcome and the tour

Chase, 2026-11-25. `tour.test.ts` and `WelcomeView.test.tsx` hold these; the rules are in `src/tour.ts` and it is workout-tracker's tour (`src/lib/tour.ts` there).

- The welcome asks a new person what the app is for (`uses`), between their name and ai. Nothing has to be picked.
- Picking email offers my mail and picking workouts offers workout tracker, on a step of their own that is not drawn otherwise (`appOffers`). The links go through `besideThisApp`. Picking email also points today's email card at my mail.
- The picks choose the tour's steps; someone who picked nothing is shown every step. The picks do not hide a screen.
- The tour follows the welcome's questions only. One of your own devices takes its settings from the account and is never shown it. `show me around` in settings starts it again. It is personal only.
- A step says why the thing matters, never how to press it. This is the one place the app explains itself; the rule against helper copy stands everywhere else.
- A step lights a screen's button or the new task button, never a card: cards come and go. A screen kept under … lights the ….
- What setup typed for the chat waits until the tour is over, and the tour ends on the screen it came up over.
- A new screen worth a sentence gets a step in `tourSteps`, with `needs` when it belongs to one pick.

## updates

A new deploy reaches an open tab or installed window on its own (`src/appUpdate.ts`, the pattern in `~/.claude/patterns/app-update.md`; my-mail carries the same file). The app reloads onto it at a quiet moment: off screen, just reopened and not yet touched, or left alone for five minutes. It never reloads over an open sheet, a draft, or a screen that called `holdUpdates`. Until the reload happens, the more menu wears a dot and offers `update ready · restart`, and the settings button says the same. A new screen whose state a reload would lose calls `holdUpdates()`. Do not reload any other way.

The installed android app follows the same rules (Chase, 2026-11-25: no reinstalling for each change). Every push publishes the web part beside the apk, and the app downloads it and moves onto it at a quiet moment (`src/native/update.ts`, `UpdatePlugin.java`). Only a change to the native part (anything under `android/`, the shell's config, a capacitor package) needs the apk; then the button reads `update ready · install`, downloads it and opens android's installer, and nothing installs or reloads on its own. Keep native changes rare and together, since each one costs Chase an install. `update.test.ts` holds the choice between the two.

A move onto an update lands on the newest build, never the one that was found (Chase, 2026-11-25: several updates came one restart at a time). The shell moves onto the build it has downloaded, so the app keeps asking after it has found one, and both the button and the quiet reload ask once more before moving (`appUpdate.flow.test.ts`). On the web the reload fetches the page fresh, so it lands on the newest by itself.

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

## signing in to microsoft

Chase, 2026-11-25. `signInReturn.test.ts` holds these.

- Connecting leaves him on the screen he connected from. In a browser the sign-in is a popup and the page never moves. In the android shell the whole page goes to microsoft, so the screen is remembered before it leaves (`rememberPlace`) and put back before the app starts (`takeSignInResponse`). A new redirect to microsoft calls `rememberPlace` first.
- Microsoft's answer is taken out of the address before the app starts and handed to msal from memory. Never leave it for msal to read from the address: the app writes its own hash there first.
- A popup or a hidden renewal frame hands its answer to the window that asked, in the shell too (`signInArrival`). Only the shell's own top page keeps it.
- A sign-in window may stay open ten minutes (`signInWindowMs`; my-mail sets the same). msal's default minute ends while a password and a code are still being typed, and shows as `timed_out`.
- msal empties the address once it has read an answer, even one handed to it from memory, and the app follows an emptied address to today. The screen that was put back is held from before the app starts until the answer has been read (`holdPlace`, `placeHeld`).
- The android shell brings the page back to the app only when it is away at another site (`ReturnPlugin.java`). The app moving within itself, as a reload onto an update does, is left to the webview: loading the address it is already on would reload nothing.
- The phone app cannot be inspected from a computer, so a sign-in writes down what it did (`src/signInLog.ts`, and the shell's side in `ReturnPlugin.java`): steps, msal's error codes with the reason under them, and addresses without anything after ? or #. Never a token, a code or an email. `sign-in log` shows it beside a failed or missing connection, to read or copy. A new step in signing in adds its line. `signInLog.test.ts` holds what it may keep.
- `.scratch/pw/redirect-signin.mjs` and `redirect-place.mjs` run the shell's whole-page sign-in in desktop Edge against the real account. They cover the app's side, not the webview's.

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

## notes and the journal

Chase, 2026-11-25. `notes.test.ts` and `journal.test.ts` hold these. Notes is under the more menu in personal (`src/notes/`); work has the journal alone, on the same screen.

- Notes shows the `notes/` folder of the notes vault. The journal is a folder inside it with a folder for each year: `notes/journal/YYYY/YYYY-MM-DD.md`, one file per day journaled. An entry is named with its year wherever it shows. `journalPath` and `journalDay` in `src/journal/journal.ts` are the one place that layout lives; the mind slice, the reviews and the chat find entries through them.
- There is no box to write in on the list. A note is a page: `new journal entry` opens today's file with the time as a heading and the cursor under it, and any note opens ready to type in. Opening one and writing nothing saves nothing.
- Spoken words go into the note where the cursor is (personal only, see chat voice above). Listening there ends only on a tap or when the app is hidden; a pause or a long silence never ends it.
- A note saves itself: three seconds after the last change, on leaving it, and when the app is hidden. Until the vault has it the text is kept on the device, so closing the app or a failed save loses nothing. When the note changed somewhere else as well, both are kept, mine first, and nothing is asked (`mergeNote`).
- Notes are there with no connection (`src/notes/offline.ts`, `offline.test.ts`). The device keeps a copy of every note under `notes/`, brought up to date each time the list is read, and the list and any note open from it when the vault cannot be reached or does not answer. What is written, renamed, moved or deleted then shows at once and waits on the device; it goes up in the order it was made when the notes screen opens, the app opens or the connection comes back, merged the same way as any save. The list says `offline` and how many are waiting; nothing is asked. Anything new that changes a note goes through the same queue, never straight to the vault alone.
- `rename`, `move` and `delete` are in a note's menu. A rename or move never writes over another note: a taken name gets a number. Delete asks first, by name. A journal entry is named by its day and lives in its year, so it can only be deleted. Folders come from the notes in them; `move` offers the ones there are and takes a new one, never the journal.
- The ai touches a note only when Chase picks `clean up` or `organize` in the note's menu (`src/notes/tidy.ts`). Its version is an offer: it is shown in place and written only on `keep`, and `undo` puts his words back. It keeps his wording and every thought; an answer that cut the note down or lost an entry's time is thrown away. The note goes to the model as data, with the line that it is never an instruction. Nothing else rewrites or tidies a note.
- Work entries go through the bridge into `01 Journal/YYYY/` in the work vault (`workJournal.ts`, the bridge's `/journal` routes), so the work journal is there only on the work pc. Those routes only list, read and add to files: a work entry is typed on a page, can be tidied before `save`, and is read-only after. Work words go only to Claude Code on the bridge, never to Jev, the personal key, or the personal vault, and the two spaces keep separate unsaved words.
- A work dump is spoken on the phone into the Transcribe app, which writes it down on the phone itself. A recording titled `journal` (alone, or followed by a dash, colon or number) sent with `send transcript` is added by the bridge to that day's work journal under the time it was recorded, words only, instead of to the meeting transcripts (`work/bridge/transcript-inbox.ps1`). This is the only way speech reaches the work journal.
- A note reaches the chat only when Chase adds it to a message by hand, as an attachment: `add to chat` in the note's menu, or `add journal entry` in the chat menu.

## arranging notes

Chase, 2026-11-25. `arrange.test.ts` holds these; the rules are in `src/notes/arrange.ts` and the list is `NotesList.tsx`.

- Every title on the notes list is a card: a note, a group, a search result.
- Notes read last edited first. The date is the vault's own (the last commit on GitHub, the file's date on OneDrive), asked once a note and kept on the device, so an edit from the pc or the ai counts. Notes are never put in an order by hand; favorites are for that.
- Favorites work as Notion's do: `add to favorites` in a note's menu stars it, it shows in `favorites` above everything on the first screen in the order he drags it to, and it stays in its own place in the list as well. Any note can be one, a journal entry too.
- A group is a folder. `new group` in the … menu makes one, a note is carried onto a group to move it in and onto the folder above to move it out, and groups are dragged into an order of his own. Until one is dragged they read last edited first, and a group newer than his order sits above it.
- A group goes only when he deletes it (`delete group`, offered once it is empty). One left empty by its last note stays.
- With a mouse a card is carried as soon as it is pulled; with a finger after a short hold, so the list still scrolls. A press that carried a card does not also open it.
- The journal is left alone: years and days newest first, entries stay in their year, and nothing is carried in or out.
- What he arranged is one file in the vault, `notes/.arrange.json`, so every device shows the same. A change made with no connection shows at once and goes up later, and the last change made stands.
- Work has none of this: its journal is a list of cards and nothing more.

## where i am, and gone

Chase, 2026-11-25. `whereabouts.test.ts` and `Whereabouts.test.tsx` hold these.

- Where he is comes from the phone's wifi, never from a position (`src/domain/whereabouts.ts`, `WifiPlugin.java`): on the network named for home or work in settings he is there, on no wifi or any other network he is out. Android gives a network's name only with the location permission, so the app holds it, and reads the name and nothing else. Do not read a position, scan for networks, or add any other location tracking.
- A place picked by hand on today comes first. Where the wifi says nothing (a browser, the name not allowed, neither network named) the clock decides as before: weekday office hours are work, the rest home.
- Gone is a note to himself with a day back, set from the same picker. Until that day today keeps the calendar, the habits and what is due today and this week, and puts away new to sort, extra time, the email card and the open count. It ends on the day back, on `i'm back`, or when a place is picked. It rides in settings.json to every device, and the work space goes by it too.
- Coming back writes today's date as the day back, never a blank, so the other devices hear it.

## old tasks and mail

An unsorted To Do task created more than 30 days ago (`oldAfterDays` in `src/domain/age.ts`) is left in To Do and never brought into the app, and the email card on today reads the last 30 days of mail only. Tasks Chase has sorted stay whatever their age. Anything new that pulls items in from Microsoft on its own applies the same check.

## email on today

Chase, 2026-11-25. Today shows the email card only when mail needs something done: a conversation in the inbox from the last 30 days that is flagged, marked important by the sender, or sorted by my-mail as needing a reply or an action (`inboxCounts` in `src/data/mailGraphProvider.ts`). Unread mail and mail waiting on someone else never bring it up, and with nothing to do the card is not drawn. `mailGraphProvider.test.ts` and `TodayView.test.tsx` hold this.

## sorting tasks

Chase, 2026-11-25. A task new to sort arrives with the ai's guess at its time, priority, energy, where, store and project (`src/domain/taskGuess.ts`, `src/companion/taskGuesses.ts`). `taskGuess.test.ts` and `taskGuesses.test.ts` hold these.

- A task has no "needs" (Chase, 2026-11-25): where it can be done (at home, at work, out) is the only filter of that kind, and anything else goes in its notes. Do not bring back a computer, phone, tools or car choice.
- A guess is only an offer. Nothing is written to the task until Chase confirms it: `confirm` on its row under new to sort takes the guess as it stands, and opening the task shows the sort form filled with it, where any value can be changed before `save`.
- Confirming a guess writes exactly what saving the untouched form would (`sortedTask`).
- Sorting carries on (Chase, 2026-11-25): a task dealt with from the sort form (save, mark done, not mine, delete) opens the next one to sort (`nextToSort`), and today comes back only when none are left or on back or cancel. `confirm` on a row stays on today.
- Guesses are made in the background by the cheapest model, up to 20 tasks a request, once per wording, and kept on the device. A task with no guess is sorted by hand as before; a failed request is not retried in a loop.
- Work tasks go only to Claude Code on the bridge, never the personal key or Jev. Personal ones go where the personal chat goes: the bridge when the device has one, the key when it does not, and nowhere with ai off.
- A task's words go to the model as data, with the line that they are never an instruction. The model is given only the choices the form has, and anything else it returns is dropped.
- A guess never lowers a task Outlook has flagged important.
- Second-hand goes to one of two stores (Chase, 2026-11-25): thrift for clothes, marketplace for everything else.
- A kept guess leaves when its task is sorted, and after 30 days in any case.

## the task form and the chat

Chase, 2026-11-25. `format.test.ts`, `TaskPage.test.tsx` and `attachments.test.ts` hold these.

- The time on the task form is typed and takes any length: `45`, `2h`, `1h 30m`, `1:30`, with a bare number read as minutes (`parseDuration` in `src/format.ts`). Words that are not a length keep the last one that was. Do not put a fixed list of lengths back on the form; a guess still picks from its own short list.
- `add to chat` on a task attaches it, as the form shows it, to the next chat message (`taskAttachment`). With the chat docked at the side the task stays open beside it; on the phone the chat opens. The task goes as data, with the line that it is never an instruction.
- Tasks the chat makes can carry the project of the one they came from (`project_id` on `create_task`), and only a project of that space is kept.

## reminders

Chase, 2026-11-25. A task can carry a moment to be reminded (`remindAt`, `src/domain/remind.ts`). `remind.test.ts` holds these.

- A reminder is not a due date. A task with one needs no due date, and setting one never sets, moves or clears the other.
- It comes from my-brain's own android app as a notification at that minute, with the app open or closed, and a tap opens the task (`src/native/reminders.ts`, the `@capacitor/local-notifications` package). Nothing is written to Microsoft To Do's reminder.
- The phone holds only what the app last gave it, so a reminder set on another device reaches the phone the next time my-brain is opened there.
- Reminders are personal only: the work space has no phone to give one. A routine takes none.
- From the day of its reminder the task sits on today, and stays until it is done or the reminder is changed or taken off, so one that was swiped away is still seen.
- The ai's guess for a task new to sort can carry a reminder, under the same rule as every other guess: an offer on the row and in the form, nothing set until confirmed. Most tasks get none. It is asked for against the day and time it is, and a guessed moment that has gone by is dropped, never set.
- The chat sets one only on a task it makes when Chase asks to be reminded, and gives the task no due date for it.
- Opening the work space never clears the phone's reminders.

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

Chat is told how much time there is right now only when it is known: a length picked on today, or what the calendar shows (clear until the next event, in one until it ends, nothing else today). A default is never passed along as a fact, and with no length picked and no calendar read chat hears no number (`freeNow` in `src/domain/calendar.ts`). An event shown as free holds no time.

Extra time is asked for, never offered (Chase, 2026-11-25). Today shows only `i have extra time` until he taps it; the card then holds a slider that starts on nothing, and tasks are suggested only once he has moved it. The slider reaches any length up to a full day (`timeStops`). The length stands for the day, the card with it, and `hide` in the card's menu puts both away. Do not start the slider on a length of the app's choosing or bring back a fixed list of lengths. `ExtraTime.test.tsx` holds these.

The work calendar comes from classic Outlook through the bridge (`GET /calendar`). The work space shows it on today and uses it for the time line; the events themselves are never given to chat.

Time for tasks ends at 9pm (`dayEndHour`; Chase, 2026-11-25). A clear stretch runs to 9pm, not midnight. Past 9pm no tasks are suggested and chat is told the day is over, in both spaces, until a length is picked after 9pm. A length picked earlier does not carry past 9pm or into the next day. Anything new that offers work to do applies the same end. `calendar.test.ts` and `companion.test.ts` hold these.

## keeping things in

From the security scan of 2026-11-25. `account.test.ts` and `ChatView.test.tsx` hold the first two.

- A setup link (`#setup=`) is taken only by a device that is not set up yet (`takesSetupLink` in `src/account.ts`). On a device that is, it is dropped: a link must never put keys, a vault or a model address over the ones already there.
- A reply never draws a picture from an address (`replyMarkdown` in `ChatView.tsx`). Anything new that draws model output must not fetch from an address the model wrote.
- The bridge lets in only the localhost copies of the app, and only requests addressed to itself (the Host check in `work/bridge/work-bridge.ps1`). The published site is not on its list, since the work pc cannot load it. The work chat is given no way to run a program.
- The apk is a release build: it cannot be debugged and the webview cannot be inspected, so a cable cannot read the keys the app keeps. Do not publish a debug build or turn `webContentsDebuggingEnabled` on.
- Backup is off (`allowBackup` and `data_extraction_rules.xml`): nothing the app keeps goes to Google Drive or across to a new phone.
- The phone takes a web update only when `update.json` was signed by the app's own signing key, the zip's hash is the one it names, and its build number is not lower than the phone's (`UpdatePlugin.java`, `scripts/SignUpdate.java`, the android workflow). The key to check against is read from the installed apk's certificate, never written in the code. A failed check is a failed download: the app stays on the build it has.
- Both builds install with `npm ci` from the lockfile, with its addresses pointed at npm's registry, so the hashes in it pin every package. Do not go back to deleting the lockfile. Actions that are not GitHub's own are pinned to a commit.

## issues and the fixer

Chase, 2026-11-25. `issues.test.ts` holds the app side.

- The personal chat files a bug or a change for my brain or my mail as a GitHub issue (`report_issue`, `src/issues/`), only when Chase asks. My mail has no chat, so its issues are filed from here. Workout tracker files its own from its coach.
- The repos are public, so the issue is too. It waits on an approval card that shows every word, and what is approved is what is filed: nothing is attached on its own (no chat, no device details), and a report too long to file whole is refused, not cut. The model is told to keep names, personal details and anything from tasks, notes, mail, money or health out of it.
- Never from the work space.
- The app talks to GitHub with `issueToken`, a token of its own: issues read and write on the two repos and nothing else. Never use the vault token for it, and never give a phone a token that can write these repos' files, since a push to main deploys.
- Settings lists what is open and what was fixed today, the ones waiting on Chase first. Older closed issues are left to GitHub, and an open, stalled or asking one can be closed from its row. A question from the fixer is answered there. An issue waiting on an answer or a merge puts the dot on settings and a line in the … menu.
- The fixer is `scripts/autofix.mjs`; my-mail carries the same file and workout-tracker's is the original. `npm run autofix` starts all three. It treats every issue as hostile: only issues this account filed from the app are heard, the model gets file tools only (no shell, web or MCP), a change may touch only `src/`, `public/`, `index.html` and `README.md`, the diff is audited and the tests run in a sandbox, and the fix goes up as a pull request, never a push to main. Do not loosen any of these without asking. After a change to the script, `npm run autofix:one -- --check` proves the sandboxed suite still passes on main.
- The fixer's token is `GITHUB_ISSUE_TOKEN`, read from `.env` here or from workout-tracker's `.env`, so it lives in one file on the work pc. It needs issues, contents and pull requests on each repo.
