import { GraphClient } from './graphClient'
import { OneDriveSidecar } from './oneDriveSidecar'
import { PersonalMicrosoftAuth } from './personalMicrosoftAuth'
import { TodoGraphProvider } from './todoGraphProvider'
import { CalendarGraphProvider } from './calendarGraphProvider'
import { RemoteEventLog } from './remoteEventLog'

export type PersonalGraphData = {
  auth: PersonalMicrosoftAuth
  tasks: TodoGraphProvider
  sidecar: OneDriveSidecar
  calendar: CalendarGraphProvider
  events: RemoteEventLog
}

export async function createPersonalGraphData(clientId: string): Promise<PersonalGraphData> {
  const auth = await PersonalMicrosoftAuth.create(clientId)
  const graph = new GraphClient(() => auth.accessToken())
  const sidecar = new OneDriveSidecar(graph)
  return {
    auth,
    tasks: new TodoGraphProvider(graph),
    sidecar,
    calendar: new CalendarGraphProvider(graph),
    events: new RemoteEventLog(sidecar),
  }
}

export function configuredPersonalClientId(): string | undefined {
  const value = import.meta.env.VITE_MICROSOFT_CLIENT_ID?.trim()
  return value || undefined
}
