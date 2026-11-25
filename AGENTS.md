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

## updates

A new deploy reaches an open tab or installed window on its own (`src/appUpdate.ts`, the pattern in `~/.claude/patterns/app-update.md`; my-mail carries the same file). The app reloads onto it at a quiet moment: off screen, just reopened and not yet touched, or left alone for five minutes. It never reloads over an open sheet, a draft, or a screen that called `holdUpdates`. Until the reload happens, the more menu wears a dot and offers `update ready · restart`, and the settings button says the same. A new screen whose state a reload would lose calls `holdUpdates()`. Do not reload any other way.

## restarting the bridge

`npm run bridge` runs `work/bridge/work-bridge.ps1` (the work side is a separate private repo checked out at `work/`), a PowerShell HttpListener on port 47321. To restart it after an edit, stop only that process, by PID:

```powershell
# HttpListener binds through http.sys, so Get-NetTCPConnection reports PID 4 (System) for the port; find the bridge by its command line instead.
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like '*work-bridge.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','work/bridge/work-bridge.ps1' -PassThru | Select-Object -ExpandProperty Id
```

Never kill powershell.exe by image name (`taskkill /IM`, `Stop-Process -Name`): every Session Runner terminal on this machine is a powershell.exe hosting a Claude session, and one such line killed all of them, twice, on 2026-11-05. A global hook now denies kills by image name; kill by PID.

## chat voice and context

Chase, 2026-11-25. `speech.test.ts`, `stopPhrase.test.ts` and `context.test.ts` hold these.

- A spoken message is never cut off at a breath. The recognizer's stretches are chained (`dictate` in `src/voice/speech.ts`) and the message ends only after two seconds without a new word.
- Spoken words land in the message box as they are heard, and stay there when listening ends for any reason other than sending.
- The mic starts a conversation: a pause sends, the reply is read aloud, and it listens again. It ends on a tap, on the words "stop listening", or when the app is hidden. A typed message with the mic off is never read aloud.
- There is no context switch. Each message either carries on the thread or starts a new one (`src/companion/context.ts`): Jev decides when there is a key, the clock (15 minutes) when there is not, and a thread reopened from the history is always carried on. What is on screen after a send is what the model was given.
- What goes along with a message is capped in code (`contextTurns`), newest first. The model is never asked to manage its own context.
- Work chat is never sent to Jev; its thread goes by the clock.

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

The body slice follows workout-tracker (Chase, 2026-11-24). The tracker leaves a summary under the `wt.share.body` storage key (both apps are served from `chase-grey.github.io`; its side is `src/lib/brainShare.ts` there) and `src/domain/bodyTracker.ts` reads it. `bodyTracker.test.ts` holds the rules.

- The tracker judges every week and goal. Nothing is re-scored here.
- The slice reads the last four weeks: a hit week is 1, a week saved by freezes a half, a missed week nothing. With committed goals open, the weeks are half the fill and the share of goals on pace the other half.
- A week that ended with no word from the tracker counts as missed, and the streak is not shown until the tracker reports again.
- With a summary, body needs no 28-day target and the targets form does not ask for one. Without one, body works like every other area.
- Reviews read the body area from the same summary.
