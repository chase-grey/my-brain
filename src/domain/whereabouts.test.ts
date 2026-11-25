import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { currentPlace, elsewhereHint, isGone, placeByClock, placeFromWifi, wifiNames } from './whereabouts'

const home = 'Maple House'
const work = 'Office Net, Office Guest'
const tuesdayNoon = new Date(2026, 10, 24, 12)
const saturdayNoon = new Date(2026, 10, 28, 12)

describe('where i am, from the wifi', () => {
  it('is out with no wifi', () => {
    expect(placeFromWifi({ wifi: false, allowed: true }, home, work)).toBe('out')
    expect(placeFromWifi({ wifi: false, allowed: false }, '', '')).toBe('out')
  })

  it('is home or work on a network named for it, whatever the casing', () => {
    expect(placeFromWifi({ wifi: true, name: 'maple house', allowed: true }, home, work)).toBe('home')
    expect(placeFromWifi({ wifi: true, name: 'Office Guest', allowed: true }, home, work)).toBe('office')
  })

  it('is out on any other network', () => {
    expect(placeFromWifi({ wifi: true, name: 'Cafe', allowed: true }, home, work)).toBe('out')
  })

  it('says nothing when the name cannot be read or no network is named', () => {
    expect(placeFromWifi(undefined, home, work)).toBeUndefined()
    expect(placeFromWifi({ wifi: true, allowed: false }, home, work)).toBeUndefined()
    expect(placeFromWifi({ wifi: true, name: 'Cafe', allowed: true }, '', '')).toBeUndefined()
  })

  it('falls back to the clock, and a place picked by hand comes first', () => {
    expect(placeByClock(tuesdayNoon)).toBe('office')
    expect(placeByClock(saturdayNoon)).toBe('home')
    expect(currentPlace(undefined, undefined, home, work, tuesdayNoon)).toBe('office')
    expect(currentPlace(undefined, { wifi: false, allowed: true }, home, work, tuesdayNoon)).toBe('out')
    expect(currentPlace('home', { wifi: false, allowed: true }, home, work, tuesdayNoon)).toBe('home')
  })

  it('takes several names for one place', () => {
    expect(wifiNames(' A , b,, ')).toEqual(['a', 'b'])
  })

  it('names where a task can be done when it is not here', () => {
    expect(elsewhereHint(['home'])).toBe('when you’re home')
    expect(elsewhereHint(['office'])).toBe('when you’re at work')
    expect(elsewhereHint(['out'])).toBe('when you’re out')
  })
})

describe('gone', () => {
  it('runs up to the day back', () => {
    expect(isGone('2026-12-03', '2026-11-25')).toBe(true)
    expect(isGone('2026-12-03', '2026-12-02')).toBe(true)
    expect(isGone('2026-12-03', '2026-12-03')).toBe(false)
  })

  it('is off with no day or a day that is not one', () => {
    expect(isGone(undefined, '2026-11-25')).toBe(false)
    expect(isGone('', '2026-11-25')).toBe(false)
    expect(isGone('soon', '2026-11-25')).toBe(false)
  })
})

describe('the phone reads the wifi name and never a position', () => {
  const plugin = readFileSync('android/app/src/main/java/com/chasegrey/mybrain/WifiPlugin.java', 'utf8')

  it('asks android for no location', () => {
    expect(plugin).not.toMatch(/LocationManager|FusedLocation|getLastKnownLocation|requestLocationUpdates|getScanResults|getBSSID/)
  })
})
