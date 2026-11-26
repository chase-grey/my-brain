import { useEffect, useRef, useState } from 'react'
import { bridgeAway, bridgeAwayMessage, bridgeRetryMs, loadWorkUi, type WorkUiHandle } from '../data/workUi'
import { Empty } from '../ui'

export type WorkScreensState ={ kind: 'loading' } | { kind: 'ready' } | { kind: 'away' } | { kind: 'failed'; message: string }

/** What the dashboard shows until the work screens are drawn. */
export function WorkScreensNotice({ state }: { state: WorkScreensState }) {
  if (state.kind === 'away') return <Empty>{bridgeAwayMessage}</Empty>
  if (state.kind === 'failed') return <Empty>{state.message}</Empty>
  if (state.kind === 'loading') return <Empty>loading</Empty>
  return null
}

/**
 * The work dashboard, drawn by the bundle the bridge serves (src/data/workUi.ts). While the bridge is
 * not running it says so and how to start it, and keeps looking, so it draws itself once the bridge is up.
 */
export function WorkScreens({ currentDay }: { currentDay: string }) {
  const element = useRef<HTMLDivElement>(null)
  const handle = useRef<WorkUiHandle>(undefined)
  const day = useRef(currentDay)
  day.current = currentDay
  const [state, setState] = useState<WorkScreensState>({ kind: 'loading' })

  useEffect(() => {
    let active = true
    let trying = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const tryLoad = () => {
      if (!active || trying || handle.current) return
      trying = true
      clearTimeout(timer)
      loadWorkUi().then((ui) => {
        trying = false
        if (!active) return
        setState({ kind: 'ready' })
        if (element.current && !handle.current) handle.current = ui.mount(element.current, { currentDay: day.current })
      }, (reason: unknown) => {
        trying = false
        if (!active) return
        if (bridgeAway(reason)) {
          setState({ kind: 'away' })
          timer = setTimeout(tryLoad, bridgeRetryMs)
        } else {
          setState({ kind: 'failed', message: reason instanceof Error ? reason.message.toLowerCase() : 'work screens failed to load' })
        }
      })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') tryLoad() }

    tryLoad()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', tryLoad)
    return () => {
      active = false
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', tryLoad)
      handle.current?.unmount()
      handle.current = undefined
    }
  }, [])

  useEffect(() => { handle.current?.update({ currentDay }) }, [currentDay])

  // The mount point stays drawn throughout, so the screens have somewhere to go the moment they load.
  return <>
    <WorkScreensNotice state={state} />
    <div ref={element} />
  </>
}
