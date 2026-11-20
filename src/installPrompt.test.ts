import { describe, expect, it } from 'vitest'
import { chromeUrl, dismissDays, installOffer, isHandheld, isIOS, isOtherAndroid } from './installPrompt'

const now = new Date('2026-11-15T12:00:00Z')
const base = { standalone: false, canPrompt: false, ios: false, dismissedAt: null, now }

describe('install offer', () => {
  it('offers chrome its own dialog, and iOS the share sheet hint', () => {
    expect(installOffer({ ...base, canPrompt: true })).toBe('prompt')
    expect(installOffer({ ...base, ios: true })).toBe('ios')
    expect(installOffer(base)).toBeNull()
  })

  it('sends firefox on android over to chrome', () => {
    expect(installOffer({ ...base, otherAndroid: true })).toBe('chrome')
    expect(isOtherAndroid('Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0')).toBe(true)
    expect(isOtherAndroid('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36')).toBe(false)
    expect(isOtherAndroid('Mozilla/5.0 (Windows NT 10.0; rv:132.0) Gecko/20100101 Firefox/132.0')).toBe(false)
    expect(chromeUrl('https://example.github.io/my-brain/?a=1#today')).toBe('intent://example.github.io/my-brain/?a=1#Intent;scheme=https;package=com.android.chrome;end')
  })

  it('offers nothing to the installed app', () => {
    expect(installOffer({ ...base, standalone: true, canPrompt: true })).toBeNull()
  })

  it('holds a dismissal for two weeks, then asks again', () => {
    const day = 86_400_000
    const recent = new Date(now.getTime() - (dismissDays - 1) * day).toISOString()
    const old = new Date(now.getTime() - (dismissDays + 1) * day).toISOString()
    expect(installOffer({ ...base, canPrompt: true, dismissedAt: recent })).toBeNull()
    expect(installOffer({ ...base, canPrompt: true, dismissedAt: old })).toBe('prompt')
  })
})

describe('devices', () => {
  it('counts an iPad that calls itself a mac', () => {
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe(true)
    expect(isIOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0)).toBe(false)
  })

  it('tells a phone from a laptop', () => {
    expect(isHandheld('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile', 5)).toBe(true)
    expect(isHandheld('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)).toBe(false)
  })
})
