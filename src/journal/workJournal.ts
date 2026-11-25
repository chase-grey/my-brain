import { journalDay, journalPath, type JournalStore } from './journal'

/**
 * The work journal, kept in the work vault by the bridge on the work pc. It only lists, reads and adds to the
 * day files there: nothing is sent to an ai or to any outside service.
 */
export class WorkJournal implements JournalStore {
  constructor(private readonly baseUrl = 'http://127.0.0.1:47321', private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  async listNotes() {
    const { days } = await this.request<{ days?: string[] }>('/journal')
    return (days ?? []).map((day) => ({ path: journalPath(day), sha: day }))
  }

  async readNote(path: string) {
    const { content } = await this.request<{ content?: string }>(`/journal/${this.day(path)}`)
    return { content: content ?? '', sha: path }
  }

  async appendNote(path: string, text: string) {
    await this.request(`/journal/${this.day(path)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
    return { sha: path }
  }

  private day(path: string): string {
    const day = journalDay(path)
    if (!day) throw new Error('not a journal entry')
    return day
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, init)
    if (!response.ok) throw new Error(`work bridge returned ${response.status}`)
    return await response.json() as T
  }
}
