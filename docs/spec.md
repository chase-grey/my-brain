# My Brain product specification

My Brain provides separate personal and work spaces. Each space owns its tasks, planning, settings, and progress.

## space ownership

Every task, goal, project, activity, commitment, delegation, travel window, and day override belongs to exactly one space. IDs resolve within that space. Suggestions, counts, estimates, receipts, streaks, and calendar capacity use only its records. No items or aggregate progress appear in the other space.

Switching spaces opens its now screen. Task and planning forms cannot carry content into the other space. Available time, energy, location overrides, and navigation belong to the active workspace.

## personal

Personal owns its Microsoft account, Graph task sync, OneDrive metadata, store lists, personal-care habits, Life Ring, people, money, and rest check-ins. Purpose measures personal civic contribution and personal projects. Personal planning uses a weekly ceiling and available time entered at the moment.

Personal reads its calendar for the week and shows today's events. It never computes an available total from the calendar. A block goal with a date can be held in the calendar as a busy afternoon; the app decides the day and the length, the hour is decided in Outlook, and the day read back from the event wins. Deleting the event releases the hold.

A conversation recorded on the phone with Mark Zakharov's on-device Transcribe app and shared to the app is filed as a raw speaker-labeled transcript in `40 Transcripts/`. See [transcripts.md](transcripts.md).

Personal email is handled by a separate app, my-mail, on the same Microsoft registration. My Brain reads only the inbox's unread and flagged counts, shows them on today, and links out. It never opens, moves, flags, or sends mail. Messages become tasks only through Microsoft To Do, where they arrive as new to sort.

## work

Work owns its local tasks, Outlook bridge adapter, workday capacity, maintenance floors, project planning, and receipts. Personal authentication is never initialized by the work workspace. The Outlook adapter is available; live integration into the app remains to be completed.

Work transcripts never pass through the phone app's share path. Transcribe sends the package to work OneDrive and the bridge files the raw transcript into Hivemind under `07 Meetings/Transcripts/`. See [transcripts.md](transcripts.md).

## persistence and providers

Tasks, product state, settings, and outbox databases are namespaced by space. Appearance and floors are configured separately. Provider writes reject records belonging to the other space. Personal metadata sync accepts only personal tasks. Existing local task and product records are read by ownership; original records remain available for recovery.

Location and tools narrow eligibility within the selected space. They never switch spaces or grant access to the other space's records. Travel affecting work and personal requires a separate record in each.

## screens

- today: the active space's commitments, this week's due items, extra-time suggestions, and new tasks to sort; personal care, today's calendar, and the email row in personal. Floor nights and strategic blocks sit behind the card's more menu.
- progress: this week's receipt, each goal's pace or block state, waiting items; Life Ring, connection, money, and rest in personal.
- chat: the companion. Docked beside the content on wide screens.
- goals (behind more): weekly target and ceiling, goals with hours and dates or a scheduled block, hold or release a block in the calendar, projects, Life Ring commitments in personal.
- stores (behind more, personal): pickup lists.
- settings (behind more): the active space's capacity and floors; Microsoft connection, mail app link, and chat keys in personal.

Goals have a shape. A pace goal commits hours by a date and reports on pace, behind, or ahead against elapsed time. A block goal is done in one sitting: it is loud until a date is scheduled, quiet once scheduled, and loud again if the date passes undone.

The full product specification lives in the Obsidian vault at `20 Projects/Personal/My Brain.md`.
