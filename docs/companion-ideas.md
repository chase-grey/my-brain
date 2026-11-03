# Companion ideas

Parked on 2026-11-02 after comparing the companion with OpenAI dots and Anthropic's
equivalents. Vault memory (a `memory/` folder of one-fact files plus a `MEMORY.md` index,
`99 System/Memory/` in Hivemind) shipped the same day. Everything below is a candidate,
not a plan, roughly in the order it seemed worth doing.

## What the industry converged on

Three systems independently landed on the same memory shape: Claude Code's auto-memory,
OpenClaw's workspace (`SOUL.md`, `USER.md`, daily `memory/YYYY-MM-DD.md`, curated
`MEMORY.md`), and ChatGPT's memory. Durable facts get promoted out of day logs into an
index of small, human-editable files. OpenAI dots is the outlier: its memory is opaque and
can only be wiped by resetting the dot. Keep ours readable in Obsidian.

Skills converged on the Agent Skills open standard (`SKILL.md` with `name` and
`description` frontmatter, body loaded only when a task matches). Adopted by Claude Code,
Codex, ChatGPT, and roughly forty other tools.

## 1. Nightly consolidation

The step OpenAI calls "Dreaming": reread recent daily notes, weekly plans, and chat
transcripts, promote durable facts into memory files, rewrite stale ones, drop duplicates.

- Personal: a Claude Code cloud scheduled task against the `homebase` repo, or a
  scheduled run on the home PC.
- Work: a cron job on the work PC running `claude -p` with the Hivemind vault as cwd,
  beside the existing `/assistant` precompute.
- Needs the chat transcript to land in the vault first. Today it lives only in browser
  local storage.

## 2. Skills on the personal side

The work bridge already passes the `Skill` tool, so the vault skills (plan-today, debrief,
weekly review) apply there. The personal side has none.

- Add `skills/<name>/SKILL.md` to HomeBase using the open standard.
- Put each skill's name and description in the system prompt and add one `load_skill`
  tool that returns the body. Same progressive disclosure the standard describes.
- Worth a skill: weekly plan, end-of-day debrief, shopping list, vitamins and teeth logs,
  seasonal goal review. Not worth one: single questions, task edits.
- Rule of thumb: if the same ten lines of instruction would be pasted twice, it is a skill.

## 3. Talking back

No vendor lets an agent truly initiate on a phone except through push notifications from a
running session. dots cannot contact you first at all. Options, cheapest first:

- Scheduled runs write to a `companion/inbox.md` note; the chat tab shows unread items on
  open. No server needed.
- Web push for the GitHub Pages app. Needs a small server or a push relay.
- A Telegram bot for the personal side, following the Claude Code Channels pattern.
- Work side can only speak while the PC is on, so proactive work notes should land in the
  vault for the next morning's briefing rather than try to reach the phone.

## 4. Per-tool permission policy

dots gives each action one of four behaviors: act, act if pre-approved, ask first, hand off.
Ours is a sentence in the prompt ("ask before overwriting a whole note"). Make it a policy
the user can see in settings:

| tool | default |
|---|---|
| append_note, create_task, complete_task, save_memory | act |
| write_note (replace), update_goal, forget_memory | ask first |
| anything that deletes or sends | hand off |

## 5. Chat transcript in the vault

Conversations currently live in browser local storage per device. Writing them to
`companion/chats/YYYY-MM-DD.md` (personal via GitHub, work via the bridge) gives the
consolidation pass something to read and makes phone and PC share history.

## Use-direct options considered and set aside

- **OpenAI dots**: no API, memory not inspectable, not in the EEA or UK, cannot keep memory
  in the vault. Also out for work data.
- **Claude Cowork plus Dispatch**: phone to desktop works, but the home PC must stay awake
  and memory lives in Anthropic's store, not HomeBase.
- **Claude Code Remote Control** and **Channels**: would put the Hivemind companion on the
  phone, but the transcript leaves the machine. Policy question for Epic; the bridge stays
  the sanctioned path until that is answered.
- **Claude Code cloud scheduled tasks**: fresh container each run, state only through the
  repo. Fits item 1 for the personal vault, not for Hivemind.
- **Anthropic memory tool**: client-side file operations, which is exactly what the GitHub
  Contents API gives us. Our `save_memory` and `forget_memory` tools are the hand-rolled
  version; switching to the official tool is an option if its semantics stay stable.

## Sources

- https://openai.com/index/introducing-dots/
- https://help.openai.com/en/articles/20001530-getting-started-with-your-dot
- https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs
- https://help.openai.com/en/articles/8590148-memory-in-chatgpt
- https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context
- https://support.claude.com/en/articles/13947068-assign-tasks-from-anywhere-in-claude-cowork
- https://code.claude.com/docs/en/remote-control
- https://code.claude.com/docs/en/channels
- https://code.claude.com/docs/en/routines
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- https://capodieci.medium.com/ai-agents-003-openclaw-workspace-files-explained-soul-md-agents-md-heartbeat-md-and-more-5bdfbee4827a
