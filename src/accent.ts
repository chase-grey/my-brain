/**
 * The accent, when it is a color of my own instead of the app's.
 *
 * The app has one accent and wears it on two grounds, so one picked color has to become two: the one
 * shown on the dark ground and the one shown on the light. It is used exactly as picked wherever it can
 * be read. A color too dark to see on the dark ground is lifted until it can be, and one too pale for the
 * light ground is deepened, keeping its hue; that is all the deriving there is. The text over a solid
 * fill of it is whichever of the app's two text colors reads.
 *
 * Kept on the device, not with the synced settings: it is how this screen looks. my-mail carries the same
 * file, and workout-tracker does the same thing on a ten step scale; the pattern is ~/.claude/patterns/custom-accent.md.
 */

/** The accent the stylesheet carries. `accent.test.ts` holds this to `styles.css`. */
export const defaultAccent = { light: '#5a48d6', dark: '#8f7cff' }

const storageKey = 'my-brain.accent'

/** On the dark ground nothing darker than this can be seen; on the light ground nothing paler can be read. */
const darkGroundFloor = 0.62
const lightGroundCeiling = 0.56

const onDeep = '#ffffff'
const onBright = '#0f0f14'

export type AccentChoice = {
  /** The color of my own, kept while the app's is worn so going back to it is one tap. */
  custom?: string
  /** Whether the custom color is the one in use. */
  worn: boolean
}

export type AccentPair = { light: string; dark: string; onLight: string; onDark: string }

/** `#rrggbb` in lower case, or null for anything that is not one. */
export function parseHex(raw: unknown): string | null {
  return typeof raw === 'string' && /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null
}

export function parseAccent(stored: unknown): AccentChoice {
  const value = (stored && typeof stored === 'object' ? stored : {}) as Record<string, unknown>
  const custom = parseHex(value.custom)
  return custom ? { custom, worn: value.worn === true } : { worn: false }
}

/** The two colors a picked one becomes, and the text that goes over each. */
export function accentPair(hex: string): AccentPair {
  const [lightness, chroma, hue] = toOklch(hex)
  const dark = lightness >= darkGroundFloor ? hex : fromOklch([darkGroundFloor, chroma, hue])
  const light = lightness <= lightGroundCeiling ? hex : fromOklch([lightGroundCeiling, chroma, hue])
  return { light, dark, onLight: textOn(light), onDark: textOn(dark) }
}

/** The app's deep or bright text color, whichever reads better on a solid fill of this color. */
export function textOn(hex: string): string {
  const [r, g, b] = rgbOf(hex).map((v) => linear(v / 255))
  // Where dark text's contrast against the fill overtakes white's.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? onBright : onDeep
}

export function loadAccent(): AccentChoice {
  try {
    return parseAccent(JSON.parse(localStorage.getItem(storageKey) ?? 'null'))
  } catch {
    return { worn: false }
  }
}

export function saveAccent(choice: AccentChoice): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(choice))
  } catch {
    // Storage can be unavailable; the color still applies for this visit.
  }
}

/** Put the choice on the page: the custom pair over the stylesheet's tokens, or nothing over them. */
export function applyAccent(choice: AccentChoice, root: HTMLElement = document.documentElement): void {
  if (!choice.worn || !choice.custom) {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--on-accent')
    return
  }
  const pair = accentPair(choice.custom)
  root.style.setProperty('--accent', `light-dark(${pair.light}, ${pair.dark})`)
  root.style.setProperty('--on-accent', `light-dark(${pair.onLight}, ${pair.onDark})`)
}

export type Hsl = [hue: number, saturation: number, lightness: number]

export function toHsl(hex: string): Hsl {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s, l]
}

export function fromHsl([h, s, l]: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex([r + m, g + m, b + m])
}

function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const gamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

/** OKLCH: a space where an equal step in lightness looks equal whatever the hue, which HSL's does not. */
type Oklch = [lightness: number, chroma: number, hue: number]

function toOklch(hex: string): Oklch {
  const [r, g, b] = rgbOf(hex).map((v) => linear(v / 255))
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, Math.hypot(a, bb), Math.atan2(bb, a)]
}

function oklchToRgb([L, c, h]: Oklch): [number, number, number] {
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** The nearest color a screen can show: the same lightness and hue, less rich. */
function fromOklch([l, c, h]: Oklch): string {
  const fits = (chroma: number) => oklchToRgb([l, chroma, h]).every((v) => v >= -0.0005 && v <= 1.0005)
  let chroma = c
  if (!fits(chroma)) {
    let lo = 0
    let hi = c
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    chroma = lo
  }
  return toHex(oklchToRgb([l, chroma, h]).map((v) => gamma(Math.min(1, Math.max(0, v)))))
}
