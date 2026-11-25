/// <reference types="node" />
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

// The app's whole palette. No warning, error or success colors: see "color" in AGENTS.md.
const theme = ['bg', 'surface', 'surface-2', 'border', 'text', 'muted', 'accent', 'on-accent']

const src = join(process.cwd(), 'src')
const sheets = readdirSync(src, { recursive: true, encoding: 'utf8' })
  .filter((file) => file.endsWith('.css'))
  .map((file) => ({ file, css: readFileSync(join(src, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }))

it('finds the stylesheets', () => {
  expect(sheets.map((sheet) => sheet.file)).toContain('styles.css')
})

it('defines no color tokens beyond the theme', () => {
  const tokens = sheets.flatMap(({ css }) => [...css.matchAll(/--([\w-]+):\s*[^;]*(?:#[0-9a-f]{3,8}\b|rgb|hsl|oklch|light-dark|color-mix)/gi)].map((match) => match[1]))
  expect([...new Set(tokens)].sort()).toEqual([...theme].sort())
})

it('colors nothing outside the theme tokens', () => {
  const named = /:\s*[^;{}]*\b(red|crimson|tomato|firebrick|orange|amber|gold|yellow|green|limegreen)\b/i
  const strays = sheets.flatMap(({ file, css }) => css.split('\n')
    .filter((line) => !/^\s*--[\w-]+:/.test(line))
    // Black at some opacity is a shadow or a scrim, and a QR code needs white behind it.
    .map((line) => line.replace(/rgb\(0 0 0 \/ [\d.]+\)/g, ''))
    .filter((line) => !line.startsWith('.share-qr .qr '))
    .filter((line) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i.test(line) || named.test(line))
    .map((line) => `${file}: ${line.trim().slice(0, 120)}`))
  expect(strays).toEqual([])
})
