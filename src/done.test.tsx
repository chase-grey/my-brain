import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { Done } from './ui'

it('shows a list that is all dealt with as the accent check, with no words on screen', () => {
  const html = renderToStaticMarkup(<Done label="nothing due today" />)
  expect(html).toContain('role="img"')
  expect(html).toContain('aria-label="nothing due today"')
  expect(html.replace(/<[^>]*>/g, '')).toBe('')
})

it('celebrates today and this week when nothing is due, and does not say so in words', () => {
  const today = readFileSync(new URL('./views/TodayView.tsx', import.meta.url), 'utf8')
  expect(today).toContain('<Done label="nothing due today" />')
  expect(today).toContain('<Done label="nothing else due this week" />')
  expect(today).not.toMatch(/<Empty>nothing/)
})

it('fills the check with the accent, so it follows a color of my own', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
  expect(css).toMatch(/\.done svg \{[^}]*fill: var\(--accent\)/)
})
