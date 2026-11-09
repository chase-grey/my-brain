# My Brain notes specification

Notes is the personal space's notebook. It reads and writes the HomeBase Obsidian vault, the
same private GitHub repo the companion already uses, so the AI and I edit the same files. It
replaces Notion. Obsidian on the PC stays the heavy editor and pushes to the same repo; on the
phone, this is the editor.

Written 2026-11-04 after deciding between an in-app editor and Obsidian mobile. The Notion
migration is a separate effort and is covered here only by the assumptions it must meet.

## principles

1. **The vault is the truth.** A note is a markdown file in the HomeBase repo on `main`. Nothing
   lives only in the app except changes waiting to sync and caches. Obsidian, the companion, and
   the app see the same bytes. If the app disappeared the vault would be whole.
2. **Markdown underneath, never on screen.** Writing feels like Notion: bold is bold, a list is a
   list. The file stays plain markdown Obsidian opens without a plugin.
3. **Never ask me to resolve anything.** Nothing I wrote is lost and nothing the AI or the PC wrote
   is lost. When two edits overlap, both are kept, in order, and the note moves on. No conflict
   dialog, no markers to clean up, no copy to merge by hand.
4. **Works on a plane.** Every note is on the phone. Reading, writing, searching, and journaling
   work with no connection, and sync when one returns.
5. **Leave what you did not touch alone.** Saving a note changes only the blocks I edited. The
   companion's wording, Obsidian's frontmatter, wikilinks, and formatting elsewhere in the file
   survive byte for byte.
6. **Journaling is a button, not a routine.** One tap starts writing. No streaks, no prompts, no
   count. Journal entries are mine: the companion reads them when asked and never writes them.
7. **Personal only.** HomeBase only. Hivemind stays in Obsidian on the work PC; the work space has
   no notes tab.

## decisions log

| decision | choice | rationale |
|---|---|---|
| **Surface** | **Notes inside My Brain. Obsidian on the PC only.** *Resolved 2026-11-04.* | The companion writes to the repo on every tool call; the in-app path is the only one where I and the AI always read the same bytes with no sync daemon between. Obsidian mobile on Android needs the Obsidian Git plugin (slow, token-only, conflicts resolved in raw markdown on a phone) or GitSync (a background service that can silently stop pushing, so the AI reads stale notes). Running both doubles the conflict surface. The cost of building is the editor, offline sync, and merge, which are specified below. |
| **Editor** | **TipTap 3 (ProseMirror) with its markdown extension, always editable.** | Notion-like typing on Android with a mature React binding and extensions for task lists, links, and tables. A CodeMirror live preview still shows syntax on the active line, which rule 2 forbids. Milkdown would also work; the fidelity problem is solved by block patching (below), not by the editor, so the larger ecosystem wins. Lexical has a history of Android IME trouble. |
| **Fidelity** | **Block patching on save.** Only edited blocks are re-serialized; every other block keeps its original source bytes. | No markdown editor round-trips arbitrary markdown byte for byte. Patching at the block level sidesteps the problem: the editor's normalization touches only what I changed. A corpus test over every vault note enforces it. |
| **Storage on the device** | **A full mirror of the vault in IndexedDB.** Every markdown file, with its blob sha. | Rules 3 and 4 need every note local and need the content each edit started from. A prose vault of hundreds of notes is a few megabytes. The mirror also makes search and the companion's reads instant. |
| **Transport** | **GitHub Contents and Git Data APIs with the existing fine-grained token.** Change detection by branch head sha, conditional requests with ETags. | Already in use by the companion. A 304 on the branch check costs nothing against the rate limit, so polling is cheap. Cloning the repo in the browser (isomorphic-git) would need a CORS proxy for GitHub, which is a server. |
| **Save** | **A save is a commit.** Local write on every keystroke; push after three seconds idle, on leaving the note, on hiding the app, or on `done`. One commit per changed note. | Commits are the vault's history and what Obsidian pulls. Idle batching keeps a journaling session to a handful of commits rather than one per word. |
| **Merge** | **Three-way, line based (diff3). Non-overlapping changes merge silently. Overlapping changes keep both, mine first, then the other side's, as ordinary paragraphs. No markers.** The note shows `merged` in the list until opened and the merge is listed in settings. *Resolved 2026-11-04: keep both, never require resolution.* | The common conflict is both sides appending to the same note, where keeping both in order is exactly the right answer. Duplicate paragraphs in prose are obvious on reading. Markers would need cleaning up, which rule 3 forbids. |
| **Journal** | **`journal/YYYY-MM-DD.md`, one file per day I journal.** The `journal` button opens today's file, creating it when missing; later taps the same day place the cursor at the end under a time heading. | Ad hoc, not daily. One file per day keeps entries findable without a naming decision at the moment of writing. |
| **Navigation** | **Fourth tab: today · progress · notes · chat.** In the work space the bar has three tabs. | Journaling and reading will be daily. The `…` menu is for things done every few months. |
| **Search** | **Client-side over the mirror: title matches, then body matches with a snippet.** | The whole vault is local. GitHub code search does not index private repos reliably for fine-grained tokens and is rate limited to ten calls a minute. |
| **Images** | **Existing images in the repo render when online. No camera or upload yet.** | Markdown prose first. Binary sync and size limits come with a later phase. |
| **Tables** | **Rendered, not editable, in the editor for now.** | Table editing on a phone is poor in every editor. Tables are rare in prose and edited on the PC. |
| **Frontmatter** | **Hidden in the editor, preserved verbatim.** | Obsidian properties are the PC's business. The app never changes them and never shows them. |
| **Companion** | **The companion's vault store becomes the mirror.** Reads come from the mirror; writes go through the same queue and merge. | One code path for every write means one merge behavior. The companion's reads stop costing API calls. |
| **Notion migration** | **Out of scope.** Notes assumes markdown files in UTF-8 on `main`, links as wikilinks or relative `.md` links, images in the repo. | A separate agent owns the export. This spec names what it must produce. |

