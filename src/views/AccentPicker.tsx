import { useState, type CSSProperties } from 'react'
import { applyAccent, defaultAccent, fromHsl, loadAccent, parseHex, saveAccent, toHsl, type AccentChoice, type Hsl } from '../accent'
import './accent.css'

// The picker has to show colors that are not the theme's: these and the slider tracks are the one place a color is written outside the tokens.
const rainbow = 'conic-gradient(#f43f5e, #f59e0b, #22c55e, #14b8a6, #3b82f6, #a855f7, #f43f5e)'
const appAccent = `light-dark(${defaultAccent.light}, ${defaultAccent.dark})`

/**
 * The app's accent, or a color of my own. The custom swatch wears a rainbow rim, so it reads as any color
 * before there is one; wearing it opens the mixer and the app follows the sliders as they move.
 */
export function AccentPicker() {
  const [choice, setChoice] = useState<AccentChoice>(loadAccent)
  const choose = (next: AccentChoice) => {
    setChoice(next)
    saveAccent(next)
    applyAccent(next)
  }
  // Starts from the color the app is wearing, so the first move of a slider is a step away from something.
  const start = () => choice.custom ?? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? defaultAccent.dark : defaultAccent.light)

  return <div className="accent-picker">
    <div className="swatches">
      <button className="swatch" type="button" aria-label="default" aria-pressed={!choice.worn} onClick={() => choose({ ...choice, worn: false })}>
        <span style={{ background: appAccent }} />
      </button>
      <button className="swatch" type="button" aria-label="custom" aria-pressed={choice.worn} onClick={() => choose({ custom: start(), worn: true })}>
        <span style={{ background: rainbow }}><span style={{ backgroundColor: choice.custom ?? 'transparent' }} /></span>
      </button>
    </div>
    {choice.worn && choice.custom && <Mixer hex={choice.custom} onChange={(custom) => choose({ custom, worn: true })} />}
  </div>
}

/**
 * Hue, saturation and lightness on three sliders, and the hex beside them for a color that has to match
 * something exactly. The browser's own color input is not used: on the phone's Firefox it is a short list of fixed colors.
 *
 * The sliders keep their own positions instead of reading them back off the hex: a grey has no hue, so read
 * back, the hue slider would jump to red the moment the color drained.
 */
function Mixer({ hex, onChange }: { hex: string; onChange: (hex: string) => void }) {
  const [hsl, setHsl] = useState<Hsl>(() => toHsl(hex))
  const [text, setText] = useState(hex)
  const [h, s, l] = hsl

  const mix = (next: Hsl) => {
    const mixed = fromHsl(next)
    setHsl(next)
    setText(mixed)
    onChange(mixed)
  }
  const type = (raw: string) => {
    setText(raw)
    const typed = parseHex(raw.trim().startsWith('#') ? raw.trim() : `#${raw.trim()}`)
    if (!typed) return
    setHsl(toHsl(typed))
    onChange(typed)
  }

  const css = (hue: number, sat: number, light: number) => `hsl(${hue} ${sat * 100}% ${light * 100}%)`
  const tracks = {
    hue: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 360].map((hue) => css(hue, s, l)).join(', ')})`,
    saturation: `linear-gradient(to right, ${css(h, 0, l)}, ${css(h, 1, l)})`,
    lightness: `linear-gradient(to right, ${css(h, s, 0)}, ${css(h, s, 0.5)}, ${css(h, s, 1)})`,
  }
  const slider = (label: keyof typeof tracks, value: number, max: number, set: (v: number) => Hsl) =>
    <input className="color-slider" type="range" aria-label={label} min={0} max={max} value={Math.round(value)} onChange={(event) => mix(set(Number(event.target.value)))} style={{ '--track': tracks[label] } as CSSProperties} />

  return <div className="mixer">
    {slider('hue', h, 359, (v) => [v, s, l])}
    {slider('saturation', s * 100, 100, (v) => [h, v / 100, l])}
    {slider('lightness', l * 100, 100, (v) => [h, s, v / 100])}
    <input className="mixer-hex" type="text" aria-label="hex" value={text} maxLength={7} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(event) => type(event.target.value)} onBlur={() => setText(hex)} />
  </div>
}
