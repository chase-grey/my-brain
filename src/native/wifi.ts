import { registerPlugin } from '@capacitor/core'
import { useEffect, useState } from 'react'
import type { WifiReading } from '../domain/whereabouts'
import { isNativeApp } from './platform'

type WifiPlugin = {
  current(): Promise<WifiReading>
  /** Shows android's prompt for the network's name. Resolves once it has been answered. */
  allow(): Promise<WifiReading>
}

// A browser cannot see the wifi, so there the plugin is never called.
const Wifi = registerPlugin<WifiPlugin>('Wifi')

/** What the phone's wifi is right now. Undefined in a browser, where there is nothing to read. */
export async function readWifi(): Promise<WifiReading | undefined> {
  if (!isNativeApp()) return undefined
  try {
    return await Wifi.current()
  } catch {
    // An apk from before the plugin: carry on by the clock.
    return undefined
  }
}

export async function allowWifiName(): Promise<WifiReading | undefined> {
  if (!isNativeApp()) return undefined
  try {
    return await Wifi.allow()
  } catch {
    return undefined
  }
}

const listeners = new Set<(reading: WifiReading | undefined) => void>()
let latest: WifiReading | undefined

function publish(reading: WifiReading | undefined): void {
  latest = reading
  listeners.forEach((listener) => listener(reading))
}

/** Reads the wifi again and tells every screen showing it. */
export async function refreshWifi(ask = false): Promise<void> {
  publish(await (ask ? allowWifiName() : readWifi()))
}

/** The phone's wifi, read when the app opens, each time it comes back to the front, and every minute it is open. */
export function useWifi(): WifiReading | undefined {
  const [reading, setReading] = useState(latest)
  useEffect(() => {
    listeners.add(setReading)
    if (!isNativeApp()) return () => { listeners.delete(setReading) }
    const read = () => { if (document.visibilityState === 'visible') void refreshWifi() }
    read()
    document.addEventListener('visibilitychange', read)
    const timer = setInterval(read, 60_000)
    return () => {
      listeners.delete(setReading)
      document.removeEventListener('visibilitychange', read)
      clearInterval(timer)
    }
  }, [])
  return reading
}