## the vault

HomeBase today: `00 Daily Plan/`, `00 Weekly Plans/`, `20 Projects/`, `50 Someday-Maybe/`,
`70 Goals/`, `lessons/`, `memory/`, and `CLAUDE.md`. Notes adds two folders:

- `journal/` for journal entries, one file per day.
- `notes/` for new notes created from the top level of the notes tab. Notes created inside a
  folder land in that folder.

A note's title is its file name without `.md`, as in Obsidian. The app never requires a heading.
Links are `[[Note]]`, `[[Note|shown text]]`, or a relative markdown link to a `.md` file; both open
in the app. Folders starting with a dot are hidden. Everything else, including `memory/` and
`lessons/`, is listed.

The migration should put Notion pages in the folders above or new top-level folders, convert
Notion's relative links to wikilinks, and place images beside the note or under `attachments/`.
HomeBase's `CLAUDE.md` gets the two new folders and the rule that the companion does not write in
`journal/` unless asked.

## screens

### notes

The tab opens on a list.

- Top: a search field, `journal`, and `new note`.
- `recent`: notes this device has seen change, newest first, up to ten. Own saves, the
  companion's writes, and changes pulled from GitHub all count. Each row shows title, folder,
  and when.
- Folders: the top-level folders with a count each. Inside a folder, subfolders first, then notes
  by name.
- A row carries `merged` after a merge until the note is opened, and `saved here` while a change
  waits to push.
- While offline the list header reads `offline · 3 waiting`. While syncing it shows a small
  indicator and nothing else. If GitHub rejects the token it says so here and stops pushing;
  nothing is dropped.

Search runs as I type across every folder: title matches first, then body matches with one
snippet showing the hit. Tapping a result opens the note.

### note

A note is one screen: a title field, then the body, always editable.

- The title is the file name. Changing it renames the file; the change is queued like any other
  write. An empty title is not allowed. A title already taken in that folder gets ` 2` appended.
- The body is the editor. Opening a note starts at the top; opening the journal starts at the
  end. Tapping places the cursor; scrolling does not.
- A toolbar sits above the keyboard while editing, lifted by the `--keyboard` inset the chat
  composer already uses: bold, italic, strikethrough, heading (cycles heading 1, 2, 3, body),
  bullets, numbers, checklist, quote, link, code, undo, redo, `done`. `done` closes the keyboard
  and pushes the save.
- Typed shortcuts convert in place as in Notion and Obsidian: `# ` starts a heading, `- ` a
  bullet, `1. ` a numbered list, `[] ` a checkbox, `> ` a quote, `**text**` bold, `*text*`
  italic, `` `text` `` code, `---` a divider.
- Checkboxes toggle on tap in any list and save.
- Wikilinks and relative `.md` links look like links and open the note on tap. Typing `[[`
  offers matching note titles from the vault. A link to a note that does not exist creates it in
  the current note's folder on tap. Other links open in a new tab.
- `linked from` at the bottom lists notes that link here.
- Frontmatter is not shown. Tables render and do not respond to taps. Code blocks edit as plain
  text. Images load when online and show an empty box when not.
- The `…` menu offers `move` (pick a folder) and `delete` (confirm). Delete is queued like a write.
- A quiet status word sits under the title: `saved`, `saved here` when waiting to push, `merged`
  after a merge with the other side's text now in the note.

### settings → notes

Uses the existing github repo, branch, and token fields; nothing new to fill in.

- `412 notes · synced 2 min ago`, `sync now`, `download again` (clears the mirror and clones).
- The count of changes waiting, if any.
- The last twenty sync events: merges with the note and time, pushes refused and why.

### chat

The companion's `list_notes`, `read_note`, `write_note`, `append_note`, and `move_note` run
against the mirror. A read is instant and current as of the last refresh; a write is queued,
pushed, and merged exactly as my own. Receipt lines for a created or appended note carry
`open`, which lands on the note. The system prompt names `journal/` and the rule that it is read
on request and never written unprompted.

