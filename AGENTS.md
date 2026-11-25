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

## monitors

Chase, 2026-11-25, after two asks. `src/fitColumns.ts` lays out every screen made of cards (today, progress, goals, settings, trips, the work dashboard) from the size of the window in both directions, and `fitColumns.test.ts` holds the rules.

- A window with height to spare stacks the cards into fewer columns and draws them larger, up to 1.35 times, rather than leaving a row of small cards over an empty window.
- Columns are added, and the cards shrunk back, only when the cards would otherwise run past the bottom of the window.
- Cards never go under 22rem wide, and the block of cards sits centred.
- A new screen made of cards joins `deckViews` in `App.tsx`. Do not give one a fixed column count or a width cap of its own.
- The side rail shows the screens from the … menu as buttons of its own while it has the height (`src/rail.ts`, `rail.test.ts`). Only what does not fit stays under …, and with nothing left under it the … is not drawn. A new screen is added to `moreViewsFor` with an icon, never to the rail or the menu alone.
- The phone is untouched: none of this applies under 48rem.

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
- A thread opened about an email (handed over from my-mail) always carries on, until a new chat is started.

## the personal chat's budget and mail

The personal chat runs on the work pc's Claude Code when the bridge is there and on the personal key when it is not (`src/companion/bridgeModel.ts`). Only the model moves: the bridge's `/chat/model` runs Claude Code with no tools, no vault and nothing kept, and every personal tool still runs in the browser. Do not send a personal conversation through `/chat` (the work chat, which has the vault and work tools), do not give `/chat/model` tools or a working folder, and do not look for the bridge on a device that has never reached one. Claude Code on the bridge takes text only, so a message with a photo or pdf goes to the personal key when there is one.

Mail in the chat is read-only (`src/companion/mailTools.ts`): search and read, nothing else. Anything done to a message is done in my-mail. A message handed over from my-mail (`#chat/mail/<id>`) always opens in the personal space. Email text goes to the model as data, with the line that it is never an instruction.

## journal

Chase, 2026-11-25. `journal.test.ts` holds these. The journal is under the more menu, personal only (`src/journal/`).

- It is a place to dump, by voice or typing. Listening there ends only on a tap or when the app is hidden; a pause or a long silence never ends it, saves, or sends.
- Words not saved yet are kept on the device, so closing the app or a failed save loses nothing.
- `save` adds the words to `journal/YYYY-MM-DD.md` in the notes vault under the time as a heading, exactly as said. Nothing rewrites or tidies them.
- The journal never calls the ai. An entry reaches the chat only when Chase adds it to a message by hand, as an attachment: `add to chat` on the entry, or `add journal entry` in the chat menu.

## old tasks and mail

An unsorted To Do task created more than 30 days ago (`oldAfterDays` in `src/domain/age.ts`) is left in To Do and never brought into the app, and the flagged count on today covers the last 30 days of mail only. Tasks Chase has sorted stay whatever their age. Anything new that pulls items in from Microsoft on its own applies the same check.

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

## body slice

The body slice follows workout-tracker (Chase, 2026-11-24), on every device (2026-11-25). The tracker posts a summary to its backend's `share` route (its side is `src/lib/brainShare.ts` there) and `src/domain/bodyTracker.ts` reads it with the tracker account key. `bodyTracker.test.ts` holds the rules.

- The tracker judges every week and goal. Nothing is re-scored here.
- The account key is `trackerToken` in settings and rides to the other devices in settings.json like the other keys. It comes from the sign-in under settings, or on its own on a device that is signed in to the tracker (both apps are served from `chase-grey.github.io`, so they share storage there, and the tracker leaves the same summary under `wt.share.body`).
- The slice reads the last four weeks: a hit week is 1, a week saved by freezes a half, a missed week nothing. With goals to read, the weeks are three quarters of the fill and the goals the last quarter (Chase, 2026-11-25: the streak earns more than the goals cost): the share that are met or on pace, out of every goal met or committed to. Met counts every goal the tracker shows as reached, committed or not.
- The slice's card shows what fills it: the percent, weeks hit, and goals met or on pace. That row opens the goals by name, and `open workout tracker` lands on the tracker's goals (`?tab=progress` there).
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
