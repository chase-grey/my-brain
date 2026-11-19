/**
 * The work screens are not part of this app. The work bridge serves them as one module, and the app
 * imports it when the work space opens, so they only exist where the bridge runs.
 */
export type WorkUiProps = { currentDay: string }
export type WorkUiHandle = { update: (props: WorkUiProps) => void; unmount: () => void }
export type WorkUi = { mount: (element: HTMLElement, props: WorkUiProps) => WorkUiHandle }

export const workUiUrl = 'http://127.0.0.1:47321/work-ui.js'

type Importer = (url: string) => Promise<unknown>

let loaded: Promise<WorkUi> | undefined

/** One import per page; a failed one is forgotten so starting the bridge and coming back works. */
export function loadWorkUi(importer: Importer = (url) => import(/* @vite-ignore */ url)): Promise<WorkUi> {
  loaded ??= importer(workUiUrl).then((module) => {
    if (typeof (module as WorkUi | undefined)?.mount !== 'function') throw new Error('work bridge returned no work screens')
    return module as WorkUi
  }).catch((error: unknown) => {
    loaded = undefined
    throw error
  })
  return loaded
}

export function forgetWorkUi(): void {
  loaded = undefined
}
