# My Brain trips specification

Trips are a personal-space feature: default packing lists by trip type, a copy of them for each trip, and planning a trip with the companion. Everything is markdown in the HomeBase vault, so the app, the companion, and Obsidian on the PC edit the same files.

## decisions log

Decided with Chase on 2026-11-09.

- **Storage is the vault, not the task list.** Packing items are not tasks: they have no due date or estimate and would flood To Do. Markdown checklists are editable in Obsidian and by the companion with no new sync.
- **Defaults stack.** A trip picks several types (beach + flight + international). Its list is `always` plus each type's list, each item once, grouped by section.
- **A trip's list is a copy.** Editing it never changes the defaults.
- **Three files per trip**, so an AI rewrite of the itinerary can never wipe packing check marks.
- **AI packing edits are item-level and run at once with undo**, not behind the replace-note approval card.
- **Quantities**: defaults hold plain items; the companion scales counts when it builds or adjusts a trip list, written `socks ×7`. A trailing count does not make a different item.
- **Navigation**: trips sit behind "…" on personal, with one row on today for an upcoming trip.
- **Web search** for itinerary planning: yes, on the personal Anthropic key.
- **Itinerary by hand**: read-only in trips; editing waits for the notes editor (`docs/notes.md`), which is being built separately. Until then it changes through chat or Obsidian.
- **Never ask to resolve a conflict.** Same rule as notes: both sides are kept.

## the vault

```
30 Trips/
  trip profile.md              default "what makes a good trip"            (phase 2)
  packing/
    always.md                  goes on every trip
    <type>.md                  beach, ski, camping, flight, international …
  <YYYY-MM destination>/
    trip.md                    frontmatter + the brief for this trip
    packing.md                 the checklist
    itinerary.md               day by day                                  (phase 2)
```

`trip.md` frontmatter:

```
---
type: trip
destination: "Tulum"
start: 2027-02-12
end: 2027-02-19
types: [beach, flight]
---
```

A packing list, default or trip, is a checklist under section headings. Check marks mean something only on a trip's list.

```
---
type: packing
---

## clothes
- [x] swimsuit
- [ ] socks ×7

## documents
- [ ] passport
```

Anything else in the file (frontmatter, notes between items, blank lines) is kept as written. Items are matched by text, ignoring case and a trailing count.

## screens

`… → trips` on personal.

- **trips**: upcoming trips soonest first, then past ones, each with dates and "14 of 40 packed". Below, **packing defaults**: `always` and each trip type with its item count, and a line to add a trip type. `+` starts a new trip.
- **new trip**: destination, start, end, trip types (the default lists). Creating writes `trip.md` and the stacked `packing.md`.
- **trip**: dates, nights, types, then the checklist by section: tick, remove, add to a section, add a section. Menu: delete trip.
- **default list**: the same list without check boxes. Menu: delete list. A new type's file is written on its first item.

Phase 2 adds `brief · packing · plan` to the trip page and a `plan with ai` button.

## sync

`src/trips/packingSync.ts`. Every note the screens show is kept in `localStorage`, so trips open offline. An edit is saved there first and pushed 1.5 s after the last change, and on hide or leave: one commit per burst of ticks. A push that fails leaves the edit waiting and the header says `not synced`; it goes out on the next open.

Before pushing, the vault's copy is read. If it changed since this device last saw it (the companion or Obsidian edited it), the two are merged item by item against the last common version:

- an item added on either side stays
- an item removed on either side goes
- a check mark changed on one side wins over the side that left it alone
- the result keeps the vault's layout, with this device's additions placed in their sections

When the notes mirror lands (`docs/notes.md`), `PackingSync` takes it as its `VaultStore` and the `localStorage` copy can go.

## companion

Tools, offered when the vault is reachable (`src/trips/tripTools.ts`):

| tool | weight | does |
|---|---|---|
| `list_trips` | read | trips with dates, types, packing counts, and note paths; default lists with sizes |
| `create_trip` | light | writes `trip.md` and the stacked `packing.md`; reports types that have no default list |
| `edit_packing_list` | light | add, remove, check, uncheck, rename items on a default list or a trip's list; creates a default list that does not exist |

Reading a list is `read_note`. The system prompt describes the folder and tells the model to use these tools rather than `write_note` for packing.

## phases

1. **Packing** (built 2026-11-09): vault layout, default lists, trip creation by stacking, checklist screens, offline sync and merge, companion packing tools.
2. **Planning**: `trip profile.md` and the brief in `trip.md`; `itinerary.md`; trip-scoped chat that loads profile, brief, and itinerary; writes inside a trip folder run at once with undo. Needs a larger `max_tokens` than the chat's 1024 and more than 6 model calls per turn for an itinerary.
3. **Around the trip**: prep to-dos as real tasks with due dates counted back from departure; trip dates held in the calendar; the today row; after the trip, offer hand-added items to the default list and never-packed ones for removal.
4. **Web search** in trip planning chat.

## not in scope

- Booking, prices, or reservations tracking.
- Sharing a list with someone else.
- Work-space trips.
