import { expect, it } from 'vitest'
import { railSlots, splitRail } from './rail'

// The rail rule under "monitors" in AGENTS.md.
const extras = ['journal', 'stores', 'trips', 'goals', 'settings']

it('puts every screen on the rail and drops the menu when there is room and nothing else under it', () => {
  expect(splitRail(extras, railSlots(1300, 17), 3, 0)).toEqual({ onRail: extras, underMore: [] })
})

it('keeps the screens on the rail when the menu is still needed for something that is not a screen', () => {
  expect(splitRail(extras, railSlots(1300, 17), 3, 1)).toEqual({ onRail: extras, underMore: [] })
})

it('leaves under the menu only what a short window cannot fit, in the same order', () => {
  // 400px at 16px holds 7 buttons: three main screens, three more, and the menu.
  expect(railSlots(400, 16)).toBe(7)
  expect(splitRail(extras, 7, 3, 0)).toEqual({ onRail: ['journal', 'stores', 'trips'], underMore: ['goals', 'settings'] })
})

it('never trades the menu for one more screen while something is still left under it', () => {
  const { onRail, underMore } = splitRail(extras, 8, 3, 1)
  expect(onRail.length + 1 + 3).toBeLessThanOrEqual(8)
  expect(underMore).toEqual(['settings'])
})

it('keeps everything under the menu when the rail is full', () => {
  expect(splitRail(extras, 3, 3, 0)).toEqual({ onRail: [], underMore: extras })
})
