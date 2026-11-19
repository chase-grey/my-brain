import { GraphClient } from './graphClient'
import { OneDriveVault } from './oneDriveVault'
import { OneDriveSidecar } from './oneDriveSidecar'
import { PersonalMicrosoftAuth } from './personalMicrosoftAuth'
import { TodoGraphProvider } from './todoGraphProvider'
import { CalendarGraphProvider } from './calendarGraphProvider'
import { MailGraphProvider } from './mailGraphProvider'
import { RemoteEventLog } from './remoteEventLog'

export type PersonalGraphData = {
  auth: PersonalMicrosoftAuth
  tasks: TodoGraphProvider
  sidecar: OneDriveSidecar
  calendar: CalendarGraphProvider
  mail: MailGraphProvider
  events: RemoteEventLog
  /** Notes in the app folder, for an account without a github vault. */
  notes: OneDriveVault
}

// One MSAL client per page: the welcome screen and the app share it, and a redirect sign-in is handled once.
const created = new Map<string, Promise<PersonalGraphData>>()

export function createPersonalGraphData(clientId: string): Promise<PersonalGraphData> {
  let data = created.get(clientId)
  if (!data) {
    data = buildPersonalGraphData(clientId)
    data.catch(() => created.delete(clientId))
    created.set(clientId, data)
  }
  return data
}

async function buildPersonalGraphData(clientId: string): Promise<PersonalGraphData> {
  const auth = await PersonalMicrosoftAuth.create(clientId)
  const graph = new GraphClient(() => auth.accessToken())
  const sidecar = new OneDriveSidecar(graph)
  return {
    auth,
    tasks: new TodoGraphProvider(graph),
    sidecar,
    calendar: new CalendarGraphProvider(graph),
    mail: new MailGraphProvider(graph),
    events: new RemoteEventLog(sidecar),
    notes: new OneDriveVault(graph),
  }
}

export function configuredPersonalClientId(): string | undefined {
  const value = import.meta.env.VITE_MICROSOFT_CLIENT_ID?.trim()
  return value || undefined
}
