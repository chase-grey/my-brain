# My Brain product specification

My Brain provides separate personal and work spaces. Each space owns its tasks, planning, settings, and progress.

## space ownership

Every task, goal, project, activity, commitment, delegation, travel window, and day override belongs to exactly one space. IDs resolve within that space. Suggestions, counts, estimates, receipts, streaks, and calendar capacity use only its records. No items or aggregate progress appear in the other space.

Switching spaces opens its now screen. Task and planning forms cannot carry content into the other space. Available time, energy, location overrides, and navigation belong to the active workspace.

## personal

Personal owns its Microsoft account, Graph task sync, OneDrive metadata, store lists, personal-care habits, Life Ring, people, money, and rest check-ins. Purpose measures personal civic contribution and personal projects. Personal planning uses a weekly ceiling and available time entered at the moment.

## work

Work owns its local tasks, Outlook bridge adapter, workday capacity, maintenance floors, project planning, and receipts. Personal authentication is never initialized by the work workspace. The Outlook adapter is available; live integration into the app remains to be completed.

## persistence and providers

Tasks, product state, settings, and outbox databases are namespaced by space. Appearance and floors are configured separately. Provider writes reject records belonging to the other space. Personal metadata sync accepts only personal tasks. Existing local task and product records are read by ownership; original records remain available for recovery.

Location and tools narrow eligibility within the selected space. They never switch spaces or grant access to the other space's records. Travel affecting work and personal requires a separate record in each.

## screens

- now: the active space's commitments and suggestions; personal care in personal.
- plan: the active space's goals, projects, weekly commitment, and waiting items; stores in personal.
- inbox: tasks from the active space awaiting triage.
- progress: the active space's week receipt; Life Ring, connection, money, and rest in personal.
- settings: the active space's capacity, floors, and appearance; Microsoft connection in personal.

The full product specification lives in the Obsidian vault at `20 Projects/Personal/My Brain.md`.
