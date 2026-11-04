# My Brain transcripts specification

Record a conversation on the phone and get a speaker-labeled transcript back as a markdown note,
in HomeBase for personal and in Hivemind for work. The recorder is Mark Zakharov's Transcribe
app ([gitlab.epic.com/mzakhar/Android-transcription](https://gitlab.epic.com/mzakhar/Android-transcription)),
unmodified. My Brain does the filing.

Written 2026-11-04 after reading Mark's repo and interviewing Chase.

## principles

1. **Audio never leaves the phone.** Mark's app runs speech recognition and speaker diarization
   on the device. Only transcript text moves, and for work it moves only to work OneDrive. No
   speech vendor, no new key, no audio upload. This matches Epic's expectations and Mark's design.
2. **Raw transcript, nothing summarized.** The note is `[mm:ss] Speaker: text` under a short
   header. Making notes, minutes, or tasks from it is a later, deliberate act by Chase or the
   companion.
3. **One recorder for both spaces.** Which space a recording belongs to is decided by how it
   leaves the app: `send transcript` goes to work, `share` goes to personal.
4. **My Brain never records.** The Claude API takes text, images, and PDFs but not audio, and a
   web app cannot run Mark's on-device pipeline. A record button in My Brain would have meant a
   cloud speech vendor, which rule 1 forbids.

## decisions log

| decision | choice | rationale |
|---|---|---|
| **Recorder** | **Mark's Transcribe app, release APK from his GitLab package registry.** | Fully on-device, speaker-labeled, already integrated with Epic's Graph tenant. The Galaxy S23 meets its compute floor (arm64, 8 GB, flagship SoC). His support matrix lists recent Galaxy S as likely supported but untested; the one unknown is whether Samsung honors the raw `UNPROCESSED` mic source. If not the app falls back and speaker labels get slightly worse. |
| **Work path** | **`send transcript` in the app writes a package to work OneDrive. The work bridge copies `transcript.md` into Hivemind.** | OneDrive already syncs to `C:\Users\cgrey\OneDrive - Epic` on the work PC, and the bridge already runs there with the vault path. Mark's own receiver (`transcription-processor`) renders Claude minutes, which is more than rule 2 wants. |
| **Personal path** | **`share` the `.md` from the app to the installed My Brain PWA.** The app is an Android share target. | No fork of Mark's app, no GitHub token on a second app, no second Graph account. One tap per recording. |
| **Work filing** | **`07 Meetings/Transcripts/YYYY-MM-DD title.md` in Hivemind** with frontmatter `date`, `type: transcript`, `attendees`, `duration`, `source`. | Hivemind keeps meetings under `07 Meetings/` by type and its meeting notes carry `date`, `type`, `attendees` frontmatter. Attendees come from the calendar event the app linked at record start, when there was one. |
| **Personal filing** | **`40 Transcripts/YYYY-MM-DD title.md` in HomeBase** with frontmatter `date`, `duration`, `speakers`, `source`. *Chosen 2026-11-04.* | A folder of its own, date-prefixed so it sorts. Follows HomeBase's numbered top-level folders. |
| **After filing (personal)** | **Open the note.** Until the notes tab ships, show the filed path with `open`. | Nothing else to do at that moment. |
| **Who writes personal** | **The same GitHub vault store the companion uses**, one commit per transcript. Moves to the notes queue when notes phase 2 lands. | One write path, one merge behavior. |
| **Who writes work** | **`bridge/transcript-inbox.ps1`**, run by the bridge at startup and every two minutes while idle, and callable alone for a scheduled task. A ledger of filed artifact ids lives under `%LOCALAPPDATA%\my-brain\`. | The bridge is the process already on the PC. The ledger keeps the vault free of bookkeeping and makes a re-run idempotent. |
| **Duplicates** | A title already taken that day gets ` 2`, ` 3`. | Same rule as notes. |
| **Which space a share belongs to** | **Always personal.** | Personal owns notes. A work recording goes out through `send transcript`, never through share. |

## what Mark's app produces

**Share sheet** export, markdown:

```
# Title

- Date: Nov 4, 2026, 2:15 PM
- Duration: 41:12
- Speakers: 3

[00:00] Chase: ...
[00:07] Speaker 2: ...
```

The file is named by the recording's UUID. The date is in the phone's locale. A `.txt` export is
the lines only.

**Send transcript** package, under `TranscribeInbox/YYYY/MM/<utc>_<id>_<title>/` on the
signed-in account's OneDrive:

- `manifest.v1.json`: `artifactId`, `recordingId`, `createdAtUtc`, `transcriptType`, file list.
  Present only once the package is complete.
- `transcript.v1.json`: `recording` (`title`, `createdAtUtc`, `durationMs`, optional
  `linkedEvent` with `subject`, `attendees`, `startUtc`), `speakers`, `utterances`.
- `transcript.md`: the same markdown as the share export.

The schemas are owned by `mzakhar/transcription-processor/CONTRACT.md`.

## personal: share target

`public/manifest.webmanifest` declares a `share_target` that accepts `title`, `text`, and files of
type markdown or plain text, posted to `./share-target`. The service worker answers that POST:
it reads the form, stores each shared text in a cache of its own, and redirects to `./#share`.

On load with `#share`, the app:

1. reads and clears the shared texts,
2. parses the header for title, date, duration, and speakers, falling back to the share
   `title`, today, and nothing,
3. builds `40 Transcripts/YYYY-MM-DD title.md` with the frontmatter above, the `# title`, and
   the transcript lines unchanged,
4. writes it to HomeBase through the personal vault store, appending ` 2` while the path exists,
5. shows `filed 40 Transcripts/2026-11-04 title.md` with `open`, or the error and `try again`.

The write needs the personal space's github repo, branch, and token from settings. Without them
the landing says so and keeps the shared text until the next load, so nothing is lost.

## work: bridge import

`bridge/transcript-inbox.ps1` exposes `Import-TranscribePackages`:

- Scans `$env:USERPROFILE\OneDrive - Epic\TranscribeInbox` for `manifest.v1.json`.
- Skips artifact ids already in the ledger.
- Reads `transcript.v1.json` for title, date, duration, and the linked event's attendees, and
  `transcript.md` for the body.
- Writes `07 Meetings/Transcripts/YYYY-MM-DD title.md` in Hivemind: frontmatter, then the
  markdown body with its first heading kept.
- Records the artifact id, path, and time in the ledger.

The bridge dot-sources it, runs it once at startup, and again every two minutes while waiting
for a request. `GET /chat/status` reports the inbox path and the count filed since start.
`POST /transcripts/import` runs it on demand. The script can also run alone:

```
powershell -NoProfile -File bridge/transcript-inbox.ps1 -Once
```

Packages stay in OneDrive untouched; the ledger is the only state.

## setup on the phone

1. Install the latest release APK from the Transcribe project's package registry on
   gitlab.epic.com. The models are bundled, so it is large.
2. Open settings in the app and sign in with the Epic account using the device code it shows.
   That is Mark's tenant registration; no new app registration.
3. Enroll your voice so the app labels you by name.
4. Install My Brain to the home screen from the browser if it is not already, so it appears in
   the share sheet.

Then, per recording: record, label speakers, and either `send transcript` for work or `share`
the markdown to My Brain for personal.

## not in scope

Recording inside My Brain. Summaries, minutes, or tasks from a transcript. Mark's
`transcription-processor`. Personal packages through OneDrive. iPhone.
