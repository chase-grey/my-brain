import type { GraphClient } from './graphClient'

export type CalendarBlock = {
  id: string
  subject: string
  start: string
  end: string
}

type GraphEvent = {
  id: string
  subject: string
  start: { dateTime: string; timeZone: string }
  end: { dateTime: string; timeZone: string }
}

function fromGraph(event: GraphEvent): CalendarBlock {
  return { id: event.id, subject: event.subject, start: event.start.dateTime, end: event.end.dateTime }
}

export class CalendarGraphProvider {
  constructor(private readonly graph: GraphClient) {}

  async events(start: string, end: string): Promise<CalendarBlock[]> {
    const query = new URLSearchParams({ startDateTime: start, endDateTime: end, '$select': 'id,subject,start,end' })
    return (await this.graph.collection<GraphEvent>(`/me/calendarView?${query}`)).map(fromGraph)
  }

  async createReservedBlock(subject: string, start: string, end: string, timeZone: string): Promise<CalendarBlock> {
    const event = await this.graph.request<GraphEvent>('/me/events', {
      method: 'POST',
      body: JSON.stringify({ subject, showAs: 'busy', start: { dateTime: start, timeZone }, end: { dateTime: end, timeZone } }),
    })
    return fromGraph(event)
  }
}
