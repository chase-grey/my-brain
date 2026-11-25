import { expect, it } from 'vitest'
import { duration, parseDuration } from './format'

it('reads a typed length of time, a bare number as minutes', () => {
  expect(parseDuration('45')).toBe(45)
  expect(parseDuration('45m')).toBe(45)
  expect(parseDuration('20 min')).toBe(20)
  expect(parseDuration('2h')).toBe(120)
  expect(parseDuration('1.5h')).toBe(90)
  expect(parseDuration('1h 30m')).toBe(90)
  expect(parseDuration('1h30')).toBe(90)
  expect(parseDuration('1:30')).toBe(90)
  expect(parseDuration(' 8 Hours ')).toBe(480)
  expect(parseDuration('200')).toBe(200)
})

it('reads back what it shows', () => {
  for (const minutes of [1, 7, 59, 60, 61, 200, 480, 1500]) expect(parseDuration(duration(minutes))).toBe(minutes)
})

it('takes nothing that is not a length, or no time at all', () => {
  for (const words of ['', '  ', 'soon', '0', '0h', '-5', 'h', '1h later']) expect(parseDuration(words)).toBeUndefined()
})
