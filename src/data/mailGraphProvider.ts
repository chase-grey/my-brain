import { oldCutoff } from '../domain/age'
import type { GraphClient } from './graphClient'

/** Read-only glance at the personal inbox. My Brain never opens, moves, or sends mail; the mail app does that. */
export type InboxCounts = {
  /** Conversations in the inbox with something for me to do. */
  needsMe: number
}

/** The categories the mail app writes on a message that asks something of me. Waiting on someone else is not one. */
export const toDoCategories = ['reply', 'action']

/** One message as the chat reads it. `text` is the body as plain text, there only when the message was opened. */
export type MailSummary = { id: string; conversationId?: string; subject: string; from: string; to: string; received: string; preview: string }
export type MailMessage = MailSummary & { text: string }

type GraphAddress = { emailAddress?: { name?: string; address?: string } }
type GraphMail = {
  id: string
  conversationId?: string
  subject?: string
  from?: GraphAddress
  toRecipients?: GraphAddress[]
  receivedDateTime?: string
  bodyPreview?: string
  body?: { content?: string }
  isDraft?: boolean
  parentFolderId?: string
}

const summarySelect = 'id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview'
export const mailSearchCount = 12
export const mailThreadCap = 25
// The mail app names messages by ids that survive a move between folders; the same ids are asked for here so one it hands over still opens.
const mailHeaders = { Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' }

function person(address?: GraphAddress): string {
  const { name, address: email } = address?.emailAddress ?? {}
  return name && email && name !== email ? `${name} <${email}>` : name || email || ''
}

function summary(message: GraphMail): MailSummary {
  return {
    id: message.id,
    conversationId: message.conversationId,
    subject: message.subject?.trim() || '(no subject)',
    from: person(message.from),
    to: (message.toRecipients ?? []).map(person).filter(Boolean).join(', '),
    received: message.receivedDateTime ?? '',
    preview: message.bodyPreview?.trim() ?? '',
  }
}

/** Graph takes the whole search, operators and all, inside one pair of double quotes. */
export function mailSearchParam(query: string): string {
  return `"${query.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export class MailGraphProvider {
  private deletedId?: Promise<string | undefined>

  constructor(private readonly graph: GraphClient) {}

  /** Mail in every folder that matches the words or Outlook search syntax given. Graph orders a search itself: newest first. */
  async search(query: string, count = mailSearchCount): Promise<MailSummary[]> {
    const page = await this.graph.request<{ value: GraphMail[] }>(`/me/messages?${new URLSearchParams({ '$search': mailSearchParam(query), '$top': String(count), '$select': summarySelect })}`, { headers: mailHeaders })
    return page.value.map(summary)
  }

  /** The whole conversation a message belongs to, from every folder, oldest first, with each body as text. */
  async thread(messageId: string, cap = mailThreadCap): Promise<MailMessage[]> {
    const select = `${summarySelect},body,isDraft,parentFolderId`
    const opened = await this.graph.request<GraphMail>(`/me/messages/${encodeURIComponent(messageId)}?${new URLSearchParams({ '$select': select })}`, { headers: mailHeaders })
    let found = [opened]
    if (opened.conversationId) {
      // Graph refuses a sort beside this filter, so the order is put right here.
      const query = new URLSearchParams({ '$filter': `conversationId eq '${opened.conversationId.replace(/'/g, "''")}'`, '$select': select, '$top': String(cap) })
      const page = await this.graph.request<{ value: GraphMail[] }>(`/me/messages?${query}`, { headers: mailHeaders })
      this.deletedId ??= this.graph.request<{ id: string }>('/me/mailFolders/deleteditems?$select=id').then((folder) => folder.id, () => undefined)
      const deleted = await this.deletedId
      const rest = page.value.filter((message) => message.id !== opened.id && !message.isDraft && (!deleted || message.parentFolderId !== deleted))
      found = [opened, ...rest]
    }
    return found
      .sort((a, b) => (a.receivedDateTime ?? '').localeCompare(b.receivedDateTime ?? ''))
      .map((message) => ({ ...summary(message), text: (message.body?.content ?? message.bodyPreview ?? '').trim() }))
  }

  /**
   * Mail with something for me to do: flagged, marked important by the sender, or sorted by the mail app as needing a reply or an action.
   * Recent mail only; a flag left on a message from years ago is not something waiting on me.
   */
  async inboxCounts(now = new Date().toISOString()): Promise<InboxCounts> {
    const recent = `receivedDateTime ge ${oldCutoff(now)}`
    const asks = [
      "flag/flagStatus eq 'flagged'",
      "importance eq 'high'",
      ...toDoCategories.map((category) => `categories/any(c:c eq '${category}')`),
    ]
    // One plain filter a request: Graph turns down an "or" inside the category test, checked against the real inbox.
    const pages = await Promise.all(asks.map((ask) => this.graph.request<{ value: { id: string; conversationId?: string }[] }>(`/me/mailFolders/inbox/messages?${new URLSearchParams({ '$filter': `${ask} and ${recent}`, '$select': 'id,conversationId', '$top': '50' })}`)))
    return { needsMe: new Set(pages.flatMap((page) => page.value.map((message) => message.conversationId ?? message.id))).size }
  }
}
