import { describe, expect, it } from 'vitest'
import { nextStep, type Installed } from './update'

const phone: Installed = { web: 'aaa1111', native: 'n1', bad: '' }

describe('what a published build asks of the phone', () => {
  it('asks nothing when the phone already runs it', () => {
    expect(nextStep({ web: 'aaa1111', native: 'n1' }, phone)).toBe('none')
  })

  it('takes a new web part on its own when the native part is the same', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n1' }, phone)).toBe('web')
  })

  it('needs the apk when the native part changed, and does not take the web part without it', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n2' }, phone)).toBe('apk')
    expect(nextStep({ web: 'aaa1111', native: 'n2' }, phone)).toBe('apk')
  })

  it('does not download again a build that would not start', () => {
    expect(nextStep({ web: 'bbb2222', native: 'n1' }, { ...phone, bad: 'bbb2222' })).toBe('none')
    expect(nextStep({ web: 'ccc3333', native: 'n1' }, { ...phone, bad: 'bbb2222' })).toBe('web')
  })

  it('asks nothing of a release that does not say what it holds', () => {
    expect(nextStep({ web: '', native: '' }, phone)).toBe('none')
  })
})
