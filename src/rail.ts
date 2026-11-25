import { useEffect, useState } from 'react'

/**
 * The monitor's side rail (AGENTS.md, "monitors"). Whatever sits under the … menu on the phone is put on the rail
 * itself while the rail has the height for it, in the menu's order; only what does not fit stays under ….
 */

/** How many buttons the rail holds at this window height. Mirrors `.rail` in styles.css: 0.75rem padding, 3rem buttons, 0.25rem between. */
export function railSlots(heightPx: number, remPx: number): number {
  return Math.max(0, Math.floor((heightPx - 1.5 * remPx + 0.25 * remPx) / (3.25 * remPx)))
}

/** Splits the screens beyond the main ones into those shown on the rail and those left under …. `menuOnly` counts the … entries that are not screens. */
export function splitRail<T>(extras: T[], slots: number, primary: number, menuOnly: number): { onRail: T[]; underMore: T[] } {
  const free = slots - primary
  // Everything fits and nothing else needs the menu: no … at all.
  if (!menuOnly && extras.length <= free) return { onRail: extras, underMore: [] }
  const shown = Math.max(0, Math.min(extras.length, free - 1))
  return { onRail: extras.slice(0, shown), underMore: extras.slice(shown) }
}

const read = () => typeof window === 'undefined' ? 0 : railSlots(window.innerHeight, parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)

export function useRailSlots(): number {
  const [slots, setSlots] = useState(read)
  useEffect(() => {
    const onResize = () => setSlots(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return slots
}
