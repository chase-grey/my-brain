import { GraphError, type GraphClient } from './graphClient'

export type CalendarBlock = {
  id: string
  subject: string
  start: string
  end: string
  isAllDay: boolean
  webLink?: string
}

type GraphEvent = {
  id: string
  subject: string
  isAllDay?: boolean
  webLink?: string
  isCancelled?: boolean
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

const select = 'id,subject,start,end,isAllDay,webLink,isCancelled'

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function fromGraph(event: GraphEvent): CalendarBlock {
  return {
    id: event.id,
    subject: event.subject,
    start: event.start.dateTime.slice(0, 19),
    end: event.end.dateTime.slice(0, 19),
    isAllDay: Boolean(event.isAllDay),
    webLink: event.webLink,
  }
}

export class CalendarGraphProvider {
  constructor(private readonly graph: GraphClient, private readonly timeZone = localTimeZone()) {}

  private get headers(): HeadersInit {
    return { Prefer: `outlook.timezone="${this.timeZone}"` }
  }

  /** Events overlapping [start, end), both local date-times such as 2026-11-02T00:00:00. */
  async events(start: string, end: string): Promise<CalendarBlock[]> {
    const query = new URLSearchParams({ startDateTime: start, endDateTime: end, '$select': select, '$orderby': 'start/dateTime', '$top': '50' })
    const events = await this.graph.collection<GraphEvent>(`/me/calendarView?${query}`, { headers: this.headers })
    return events.filter((event) => !event.isCancelled).map(fromGraph)
  }

  async event(id: string): Promise<CalendarBlock | undefined> {
    try {
      const event = await this.graph.request<GraphEvent>(`/me/events/${encodeURIComponent(id)}?$select=${select}`, { headers: this.headers })
      return event.isCancelled ? undefined : fromGraph(event)
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) return undefined
      throw error
    }
  }

  async createReservedBlock(subject: string, start: string, end: string, body?: string): Promise<CalendarBlock> {
    const event = await this.graph.request<GraphEvent>('/me/events', {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        subject,
        showAs: 'busy',
        isReminderOn: false,
        body: body ? { contentType: 'text', content: body } : undefined,
        start: { dateTime: start, timeZone: this.timeZone },
        end: { dateTime: end, timeZone: this.timeZone },
      }),
    })
    return fromGraph(event)
  }

  /** Move an event to another day, keeping the hour that was chosen in the calendar. */
  async moveEventToDay(id: string, date: string): Promise<CalendarBlock | undefined> {
    const current = await this.event(id)
    if (!current) return undefined
    const shift = (value: string) => `${date}${value.slice(10)}`
    const event = await this.graph.request<GraphEvent>(`/me/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: this.headers,
      body: JSON.stringify({
        start: { dateTime: shift(current.start), timeZone: this.timeZone },
        end: { dateTime: shift(current.end), timeZone: this.timeZone },
      }),
    })
    return fromGraph(event)
  }

  async deleteEvent(id: string): Promise<void> {
    try {
      await this.graph.request<void>(`/me/events/${encodeURIComponent(id)}`, { method: 'DELETE' })
    } catch (error) {
      if (error instanceof GraphError && error.status === 404) return
      throw error
    }
  }
}
