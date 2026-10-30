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
`Tasks.ReadWrite` and `Files.ReadWrite.AppFolder`, copy `.env.example` to `.env.local`,
and set `VITE_MICROSOFT_CLIENT_ID` to the application client ID.

Open settings and choose `connect microsoft`. Existing sessions restore and sync on
startup. The app continues using demo data when the client ID is absent.

## companion

The companion view is a chat that can read and write your Obsidian notes, create tasks,
and change goals. Each space has its own provider.

**personal** calls Anthropic directly from the browser with your own key, and reads the
HomeBase vault from a private GitHub repo, so it works on the phone and at home without VPN.
In settings fill in the anthropic api key, the github repo as `owner/name`, the branch, and a
fine-grained GitHub token with Contents read and write on that one repo. Keys stay in this
browser's local storage and are never synced.

**work** uses Claude Code on the work PC through the bridge, under your Epic login. Nothing
from the Hivemind vault leaves the machine except through that sanctioned session. Run
`npm run bridge`; it serves `/chat` with the vault folder as the working directory, so the
vault's CLAUDE.md and skills apply. Outlook does not need to be running for chat. On the phone
the work companion shows `only on the work pc`.

Bridge options: `-VaultPath`, `-ChatAllowedTools`, `-ChatTimeoutSec`.

## Related

- [`../workout-tracker`](../workout-tracker) — the Body domain's logging surface, and
  deliberately staying that way. See **App Topology** in the spec.