## sync

### the mirror

IndexedDB, in the personal database beside the existing outbox:

- `notes`: path, blob sha, content, synced at, `dirty`, and while dirty a `base` of the sha and
  content the edit started from, plus `merged at` when a merge produced the current content.
- `noteOps`: queued operations, `write`, `delete`, or `move`, with path, target, created at, and
  attempts.
- `vaultMeta`: head commit sha, tree sha, branch ETag, cloned at, synced at.

**Clone.** On first use with a configured vault, or after `download again`: read the branch head,
read the tree recursively, fetch every `.md` blob, and store them. A progress line shows
`212 of 412`. Hundreds of notes take under a minute and a few hundred requests out of the
token's five thousand an hour.

**Refresh.** On opening the notes tab, when the app becomes visible, when the browser goes back
online, every five minutes while notes is on screen, and after each companion tool run. A
conditional request for the branch head answers 304 when nothing changed and costs no quota.
When the head moved: fetch the tree, compare blob shas with the mirror, fetch only the changed
blobs, drop notes deleted remotely. A remote change to a note that is dirty here is not applied;
it is merged when the local change pushes. A remote delete of a dirty note keeps my version and
recreates the file.

### saving

Every edit writes to the mirror, debounced a few hundred milliseconds, and marks the note dirty
with its base captured on the first dirty edit. A push runs after three seconds idle, on leaving
the note, on `done`, when the app is hidden, and when the browser comes back online. The push
sends the content with the base sha, one commit per note, message `my brain: update <path>` as
today. Success stores the new sha and clears dirty and base.

Failures:

- No network or a 5xx: keep the note dirty, retry on the next trigger with backoff.
- 401 or 403: stop pushing, show `github rejected the token` in the list header and in settings,
  keep everything local until the token is fixed.
- 409 or 422: the file changed under us. Merge.

### merge

Fetch the remote content and run a three-way line merge of base, mine, and theirs.

- Hunks changed on one side only are taken.
- Hunks changed on both sides keep both: my lines, then theirs, separated by a blank line, with no
  marker. Both sides appending to the end of a note is this case and yields both additions in
  order.
- Theirs deleted the file: my version stands and the file is recreated.
- My queued delete meets a remote change: the delete is dropped and the remote version kept.

The merged content is written with the remote sha, stored in the mirror with `merged at`, and
logged in settings. If the write is refused again because the file moved once more, the merge
repeats against the newer content. Nothing is ever shown for me to decide.

Every browser is its own mirror. The phone and a PC browser can both be dirty on the same note;
GitHub arbitrates and each merges on push.

### moves and deletes

A rename or move queues one operation that creates the target with my content and deletes the
source with its last known sha. If the target exists remotely the new file gets ` 2`. Wikilinks in
other notes are not rewritten; Obsidian on the PC does that if wanted.

### limits

The Contents API returns no content for files over one megabyte; such files are read through the
blobs API. Prose never reaches this. A vault of a few thousand notes still clones in a few
minutes within the hourly quota; larger than that, cloning would move to a zip of the branch.

## editor fidelity

**Load.** Frontmatter is split off and held. The body is parsed by a markdown parser that reports
source positions (remark with GFM, frontmatter, and wikilink extensions) into blocks, and the
same markdown is loaded into the editor. Wikilinks are a node of their own so the editor neither
escapes nor rewrites them. Blocks the editor cannot represent (raw HTML, math, anything unknown)
become a raw block that shows the source as plain text and serializes verbatim. Inline syntax the
editor does not model, such as `==highlight==`, stays as the characters typed and is never
escaped.

**Save.** The editor serializes to markdown. The result is parsed into blocks and matched against
the original blocks. A block whose serialized form is unchanged keeps its original source bytes;
a changed, added, or removed block uses the new serialization. Frontmatter is prepended as held.
Line endings and the trailing newline follow the original file.

**Test gate.** A corpus of every note in HomeBase, plus the Notion export once it exists, is
loaded and saved with no edit and must come back identical. A second set of scripted edits
(bold one word, add a paragraph, check a box, rename a heading) must change only the edited
block. The gate runs in the normal test suite with the corpus checked into the test fixtures.

## phases

1. **Read.** Mirror, clone, refresh, notes tab with folders and search, a rendered note that
   opens links, the companion on the mirror, settings status. Migrated Notion content is
   readable on the phone with nothing else built.
2. **Write.** The editor and toolbar, title rename, new note, journal, save, push, offline queue,
   merge, `linked from`, sync log.
3. **Later.** Photos from the phone into `attachments/`. Table editing. Properties. Rewriting
   wikilinks on rename. A single commit for a batch of changed notes through the Git Data API.

## not in scope

The work space and Hivemind. Obsidian mobile, plugins, graph view, templates. Sharing or
publishing a note. Any note format other than markdown.
