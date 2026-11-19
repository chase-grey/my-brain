import { useEffect, useRef, useState } from 'react'
import { loadWorkUi, type WorkUiHandle } from '../data/workUi'
import { Empty } from '../ui'

/** The work dashboard, drawn by the bundle the bridge serves (src/data/workUi.ts). */
export function WorkScreens({ currentDay }: { currentDay: string }) {
  const element = useRef<HTMLDivElement>(null)
  const handle = useRef<WorkUiHandle>(undefined)
  const day = useRef(currentDay)
  day.current = currentDay
  const [error, setError] = useState<string>()

  useEffect(() => {
    let active = true
    loadWorkUi().then((ui) => {
      if (active && element.current) handle.current = ui.mount(element.current, { currentDay: day.current })
    }, (reason: unknown) => {
      if (active) setError(reason instanceof Error && !(reason instanceof TypeError) ? reason.message : 'start the work bridge with npm run bridge')
    })
    return () => {
      active = false
      handle.current?.unmount()
      handle.current = undefined
    }
  }, [])

  useEffect(() => { handle.current?.update({ currentDay }) }, [currentDay])

  if (error) return <Empty>{error}</Empty>
  return <div ref={element} />
}
