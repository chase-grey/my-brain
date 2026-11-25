import type { Place } from './types'

/** What the phone says about its wifi. `name` is missing when android will not give it (no permission, location off). */
export type WifiReading = { wifi: boolean; name?: string; allowed: boolean }

/** The wifi names typed in settings: one, or several split by commas. */
export function wifiNames(text: string): string[] {
  return text.split(',').map((name) => name.trim().toLowerCase()).filter(Boolean)
}

/** With no wifi to go by, weekday office hours are work and the rest is home. */
export function placeByClock(now = new Date()): Place {
  const weekday = now.getDay()
  const hour = now.getHours()
  return weekday >= 1 && weekday <= 5 && hour >= 9 && hour < 17 ? 'office' : 'home'
}

/**
 * Where the wifi says he is: on no wifi he is out, on the home or work network he is there, and on any other
 * network he is out. Undefined when the wifi says nothing: no reading (a browser), or a name that cannot be read.
 */
export function placeFromWifi(reading: WifiReading | undefined, home: string, work: string): Place | undefined {
  if (!reading) return undefined
  if (!reading.wifi) return 'out'
  const name = reading.name?.trim().toLowerCase()
  if (!name) return undefined
  if (wifiNames(home).includes(name)) return 'home'
  if (wifiNames(work).includes(name)) return 'office'
  // With neither network named yet, a network's name tells nothing.
  return wifiNames(home).length || wifiNames(work).length ? 'out' : undefined
}

/** A place picked by hand comes first, then the wifi, then the clock. */
export function currentPlace(picked: Place | undefined, reading: WifiReading | undefined, home: string, work: string, now = new Date()): Place {
  return picked ?? placeFromWifi(reading, home, work) ?? placeByClock(now)
}

/** Gone runs up to the day he is back, and that day is a day at home again. */
export function isGone(backOn: string | undefined, today: string): boolean {
  return Boolean(backOn) && /^\d{4}-\d{2}-\d{2}$/.test(backOn!) && today < backOn!
}

/** What a task that cannot be done here says in place of a hint. */
export function elsewhereHint(places: Place[]): string {
  if (places.includes('home')) return 'when you’re home'
  if (places.includes('office')) return 'when you’re at work'
  return 'when you’re out'
}
