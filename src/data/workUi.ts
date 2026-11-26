import { BridgeCompanionClient, BridgeUnreachableError } from '../companion/bridgeCompanion'

/**
 * The work screens are not part of this app. The work bridge serves them as one module, and the app
 * imports it when the work space opens, so they only exist where the bridge runs.
 */
export type WorkUiProps = { currentDay: string }
export type WorkUiHandle = { update: (props: WorkUiProps) => void; unmount: () => void }
export type WorkUi = { mount: (element: HTMLElement, props: WorkUiProps) => WorkUiHandle }

export const workUiUrl = 'http://127.0.0.1:47321/work-ui.js'

/** How long the bridge has to answer before the dashboard says it is not running. */
export const bridgeProbeMs = 3000
/** How often the dashboard looks for the bridge again while it is away, so starting it is enough. */
export const bridgeRetryMs = 5000

/** What the dashboard says when the bridge is not running: what is wrong and how to start it. */
export const bridgeAwayMessage = "work bridge isn't running · start it with npm run bridge"

export class WorkBridgeAwayError extends Error {
  constructor() {
    super('work bridge is not running')
  }
}

type Importer = (url: string) => Promise<unknown>
type Probe = () => Promise<boolean>

/** Whether the bridge answers at all. Any answer, even an error, means it is running. */
export async function workBridgeUp(fetcher: typeof fetch = (input, init) => fetch(input, init), timeoutMs = bridgeProbeMs): Promise<boolean> {
  const timed: typeof fetch = (input, init) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    return fetcher(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
  }
  try {
    await new BridgeCompanionClient(undefined, timed).status()
    return true
  } catch (error) {
    return !(error instanceof BridgeUnreachableError)
  }
}

/** True when a failed load means the bridge is not there, rather than that it sent something broken. */
export function bridgeAway(reason: unknown): boolean {
  return reason instanceof WorkBridgeAwayError || reason instanceof TypeError
}

let loaded: Promise<WorkUi> | undefined

/**
 * One import per page; a failed one is forgotten so starting the bridge and coming back works.
 * The bridge is asked first, so the module is only imported once it is there: a browser may keep a
 * failed module import and never fetch that address again.
 */
export function loadWorkUi(importer: Importer = (url) => import(/* @vite-ignore */ url), probe: Probe = () => workBridgeUp()): Promise<WorkUi> {
  loaded ??= probe().then((up) => {
    if (!up) throw new WorkBridgeAwayError()
    return importer(workUiUrl)
  }).then((module) => {
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
