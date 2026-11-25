/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// The bottom of the app meets Android's navigation bar: ~/.claude/patterns/android-nav-bar.md.
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')
const css = read('src/styles.css')
const darkGround = /--bg:\s*light-dark\([^,]+,\s*(#[0-9a-f]{6})\)/i.exec(css)?.[1]

it('asks to draw under the navigation bar', () => {
  expect(read('index.html')).toMatch(/name="viewport"[^>]*viewport-fit=cover/)
})

it('has the phone paint its navigation bar the dark ground', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'))
  expect(darkGround).toBeTruthy()
  expect(manifest.theme_color).toBe(darkGround)
  expect(manifest.background_color).toBe(darkGround)
})

it('lays the tab bar on the ground in dark and pads it past the navigation bar', () => {
  const bar = /^\.tabbar \{[^}]*\}/m.exec(css)?.[0] ?? ''
  expect(bar).toMatch(/background:\s*light-dark\(var\(--surface\),\s*var\(--bg\)\)/)
  expect(bar).toContain('env(safe-area-inset-bottom)')
})
