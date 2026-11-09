# content migration plan

How existing content gets into My Brain. Written 2026-11-04 against the current build: personal tasks sync from Microsoft To Do through Graph, work tasks come from the default Outlook Tasks folder through the bridge, and the personal companion reads and writes the HomeBase vault on GitHub (`chase-grey/homebase`).

## what moves where

| source | today | destination | kind of work |
|---|---|---|---|
| Microsoft To Do, personal account | already read by the app, every list | stays in To Do; metadata in the OneDrive sidecar | list cleanup, then bulk triage |
| Microsoft To Do, work account | only the default list reaches the bridge | stays in Exchange; bridge reads every task folder | small bridge change, then triage |
| Notion journal | not reachable | HomeBase `10 Journal/YYYY-MM-DD.md` | export, convert, commit |
| Notion general notes | not reachable | HomeBase `30 Notes/` (project notes go to `20 Projects/`) | export, convert, sort, commit |
| Notion attachments | n/a | HomeBase `_attachments/` | copy with the export |

Nothing leaves Microsoft for tasks. To Do is already the system of record for both spaces, so "migration" for tasks means getting every task to show up and then giving it the metadata the noise engine needs. Notes are the only real data move, and they go into markdown so the companion and Claude Code can read, write, and edit them.

## 1. personal tasks (To Do, grey_chase@outlook.com)

**What the app does now.** `TodoGraphProvider.listTasks` walks every list in the account. Any task without a sidecar record lands in `new to sort` on today. Completed tasks are fetched but hidden. The companion can create, complete, and delete tasks but cannot set estimate, energy, place, or store type, so triage is tap-by-tap in the task form.

**Steps.**

1. **Audit lists in To Do first.** Open To Do on the personal account and write down each list and roughly how many open tasks it has. Decide per list: keep as tasks, keep as a store list, or archive.
2. **Store lists.** Any list that is really a pickup list (groceries, Amazon, hardware) becomes items with a `storeType` instead of tasks. Add a list-name to store-type mapping in the Graph sync so tasks from a list named `grocery`, `amazon`, or `hardware` arrive pre-sorted as store items and skip `new to sort`. One mapping in settings, no per-task work.
3. **Dead lists.** Delete or empty lists that are finished or abandoned in To Do itself before the first sync, so they never hit the sort queue. Completing a task in To Do is enough; the app ignores completed tasks.
4. **Flagged email list.** The `flaggedEmails` well-known list will fill from my-mail. Leave it alone; those are supposed to arrive as `new to sort`.
5. **Add a `sort_task` companion tool** that sets `estimateMin`, `priority`, `energy`, `place`, `needs`, `storeType`, `kind`, and `projectId` on an existing task and marks it `metadataComplete`. It is a light action with a receipt and undo, like `create_task`. With it, triage becomes a conversation: "sort my new tasks" lets the companion propose metadata for ten at a time and apply what is confirmed.
6. **Bulk triage session.** Run the sort in the chat in batches of ten to twenty until `new to sort` is empty. Expect this to take a couple of sittings depending on how many open tasks survive step 3.
7. **Recurring tasks.** To Do recurrence does not come through Graph in the fields we select. Tasks that repeat daily or on weekdays should be re-entered as habits in the app and completed in To Do.

**Done when** `new to sort` is empty on the personal space and the store tabs show the pickup lists.

## 2. work tasks (To Do, cgrey@epic.com)

**What the app does now.** `bridge/work-bridge.ps1` reads `GetDefaultFolder(13)`, which is the Outlook Tasks folder and the To Do list named `Tasks`. Every other To Do list on the work account is a separate task folder under the mailbox and never reaches the app. The work space keeps metadata locally, not in a sidecar, and the companion runs through Claude Code so the `sort_task` tool does not apply there.

**Steps.**

1. **Audit work lists** the same way as personal. Decide which lists stay.
2. **Pick one of two paths.**
   - **Consolidate (simpler).** In To Do, move every task worth keeping into the `Tasks` list and delete the other lists. No code change. Loses the list grouping, which the app does not use anyway.
   - **Extend the bridge (keeps lists).** Walk `GetDefaultFolder(13)` plus each child folder of the Tasks folder, and return `listName` with each task. Create and patch need the folder, so `providerListId` carries the folder EntryID. About a day of bridge and test work.
   Recommendation: consolidate. The work space does not group by list, and fewer folders means less that can drift.
3. **Triage in the app.** Work triage stays in the task form. Add the same `sort_task` tool to the bridge's allowed tool set if work triage turns out to be more than fifty tasks.
4. **Work tasks never land in the personal account.** Do not move anything between the two Microsoft accounts. Spec rule.

