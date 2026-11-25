import { describe, expect, it } from 'vitest'
import { inboxLine } from './TodayView'

describe('email on today', () => {
  it('has nothing to show until mail needs something done', () => {
    expect(inboxLine(undefined)).toBeUndefined()
    expect(inboxLine({ needsMe: 0 })).toBeUndefined()
  })

  it('says how many need me', () => {
    expect(inboxLine({ needsMe: 1 })).toBe('1 needs me')
    expect(inboxLine({ needsMe: 4 })).toBe('4 need me')
  })
})
