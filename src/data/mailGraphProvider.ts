import type { GraphClient } from './graphClient'

/** Read-only glance at the personal inbox. My Brain never opens, moves, or sends mail; the mail app does that. */
export type InboxCounts = {
  unread: number
  total: number
  flagged: number
}

type InboxFolder = { unreadItemCount: number; totalItemCount: number }

export class MailGraphProvider {
  constructor(private readonly graph: GraphClient) {}

  async inboxCounts(): Promise<InboxCounts> {
    const [folder, flagged] = await Promise.all([
      this.graph.request<InboxFolder>('/me/mailFolders/inbox?$select=unreadItemCount,totalItemCount'),
      this.graph.request<{ value: { id: string }[] }>(`/me/mailFolders/inbox/messages?${new URLSearchParams({ '$filter': "flag/flagStatus eq 'flagged'", '$select': 'id', '$top': '50' })}`),
    ])
    return { unread: folder.unreadItemCount, total: folder.totalItemCount, flagged: flagged.value.length }
  }
}
