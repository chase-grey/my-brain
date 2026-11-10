// Build stamp baked in by vite `define` (vite.config.ts). Shown in settings so a device stuck on a
// stale, service-worker-cached copy is easy to spot.
export const APP_COMMIT = __APP_COMMIT__
export const APP_BUILD_TIME = __BUILD_TIME__

// How long to wait for the new worker to take over before reloading anyway.
const CONTROLLER_SWAP_TIMEOUT_MS = 10_000

type WorkerRegistrationLike = { installing: unknown; waiting: unknown; update(): Promise<unknown> }
type ServiceWorkerContainerLike = {
  addEventListener(type: 'controllerchange', listener: () => void, options?: { once?: boolean }): void
  getRegistrations(): Promise<readonly WorkerRegistrationLike[]>
}

// Pull down any newer worker and wait until it owns the page. `update()` resolves as soon as the new
// worker starts installing, so reloading right after it is still served by the old worker; sw.js calls
// skipWaiting and clients.claim, so `controllerchange` fires the moment the new one takes over.
export async function pullNewWorker(sw: ServiceWorkerContainerLike, timeoutMs = CONTROLLER_SWAP_TIMEOUT_MS): Promise<void> {
  const tookOver = new Promise<void>((resolve) => { sw.addEventListener('controllerchange', () => resolve(), { once: true }) })
  const regs = await sw.getRegistrations()
  await Promise.all(regs.map((reg) => reg.update().catch(() => undefined)))
  if (!regs.some((reg) => reg.installing || reg.waiting)) return
  await Promise.race([tookOver, new Promise((resolve) => setTimeout(resolve, timeoutMs))])
}

// Check for a newer build, then reload. Reloads even when the check fails or there is no worker (dev, android shell).
export async function checkForUpdate(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) await pullNewWorker(navigator.serviceWorker as unknown as ServiceWorkerContainerLike)
  } finally {
    window.location.reload()
  }
}
