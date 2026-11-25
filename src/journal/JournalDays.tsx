import { Empty } from '../ui'
import { dayLabel } from './journal'

/** The days with an entry, newest first, each named with its year. The chat picks one to attach from this. */
export function JournalDays({ days, onOpen }: { days: string[] | undefined; onOpen: (day: string) => void }) {
  if (!days) return <Empty>loading</Empty>
  if (!days.length) return <Empty>no entries yet</Empty>
  return <ul className="history-list" aria-label="journal entries">
    {days.map((day) => <li key={day}><button className="history-main" type="button" onClick={() => onOpen(day)}><span className="history-title">{dayLabel(day)}</span></button></li>)}
  </ul>
}
