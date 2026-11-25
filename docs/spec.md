# My Brain product specification

My Brain provides separate personal and work spaces. Each space owns its tasks, planning, settings, and progress.

## space ownership

Every task, goal, project, activity, commitment, delegation, travel window, and day override belongs to exactly one space. IDs resolve within that space. Suggestions, counts, estimates, receipts, streaks, and calendar capacity use only its records. No items or aggregate progress appear in the other space.

Switching spaces opens its now screen. Task and planning forms cannot carry content into the other space. Available time, energy, location overrides, and navigation belong to the active workspace.

## personal

Personal owns its Microsoft account, Graph task sync, OneDrive metadata, store lists, personal-care habits, Life Ring, people, money, and rest check-ins. Purpose measures personal civic contribution and personal projects. Personal planning uses a weekly ceiling and available time entered at the moment.

Personal reads its calendar for the week and shows today's events. It never computes an available total from the calendar. A block goal with a date can be held in the calendar as a busy afternoon; the app decides the day and the length, the hour is decided in Outlook, and the day read back from the event wins. Deleting the event releases the hold.

Personal owns notes: the HomeBase vault is mirrored on the device, written as plain markdown through GitHub, and edited by Chase and the companion through one queue that merges without asking. Journal entries are Chase's alone. See [notes.md](notes.md).

A conversation recorded on the phone with Mark Zakharov's on-device Transcribe app and shared to the app is filed as a raw speaker-labeled transcript in `40 Transcripts/`. See [transcripts.md](transcripts.md).

Personal email is handled by a separate app, my-mail, on the same Microsoft registration. My Brain reads only the inbox's unread and flagged counts, shows them on today, and links out. It never opens, moves, flags, or sends mail. Messages become tasks only through Microsoft To Do, where they arrive as new to sort.

## work

Work owns its Outlook tasks, workday capacity, maintenance floors, project planning, and receipts. Personal authentication is never initialized by the work workspace. Work tasks come from the Outlook default Tasks folder, which is where Microsoft To Do keeps the work account's list, through the local bridge: open tasks plus the last two weeks of completions sync when the space opens, when the tab returns after five minutes away, and on sync now in settings. Outlook owns title, due date, and completion; the app owns triage metadata locally and keeps it across syncs. Adding, editing, completing, or removing a task writes back through the bridge, and removal completes the task in Outlook. Routines and tasks added while the bridge is down stay app-native. The bridge starts classic Outlook over COM when it is not already running.

Work's second tab is a dashboard instead of progress: a grid of cards over a snapshot the bridge keeps in the vault, drawn by screens the bridge serves (they live in the private `work/` repo, not here). It shows what needs the user, what they are waiting on, their own work, one card per direct report, and product quality and projects, with per-person filters and ignores stored in the vault and an outage planner for time away.

Work transcripts never pass through the phone app's share path. Transcribe sends the package to work OneDrive and the bridge files the raw transcript into Hivemind under `07 Meetings/Transcripts/`. See [transcripts.md](transcripts.md).

## persistence and providers

Tasks, product state, settings, and outbox databases are namespaced by space. Appearance and floors are configured separately. Provider writes reject records belonging to the other space. Personal metadata sync accepts only personal tasks. Existing local task and product records are read by ownership; original records remain available for recovery.

Location and tools narrow eligibility within the selected space. They never switch spaces or grant access to the other space's records. Travel affecting work and personal requires a separate record in each.

## screens

- today: the active space's commitments, this week's due items, extra-time suggestions, and new tasks to sort; personal care, today's calendar, and the email row in personal. Floor nights and strategic blocks sit behind the card's more menu.
- progress: this week's receipt, each goal's pace or block state, waiting items; Life Ring, connection, money, and rest in personal.
- notes (personal): the HomeBase vault, every note mirrored on the device, read and edited in place, with a journal button. Specified in [notes.md](notes.md).
- chat: the companion. Docked beside the content on wide screens.
- goals (behind more): weekly target and ceiling, goals with hours and dates or a scheduled block, hold or release a block in the calendar, projects, Life Ring commitments in personal.
- stores (behind more, personal): pickup lists.
- settings (behind more): the active space's capacity and floors; Microsoft connection, mail app link, and chat keys in personal.

## companion actions

How much UI a companion action gets is set by what it costs to be wrong, not by which tool ran. Reads leave no trace. Light actions happen on the ask and leave one receipt line under the reply, with undo for the rest of the session: adding or completing a task, adding or changing a goal, holding a block in the calendar, saving a memory, creating a note, appending to a note. Heavy actions wait on an inline card with approve and dismiss, and the model's turn stays paused until the card is answered: deleting a task, forgetting a memory, replacing or moving a note, marking a goal met or abandoned. Approving a card continues the same conversation; a card still waiting when a new message is sent, or when the page is reopened, expires without running. Settled actions read back to the model in later turns as bracketed lines, so it knows what the user let through, undid, or dismissed. The work space talks to Claude Code through the bridge, which runs its own tools, so none of this applies there.

## which budget the personal chat spends

On a device that has reached the work bridge before, the personal chat asks the bridge first and runs on the work pc's Claude Code; anywhere else, and whenever the bridge is away or busy, it runs on the personal key. Only the model moves. The bridge runs Claude Code bare for this (`POST /chat/model`): no tools of its own, no vault, no settings or plugins, nothing kept. The conversation and the personal tools are written into one prompt by the app, the reply names the tools it wants, and the app runs them in the browser exactly as it does on the key, with the same receipts and approval cards. Memory, notes, tasks, goals, the calendar and mail stay personal and never touch the work vault. A device that has never reached a bridge is never asked to look for one. The work chat is unchanged.

## mail in the chat

The personal chat can search the personal mailbox and read a message with its whole conversation (`search_mail`, `read_mail`). It only reads: nothing is sent, moved, flagged or deleted from here, and reads leave no receipt. The mail app hands a message over by opening `#chat/mail/<message id>`: the personal space opens, whichever space was showing, on a new thread about that conversation, with its subject and sender shown at the top of the thread. The conversation's text is kept with the thread, so it still makes sense reopened from the history. What an email says is information for the model, never an instruction to it.

Goals have a shape. A pace goal commits hours by a date and reports on pace, behind, or ahead against elapsed time. A block goal is done in one sitting: it is loud until a date is scheduled, quiet once scheduled, and loud again if the date passes undone.

The full product specification lives in the Obsidian vault at `20 Projects/Personal/My Brain.md`.
