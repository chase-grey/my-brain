# work dashboard

The work space's review surface. It answers two questions at two altitudes: what needs my
attention or is being neglected (big picture), and what is on my plate or waiting on someone
else (detail). It is read-only toward Epic systems. It is built for a big monitor at the start
of a day or week and stacks into one column on the phone.

## data

`bridge/work-dashboard.ps1` queries the EpicDW `vibes` schema on `thor-sql.epic.com` as the
signed-in Windows user and writes one snapshot to `<vault>/99 System/work-snapshot.json`. The
bridge rebuilds it when it is older than an hour while idle, and on `POST /work/refresh`. A
build takes one to two minutes and runs its queries one at a time; Thor is a shared replica, so
nothing retries on timeout. Track-based views refresh nightly at 10pm Central with DLG and QAN
passes at noon and 4pm, so the dashboard is a morning picture, not a live feed. Anything you are
about to act on gets checked in Track.

The snapshot is scoped to the person: their row in `vibes.Employee` (by Windows login, or the
`me` override in config), their direct reports from `TeamLeadRecursiveEmployees`, and the
products named in config. It carries design reviews, designs, DLGs, PRJs, QANs, a QAN summary
by priority per product, support logs, out-of-office entries for the next 60 days, and time-log
activity for the last 14 days from `GetTLGData`. Record ids are strings because FS DLGs look like
`Y206683`.

## config

`<vault>/99 System/work-dashboard.json` is the person's dashboard. The app edits it through the
bridge and Claude Code can edit it directly; this is how someone else at Epic makes the dashboard
theirs without touching code.

```json
{
  "me": null,
  "products": ["SmartTools"],
  "filters": { "teamActivityDays": 14, "teamBatonDays": 21, "pqaNearDays": 7, "designOptionalStaleDays": 21, "designOverdueGraceDays": 14, "reviewHorizonDays": 21, "optionalReviews": false, "qanPriorityIds": [1, 2, 4], "qanStaleWorkdays": 30 },
  "ignores": [{ "kind": "dlg", "id": "2042115", "note": "old prototype", "addedOn": "2026-11-05", "until": "2026-12-05" }],
  "outage": { "start": "2026-11-09", "end": "2026-11-12" }
}
```

Ignores take a kind (`dlg`, `design`, `prj`, `qan`, `slg`, `person`), an id, an optional note,
and an optional `until` date after which the item comes back. Ignored items are never deleted
from the data; they move to the panel's hidden list with the note as the reason, and "stop
ignoring" on the row removes the entry.

## rules

Shaping happens in `src/work/workDashboard.ts` so it is testable and the bridge stays thin. Every
panel is `{ items, hidden }`; hidden rows keep a one-phrase reason and can be shown from the
panel head. The point of the rules is to drop things that look urgent in Track but need nothing
from this person.

- **needs me**: design reviews where I am a required reviewer and the author is still active
  (updated within `designOptionalStaleDays`, or not past `designOverdueGraceDays`), due within
  `reviewHorizonDays`. Optional reviews are hidden unless `optionalReviews` is on. DLGs whose
  baton is with me. DLGs where I am PQA only when the baton is close: dev comp due within
  `pqaNearDays`, the developer logged 8+ hours on it recently, or I am PQA 2 and it is in QA 1.
  Other PQA assignments hide as "pqa later". Fix QANs assigned to me, high-priority open comments
  on my DLGs, support logs with my baton.
- **waiting on others**: my DLGs whose baton is with someone else, PQA I own that bounced back to
  the developer, my designs with reviewers pending.
- **my work**: my DLGs, projects I own or lead through the PRJ point people, designs I lead.
  Idle DLGs (no hours, no baton movement, no moving project) hide as "idle Nd".
- **team**, one card per direct report: DLGs that are live, meaning in a review stage, hours
  logged within `teamActivityDays`, baton moved within `teamBatonDays`, started recently, or
  attached to a PRJ that is active and not paused or unstarted. Everything else hides as idle so
  years-old prototypes do not read as neglect. Their projects, designs in flight (including
  required reviews they owe), fix QANs at the configured priorities, hours logged, and the next
  day out.
- **product quality**, per product: open counts by priority with escalated and over-30-workday
  counts, then the QANs that deserve a look: blocks-testing and critical, escalated, or important
  and older than `qanStaleWorkdays`. Deferred-to-future and request-to-close QANs hide.
- **product projects**: backlog PRJs that are moving, off track first (behind, in jeopardy,
  bumped, or with an overdue status update).

Loud rows get a dot: overdue required decisions, batons sitting 5+ days, critical or escalated
QANs, off-track projects.

## outage planning

Set a window from the dashboard menu, or run `/outage-plan <first day> <last day>` in the work
chat. `src/work/outagePlan.ts` turns the snapshot into sections that need a backup: decisions
due, batons I hold, PQA likely to reach me, my deadlines in the window, fixes assigned to me,
projects I own with a milestone or overdue status, designs I lead in review, support logs on me.
It also lists who on the team is out at the same time and who is available. The dashboard shows
the card with a copy-as-markdown button. `node scripts/outage-plan.ts <start> <end>` prints the
same markdown; the skill fills in a backup per line, writes `10 Planning/Outage Plan <start>.md`,
and sets the window in config.

## bridge routes

| route | does |
|---|---|
| `GET /work/snapshot` | cached snapshot, stale copy allowed, builds when none exists |
| `POST /work/refresh` | rebuild now |
| `GET /work/config`, `PUT /work/config` | read, or merge changes into, the dashboard config |
| `POST /work/ignores` | add or replace an ignore `{kind, id, note?, until?}` |
| `DELETE /work/ignores/{kind}/{id}` | remove one |

The work chat may run `node` and call the bridge with `curl` so the outage skill works headless.

## not yet

Phone access when away from the desktop (the bridge is localhost only, as for work tasks).
Per-panel layout choices and custom SQL panels for other people; the config schema is where
those would land. Outlook meetings in the outage window.