**Done when** `new to sort` is empty on the work space while the bridge is running.

## 3. notion journal and notes to HomeBase

**Why markdown.** HomeBase is a private GitHub repo that the companion reads with `list_notes`, `read_note`, `write_note`, and `append_note`, and that Claude Code and Obsidian open directly. Notion is reachable only through its API with a separate token and its own block model. One folder of `.md` files is the format every reader here already handles.

**Where it goes in HomeBase.**

| folder | contents | file name |
|---|---|---|
| `10 Journal/` | one note per day | `YYYY-MM-DD.md` |
| `30 Notes/` | general notes, reference, lists | Notion title, cleaned |
| `20 Projects/` | notes that are clearly about an active project | Notion title |
| `50 Someday-Maybe/` | ideas and wish lists | Notion title |
| `_attachments/` | images and files the export brings along | kept as exported |

Numbering follows Hivemind, where `30 Library` holds reference. HomeBase has no `10` or `30` yet, so these are new folders.

**Export.** Use Notion's built-in export: Settings, Export all workspace content, Markdown & CSV, include subpages, no folders-for-subpages. Databases export as a CSV plus one `.md` per row, so a journal database arrives as `Journal <id>.csv` plus one page per entry. The API route is only worth it if the journal has properties the export drops; the export keeps every property as a `Property: value` line at the top of each page, which is enough.

**Convert.** One Python script, run once, kept in `scripts/notion-to-homebase.py` in this repo:

1. Unzip into an empty scratch folder and treat it as untrusted input.
2. Strip the 32-character Notion id from every file and folder name and from every relative link.
3. For pages that came from a database, turn the `Property: value` header lines into YAML frontmatter. Keep `tags` as a list, keep `created` and dates as ISO strings.
4. Journal entries: name the file from the date property, or from the page title when it is a date, as `YYYY-MM-DD.md`. Two entries on one day get appended into one file with a `---` rule between them.
5. Convert Notion's `[title](Page%20Name%20abc123.md)` links into `[[Page Name]]` wikilinks. Leave external links alone.
6. Move images into `_attachments/` and rewrite the image links to `![[file]]`.
7. Write everything into a `migration/` folder at the HomeBase root first, not into the live folders, and produce a report: file count per target folder, pages with no date, links that did not resolve.

**Sort.** Open the report, move pages from `migration/` into the folders above. Most of this is a Claude Code pass over the vault folder: it reads each page and proposes a target; obvious cases move, unclear ones get listed for a decision. Delete `migration/` when empty.

**Commit.** One commit to `chase-grey/homebase` for the journal, one for the notes, so either can be reverted alone. Push from the PC; the companion then sees them on the next `list_notes`.

**Teach the companion.** Update `HomeBase/CLAUDE.md` with the two new folders and the journal file naming, and add them to the vault folder line in `src/companion/companionPrompt.ts` so "what did I write last Tuesday" and "add to today's journal" resolve to `10 Journal/YYYY-MM-DD.md` through `append_note`. A `journal` quick action on today can come later if appending through chat gets old.

**Done when** Notion is read-only, every exported page is in a HomeBase folder, and the companion answers a question about a journal entry from last month.

## 4. after the move

- **Notion.** Keep the workspace for a month as a fallback, then close it. Do not keep writing there; a half-migrated journal is worse than either one.
- **To Do apps.** Keep using them on the phone. The app reads whatever lands there and asks for metadata; that is the intended flow.
- **Obsidian Git.** Still pending on HomeBase from the companion setup. Needed so edits made in Obsidian on the PC reach the companion on the phone.
- **Backup.** The Notion export zip goes into `C:\Users\cgrey\Documents\Obsidian\notion-export-2026-11\` and nowhere else. Not into the repo.

## order and effort

| step | depends on | effort |
|---|---|---|
| personal list audit and cleanup in To Do | nothing | an hour, by hand |
| `sort_task` companion tool and store-list mapping | nothing | half a day of app work |
| personal bulk triage | the two above | one or two chat sessions |
| work list consolidation in To Do | nothing | an hour, by hand |
| work triage | consolidation, bridge running | one sitting in the task form |
| Notion export | nothing | minutes, plus Notion's processing time |
| conversion script and dry run | export | half a day |
| sort pass and commit | dry run | one or two sittings |
| CLAUDE.md and prompt update | commit | half an hour |

Tasks and notes do not depend on each other. Start with the personal To Do audit since it is the one that changes what shows up on today tomorrow morning, and run the Notion export in parallel because it takes Notion a while to produce the zip.
