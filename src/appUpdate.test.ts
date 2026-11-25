import { describe, expect, it } from 'vitest'
import { afterReloadToast, entryScript, idleMs, isNewBuild, isQuietMoment, type Moment } from './appUpdate'

const page = (name: string) => `<head><link rel="icon" href="/app/icons/app-icon.svg" /><script type="module" crossorigin src="/app/assets/${name}.js"></script><link rel="stylesheet" href="/app/assets/index-a.css"></head>`

describe('finding a newer build', () => {
  it('reads the entry script out of the published page', () => {
    expect(entryScript(page('index-abc123'))).toBe('/app/assets/index-abc123.js')
    expect(entryScript('<html></html>')).toBeUndefined()
  })

  it('sees a new build only when the published page names another one', () => {
    expect(isNewBuild(page('index-new'), '/app/assets/index-old.js')).toBe(true)
    expect(isNewBuild(page('index-old'), '/app/assets/index-old.js')).toBe(false)
    // A page that could not be read, or a dev server with no built script, is never a new build.
    expect(isNewBuild('<html></html>', '/app/assets/index-old.js')).toBe(false)
    expect(isNewBuild(page('index-new'), undefined)).toBe(false)
  })
})

describe('isQuietMoment', () => {
  const inUse: Moment = { hidden: false, held: false, touchedSinceShown: true, idleMs: 1000 }

  it('never reloads under someone using the app', () => {
    expect(isQuietMoment(inUse)).toBe(false)
  })

  it('reloads while the app is off screen', () => {
    expect(isQuietMoment({ ...inUse, hidden: true })).toBe(true)
  })

  it('reloads on the way back in, before anything is touched', () => {
    expect(isQuietMoment({ ...inUse, touchedSinceShown: false })).toBe(true)
  })

  it('reloads once the app has been left alone', () => {
    expect(isQuietMoment({ ...inUse, idleMs: idleMs - 1 })).toBe(false)
    expect(isQuietMoment({ ...inUse, idleMs })).toBe(true)
  })

  it('never reloads over something half-done, however quiet it is', () => {
    expect(isQuietMoment({ hidden: true, held: true, touchedSinceShown: false, idleMs: idleMs * 10 })).toBe(false)
  })
})

describe('afterReloadToast', () => {
  it('says nothing on a load the settings button did not ask for', () => {
    expect(afterReloadToast(null, 'abc1234')).toBeNull()
  })

  it('names the new build when the reload landed one', () => {
    expect(afterReloadToast('abc1234', 'def5678')).toBe('updated to def5678')
  })

  it('says you are current when the reload landed the same build', () => {
    expect(afterReloadToast('abc1234', 'abc1234')).toBe('you’re on the latest version')
  })

  it('says the restart failed when a newer build was found and the same one came back', () => {
    expect(afterReloadToast('abc1234', 'abc1234', true)).toBe('couldn’t update')
    expect(afterReloadToast('abc1234', 'def5678', true)).toBe('updated to def5678')
  })
})
