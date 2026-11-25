/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accentPair, applyAccent, defaultAccent, fromHsl, parseAccent, parseHex, textOn, toHsl } from './accent'

/** Vivid, pale, dark, and no color at all. */
const picks = ['#ff6600', '#ffd400', '#00e5ff', '#7c3aed', '#ff00ff', '#e11d48', '#ffe4ec', '#0b1f5c', '#808080', '#000000', '#ffffff']

/** Relative luminance, 0 for black to 1 for white. */
const brightness = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

describe('accentPair', () => {
  it('uses the picked color as it is wherever it can be read', () => {
    // Bright: exact on the dark ground. Deep: exact on the light ground.
    expect(accentPair('#ff6600').dark).toBe('#ff6600')
    expect(accentPair('#ffd400').dark).toBe('#ffd400')
    expect(accentPair('#0b1f5c').light).toBe('#0b1f5c')
    expect(accentPair('#7c3aed').light).toBe('#7c3aed')
  })

  it('lifts a color too dark for the dark ground and deepens one too pale for the light', () => {
    for (const pick of picks) {
      const pair = accentPair(pick)
      expect(pair.light, pick).toMatch(/^#[0-9a-f]{6}$/)
      expect(pair.dark, pick).toMatch(/^#[0-9a-f]{6}$/)
      expect(brightness(pair.dark), pick).toBeGreaterThan(0.2)
      expect(brightness(pair.light), pick).toBeLessThan(0.3)
    }
  })

  it('keeps the hue when it moves a color', () => {
    const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    const [r, , b] = channels(accentPair('#0b1f5c').dark)
    expect(b).toBeGreaterThan(r)
    const [r2, g2, b2] = channels(accentPair('#ffd400').light)
    expect(r2).toBeGreaterThan(b2)
    expect(g2).toBeGreaterThan(b2)
  })

  it('puts the deep text on a bright fill and white on a deep one', () => {
    expect(accentPair('#ffd400').onDark).toBe('#0f0f14')
    expect(accentPair('#0b1f5c').onLight).toBe('#ffffff')
    expect(textOn('#ffffff')).toBe('#0f0f14')
    expect(textOn('#000000')).toBe('#ffffff')
  })
})

describe('parseAccent', () => {
  it('keeps a color, worn or not', () => {
    expect(parseAccent({ custom: '#FF6600', worn: true })).toEqual({ custom: '#ff6600', worn: true })
    expect(parseAccent({ custom: '#ff6600' })).toEqual({ custom: '#ff6600', worn: false })
  })

  it('wears nothing without a color behind it', () => {
    expect(parseAccent(null)).toEqual({ worn: false })
    expect(parseAccent({ worn: true })).toEqual({ worn: false })
    expect(parseAccent({ custom: 'orange', worn: true })).toEqual({ worn: false })
    expect(parseHex('#f60')).toBeNull()
  })
})

describe('applyAccent', () => {
  const page = () => {
    const set = new Map<string, string>()
    const root = { style: { setProperty: (name: string, value: string) => set.set(name, value), removeProperty: (name: string) => set.delete(name) } }
    return { set, root: root as unknown as HTMLElement }
  }

  it('writes both grounds over the tokens', () => {
    const { set, root } = page()
    applyAccent({ custom: '#ff6600', worn: true }, root)
    expect(set.get('--accent')).toBe(`light-dark(${accentPair('#ff6600').light}, #ff6600)`)
    expect(set.get('--on-accent')).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
  })

  it('leaves the stylesheet alone when the color is not worn', () => {
    const { set, root } = page()
    applyAccent({ custom: '#ff6600', worn: true }, root)
    applyAccent({ custom: '#ff6600', worn: false }, root)
    expect(set.size).toBe(0)
  })
})

describe('the sliders', () => {
  it('give back the color they were set from', () => {
    for (const pick of picks) expect(fromHsl(toHsl(pick))).toBe(pick)
  })
})

it('names the same default accent the stylesheet does', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf8')
  expect(css).toContain(`--accent: light-dark(${defaultAccent.light}, ${defaultAccent.dark});`)
})
