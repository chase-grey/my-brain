import { describe, expect, it } from 'vitest'
import { nextStep, type Installed } from './update'

const phone: Installed = { web: 'aaa1111', native: 'n1', bad: '', build: 40 }

describe('what a published build asks of the phone', () => {
  it('asks nothing when the phone already runs it', () => {
    expect(nextStep({ web: 'aaa1111', native: 'n1', build: 40 }, phone)).toBe('none')
  })

  it('takes a new web part on its own when the native part is the same', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n1', build: 41 }, phone)).toBe('web')
  })

  it('needs the apk when the native part changed, and does not take the web part without it', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n2' }, phone)).toBe('apk')
    expect(nextStep({ web: 'aaa1111', native: 'n2' }, phone)).toBe('apk')
  })

  it('does not download again a build that would not start', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n1', build: 41 }, { ...phone, bad: 'bbb2222' })).toBe('none')
    expect(nextStep({ web: 'ccc3333', native: 'n1', build: 42 }, { ...phone, bad: 'bbb2222' })).toBe('web')
  })

  it('does not go back to a build older than the one it has', () => {
    expect(nextStep({ web: 'ccc3333', native: 'n1', build: 39 }, phone)).toBe('none')
  })

  it('downloads again a build it has taken but not yet moved onto', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n1', build: 41 }, { ...phone, build: 41 })).toBe('web')
  })

  it('does not take a web part that carries no build number', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n1' }, phone)).toBe('none')
  })

  it('still offers the apk when the release carries no build number', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n2' }, phone)).toBe('apk')
  })

  it('asks nothing of a release that does not say what it holds', () => {
    expect(nextStep({ web: '', native: '' }, phone)).toBe('none')
  })
})
