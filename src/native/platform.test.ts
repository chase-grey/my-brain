import { expect, it } from 'vitest'
import { hashForAppUrl } from './platform'

it('maps widget links onto hash routes', () => {
  expect(hashForAppUrl('mybrain://chat/talk')).toBe('#chat/talk')
  expect(hashForAppUrl('mybrain://task/abc-1')).toBe('#task/abc-1')
  expect(hashForAppUrl('mybrain://today/')).toBe('#today')
})

it('ignores anything that is not an app link', () => {
  expect(hashForAppUrl('https://chase-grey.github.io/my-brain/#chat')).toBeUndefined()
  expect(hashForAppUrl('mybrain://')).toBeUndefined()
  expect(hashForAppUrl('not a url')).toBeUndefined()
})
