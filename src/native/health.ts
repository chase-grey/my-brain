import { registerPlugin } from '@capacitor/core'
import { mergeRestDays, type RestDay } from '../domain/rest'
import type { ProductState } from '../productState'
import { isNativeApp } from './platform'

export type PhoneAccess = 'granted' | 'denied' | 'unavailable'
export type PhoneRestStatus = { sleep: PhoneAccess; screen: PhoneAccess }

type HealthPlugin = {
  status(): Promise<PhoneRestStatus>
  /** Asks Health Connect for sleep. Resolves once the person has answered. */
  requestSleep(): Promise<{ sleep: PhoneAccess }>
  /** Opens Android's usage access screen; the switch for this app is flipped there. */
  openUsageAccess(): Promise<void>
  read(options: { days: number }): Promise<{ days: RestDay[] }>
}

const none: PhoneRestStatus = { sleep: 'unavailable', screen: 'unavailable' }

// Only the android shell can read the phone; in a browser every call answers "unavailable".
const Health = registerPlugin<HealthPlugin>('Health', {
  web: () => Promise.resolve({
    status: async () => none,
    requestSleep: async () => ({ sleep: 'unavailable' as const }),
    openUsageAccess: async () => {},
    read: async () => ({ days: [] }),
  }),
})

export async function phoneRestStatus(): Promise<PhoneRestStatus> {
  if (!isNativeApp()) return none
  try {
    return await Health.status()
  } catch {
    return none
  }
}

export async function requestSleepAccess(): Promise<PhoneAccess> {
  try {
    return (await Health.requestSleep()).sleep
  } catch {
    return 'denied'
  }
}

export async function openScreenTimeAccess(): Promise<void> {
  try {
    await Health.openUsageAccess()
  } catch {
    // Nothing to open; the status stays as it was.
  }
}

/** Sleep and screen time for the days the phone still holds. Empty in a browser or with nothing allowed. */
export async function readPhoneRest(days = 28): Promise<RestDay[]> {
  if (!isNativeApp()) return []
  try {
    return (await Health.read({ days })).days
  } catch {
    return []
  }
}

/** Folds what the phone holds into the days the app keeps. Does nothing in a browser. */
export async function syncPhoneRest(onProduct: (update: (current: ProductState) => ProductState) => void, today: string): Promise<void> {
  const days = await readPhoneRest()
  if (!days.length) return
  onProduct((current) => {
    const restDays = mergeRestDays(current.restDays, days, today)
    return JSON.stringify(restDays) === JSON.stringify(current.restDays) ? current : { ...current, restDays }
  })
}
