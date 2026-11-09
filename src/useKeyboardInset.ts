import { useEffect } from 'react'

/**
 * Publishes the on-screen keyboard height as the --keyboard CSS variable.
 *
 * The viewport meta opts out of layout resizing (interactive-widget=resizes-visual), so
 * fixed-bottom chrome like the tabbar stays put under the keyboard. Anything that must stay
 * reachable while typing (the chat composer, bottom sheets) lifts itself by --keyboard instead.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const root = document.documentElement
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop
      // ignore browser chrome jitter; a keyboard is never that short
      const inset = covered > 80 ? Math.round(covered) : 0
      root.style.setProperty('--keyboard', `${inset}px`)
    }
    update()
    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
      root.style.removeProperty('--keyboard')
    }
  }, [])
}
