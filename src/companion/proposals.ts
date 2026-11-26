// The work chat is Claude Code on the work pc, and the app's tools are not its to call. For the one change it can
// ask the app to make, blocking time in the work calendar, it ends its reply with a line the app reads, and the
// app shows that as the same approval card the personal chat gets. Nothing is written until the card is approved.

export type Proposal = { tool: 'block_time'; input: Record<string, unknown> }

/** What the work chat is told about asking for a block. */
export const blockProposalRule = [
  'To block time in the user\'s work calendar for a task or a project, end your reply with one line for each block, exactly in this form:',
  '<block-time title="what it is for" start="YYYY-MM-DDTHH:MM" minutes="90" />',
  'Use a day and time the user gave or agreed to, on their own clock, and never pick one yourself. The app turns each line into a card they approve, and nothing is in the calendar until they do, so never say that it is. This line is the only way to change the calendar.',
].join('\n')

const tag = /<block-time\b([^>]*?)\/?>(?:\s*<\/block-time>)?/g
const attribute = /([a-z_]+)\s*=\s*"([^"]*)"/g

/** The reply without its proposal lines, and what they asked for. A line with no name, time or length is dropped. */
export function takeProposals(reply: string): { text: string; proposals: Proposal[] } {
  const proposals: Proposal[] = []
  const text = reply.replace(tag, (_line, inside: string) => {
    const found: Record<string, string> = {}
    for (const match of inside.matchAll(attribute)) found[match[1]] = match[2]
    const minutes = Number(found.minutes)
    if (found.title?.trim() && found.start && Number.isFinite(minutes) && minutes > 0) proposals.push({ tool: 'block_time', input: { title: found.title.trim(), start: found.start, minutes } })
    return ''
  })
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), proposals }
}
