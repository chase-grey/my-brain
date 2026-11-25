import type { MailMessage, MailSummary } from '../data/mailGraphProvider'
import type { AnthropicTool } from './anthropicClient'

/**
 * The personal chat reading the personal mailbox. It only reads: finding and opening mail is all there is here,
 * and anything done to a message is done in the mail app.
 */
export interface MailReader {
  search(query: string): Promise<MailSummary[]>
  thread(messageId: string): Promise<MailMessage[]>
}

/** An email the mail app handed over to talk about. It rides with the conversation, text and all, so the thread still makes sense reopened. */
export type AttachedMail = { id: string; subject: string; from: string; text: string }

export const mailTools: AnthropicTool[] = [
  { name: 'search_mail', description: 'Search the user\'s personal email in every folder, newest first. Takes plain words or Outlook search syntax: from:name, to:name, subject:word, hasattachments:true, received>=2026-11-01. Returns each match with its id, date, sender, subject, and first lines.', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'read_mail', description: 'Read one email by id together with the rest of its conversation, oldest first, as plain text.', input_schema: { type: 'object', properties: { id: { type: 'string', description: 'an id from search_mail' } }, required: ['id'] } },
]

export const mailToolNames: readonly string[] = mailTools.map((tool) => tool.name)

export function isMailTool(name: string): boolean {
  return mailToolNames.includes(name)
}

/** Each message is cut here, and a conversation here, so one long thread cannot crowd out the rest of the prompt. */
export const mailMessageLimit = 4000
export const mailThreadLimit = 12000

// Where a reply starts quoting what it answers. The quoted mail is already in the thread as its own message.
const quoteStarts = [/^-{2,}\s*Original Message\s*-{2,}/im, /^_{10,}\s*$/m, /^On .{5,120} wrote:\s*$/m, /^From: .+\r?\nSent: /m]

function withoutQuoted(text: string): string {
  const cut = Math.min(...quoteStarts.map((pattern) => { const at = text.search(pattern); return at > 0 ? at : Infinity }))
  return Number.isFinite(cut) ? text.slice(0, cut).trim() : text
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}\n[cut here: the rest is longer than fits]` : text
}

function when(iso: string): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : 'undated'
}

export function renderThread(messages: MailMessage[], limit = mailThreadLimit): string {
  if (!messages.length) return 'that email is empty'
  // The oldest message keeps what it quotes: there is nothing earlier in the thread for it to repeat.
  const parts = messages.map((message, index) => [
    `From: ${message.from || 'unknown'}`,
    ...(message.to ? [`To: ${message.to}`] : []),
    `Date: ${when(message.received)}`,
    `Subject: ${message.subject}`,
    '',
    clip(index === 0 ? message.text : withoutQuoted(message.text), mailMessageLimit) || '(no text)',
  ].join('\n'))
  // When the whole thread is too long, the newest messages are the ones kept.
  const kept: string[] = []
  let size = 0
  for (const part of parts.reverse()) {
    if (kept.length && size + part.length > limit) break
    kept.unshift(clip(part, limit))
    size += part.length
  }
  const dropped = parts.length - kept.length
  return [...(dropped ? [`[${dropped} earlier ${dropped === 1 ? 'message' : 'messages'} left out]`] : []), ...kept].join('\n\n---\n\n')
}

export function renderHits(hits: MailSummary[]): string {
  if (!hits.length) return 'no email matched'
  return hits.map((hit) => `- ${when(hit.received)} · ${hit.from || 'unknown'} · ${hit.subject}\n  id: ${hit.id}\n  ${hit.preview.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
}

/** What the mail app's hand-off becomes: the opened message's own subject and sender, over the whole conversation. */
export function attachMail(messageId: string, messages: MailMessage[]): AttachedMail {
  const opened = messages.find((message) => message.id === messageId) ?? messages[messages.length - 1]
  return { id: messageId, subject: opened?.subject ?? '(no subject)', from: opened?.from.replace(/\s*<[^>]*>$/, '') ?? '', text: renderThread(messages) }
}

export async function runMailTool(name: string, input: Record<string, unknown>, mail: MailReader): Promise<string> {
  const text = (key: string) => {
    const value = input[key]
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} is required`)
    return value.trim()
  }
  if (name === 'search_mail') return renderHits(await mail.search(text('query')))
  if (name === 'read_mail') return renderThread(await mail.thread(text('id')))
  throw new Error(`unknown tool ${name}`)
}
