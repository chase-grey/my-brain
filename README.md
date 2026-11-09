# My Brain

A system for being intentional about every part of my life — not just the task list.
Two questions: *what should I do right now, and why does it matter?* (the day) and
*which part of my life am I neglecting?* (the season).

**Status:** implementation started. The first test-first vertical slice joins provider tasks
with sidecar metadata, applies the Noise Engine, and builds the personal `I have…` plan.
Personal Graph sync is wired through settings; Outlook remains behind its adapter boundary.
Personal Now also owns the app-native vitamins and teeth-whitening logs.

**Space ownership and app scope:** [product specification](docs/spec.md)

Work and personal have independent tasks, planning, settings, storage, and progress.
The Life Ring and personal Microsoft connection belong to Personal.

**Full product spec:** Obsidian vault → `Hivemind/20 Projects/Personal/My Brain.md`

Named *Cadence* until 2026-08-26. Cadence survives as the name of the engine inside
it — the noise rules, weekly contracts, and streaks.

## personal microsoft setup

Register a Microsoft Entra single-page application that accepts personal Microsoft
accounts. Add the local and GitHub Pages URLs as SPA redirect URIs, grant delegated
`Tasks.ReadWrite`, `Files.ReadWrite.AppFolder`, `Calendars.ReadWrite`, and `Mail.Read`,
copy `.env.example` to `.env.local`, and set `VITE_MICROSOFT_CLIENT_ID` to the application
client ID.

Open settings and choose `connect microsoft`. Existing sessions restore and sync on
startup. The app continues using demo data when the client ID is absent. Adding a scope
makes the silent sign-in fail once with `reconnect microsoft to allow calendar and mail`;
choose `connect microsoft` again to grant it.

## calendar

The personal space reads the next seven days of the personal calendar on every sync.
Today shows the day's events with their times. The chat can list the week.

A block goal (done in one sitting) can be **held in the calendar** from the goals menu once it
has a date: My Brain writes a busy afternoon on that day, from 1pm for four hours, and keeps
the event id. Move the hour in Outlook; the day comes back to the app on the next sync, and
deleting the event releases the hold. Changing the date in the app moves the event, and
marking the goal done or dropping it deletes it. The chat does the same with `hold_in_calendar`.

## email

My Brain does not read, open, move, or send mail. It shows one `email` row on today with the
unread and flagged counts, and that row opens the separate mail app
([`../my-mail`](../my-mail)), which triages the inbox and turns messages into Microsoft To Do
tasks that land here as `new to sort`. The link is the `mail app` field in settings.

## chat

The chat view is built on assistant-ui and can read and write your Obsidian notes, create tasks,
and change goals. Each space has its own provider. On screens wider than about 1400px it docks
beside the content.

**personal** calls Anthropic directly from the browser with your own key, and reads the
HomeBase vault from a private GitHub repo, so it works on the phone and at home without VPN.
In settings fill in the anthropic api key, the github repo as `owner/name`, the branch, and a
fine-grained GitHub token with Contents read and write on that one repo. Keys stay in this
browser's local storage and are never synced.

**work** uses Claude Code on the work PC through the bridge, under your Epic login. Nothing
from the Hivemind vault leaves the machine except through that sanctioned session. Run
`npm run bridge`; it serves `/chat` with the vault folder as the working directory, so the
vault's CLAUDE.md and skills apply. Outlook does not need to be running for chat. On the phone
the work chat shows `only on the work pc`.

Bridge options: `-VaultPath`, `-ChatAllowedTools`, `-ChatTimeoutSec`.

Under the thread, two pickers choose the model (sonnet, opus, haiku) and the effort level (low to
max) for the next message; personal sends them to the api, work passes them to `claude -p` as
`--model` and `--effort`. The choice is remembered per space. The clock button lists past
conversations for the space, newest first, with a delete button on each and `delete all` at the
bottom; tapping one reopens it with keep context on so the next message continues it. The plus
button starts a new conversation. Every conversation is kept in this browser's local storage, up to
50 per space and 40 messages each.

**transcripts.** Record a conversation with Mark Zakharov's on-device Transcribe app. For work,
`send transcript` puts the package on work OneDrive and the bridge files it into
`07 Meetings/Transcripts/` in Hivemind (also `-TranscriptInboxPath`, `-TranscriptIntervalSec`, or
run `bridge/transcript-inbox.ps1 -Once` alone). For personal, share the markdown to the installed
app and it lands in `40 Transcripts/` in HomeBase. Details in [docs/transcripts.md](docs/transcripts.md).

**work dashboard.** The work space's second tab. The bridge reads the EpicDW `vibes` schema as
you (Epic network, no setup beyond `npm run bridge`), keeps a snapshot in `99 System/` of
Hivemind, and the app lays it out as cards: needs me, waiting on others, my work, one card per
direct report, product quality and projects. Rows open in Track; the row menu ignores an item for
good or for a while, and the panel head shows what the filters hid and why. Filters, ignores, and
products live in `99 System/work-dashboard.json`, so another person's Claude Code can shape their
own. `plan an outage` in the menu, or `/outage-plan` in the work chat, lists what needs a backup
while you are out. Details in [docs/work-dashboard.md](docs/work-dashboard.md).

**memory.** Each vault keeps what the companion remembers as one fact per file plus a
`MEMORY.md` index: `memory/` in HomeBase, `99 System/Memory/` in Hivemind. The index goes
into every system prompt; the personal companion saves and forgets through tools, the work
companion edits the files directly. Edit or delete memories in Obsidian whenever you like.

Ideas that were researched but not built yet are in [docs/companion-ideas.md](docs/companion-ideas.md).

Moving existing tasks and Notion notes into the app is planned in [docs/migration-plan.md](docs/migration-plan.md).

## Related

- [`../workout-tracker`](../workout-tracker) — the Body domain's logging surface, and
  deliberately staying that way. See **App Topology** in the spec.
- [`../my-mail`](../my-mail) — personal inbox triage and automation. Same Microsoft app
  registration, same one-way pattern: it creates To Do tasks, My Brain reads them.
