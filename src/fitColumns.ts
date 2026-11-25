import { useLayoutEffect, type RefObject } from 'react'

/**
 * How the card screens use a monitor (AGENTS.md, "monitors"). Cards are drawn as large as the window allows and
 * stacked into as few columns as that takes; columns are added, and the cards shrunk, only when the cards
 * would otherwise run past the bottom of the window.
 */

/** Sizes in rem at zoom 1, except `comfortable`, which is what a card measures on screen. */
export const deckRules = { minCard: 22, maxCard: 34, comfortable: 36, gap: 1, maxZoom: 1.35 }

export type Layout = { cols: number; zoom: number; /** The deck's width in px before zoom. */ width: number }

const round = (value: number) => Math.round(value * 100) / 100

/** The largest layout for each column count: zoomed as far as it goes, with cards no wider than `maxCard`. */
export function layoutsFor(areaPx: number, remPx: number, items: number): Layout[] {
  const { minCard, maxCard, gap, maxZoom } = deckRules
  const layouts: Layout[] = []
  for (let cols = 1; cols <= Math.max(1, items); cols += 1) {
    const narrowest = (cols * minCard + (cols - 1) * gap) * remPx
    if (cols > 1 && areaPx < narrowest) break
    const zoom = round(Math.min(maxZoom, Math.max(1, areaPx / narrowest)))
    layouts.push({ cols, zoom, width: Math.floor(Math.min(areaPx / zoom, (cols * maxCard + (cols - 1) * gap) * remPx)) })
  }
  return layouts
}

/** How wide one card is on screen, in px. */
export function cardOnScreen(layout: Layout, remPx: number): number {
  return (layout.width - (layout.cols - 1) * deckRules.gap * remPx) / layout.cols * layout.zoom
}

/**
 * Picks from layouts already measured. Among those that fit the window: the biggest cards, and once cards are
 * comfortable, the most columns. When nothing fits (one card taller than the window, say) the page scrolls
 * whatever is picked, so the same choice is made among the layouts within a tenth of the shortest page.
 */
export function pickLayout(measured: Array<Layout & { height: number }>, availablePx: number, remPx: number): Layout {
  const limit = Math.max(availablePx, Math.min(...measured.map((layout) => layout.height)) * 1.1)
  const fitting = measured.filter((layout) => layout.height <= limit)
  const size = (layout: Layout) => Math.min(cardOnScreen(layout, remPx), deckRules.comfortable * remPx)
  return fitting.reduce((best, layout) => {
    const gain = size(layout) - size(best)
    return gain > 1 || (gain >= -1 && layout.cols > best.cols) ? layout : best
  })
}

const desktop = '(min-width: 48rem)'

function apply(content: HTMLElement, deck: HTMLElement, layout: Layout | undefined) {
  for (const [element, name, value] of [[content, '--deck-zoom', layout?.zoom], [deck, '--deck-cols', layout?.cols], [deck, '--deck-width', layout && `${layout.width}px`]] as const) {
    if (value === undefined) element.style.removeProperty(name)
    else element.style.setProperty(name, String(value))
  }
}

function fit(content: HTMLElement) {
  // The work dashboard's cards sit in their own box inside the screen; everywhere else the screen is the deck.
  const deck = content.querySelector<HTMLElement>('.dash') ?? content
  if (deck === content && !content.classList.contains('is-deck')) return
  if (!matchMedia(desktop).matches) return apply(content, deck, undefined)
  const main = content.parentElement
  if (!main) return
  const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const mainStyle = getComputedStyle(main)
  const areaPx = main.clientWidth - parseFloat(mainStyle.paddingLeft) - parseFloat(mainStyle.paddingRight)
  const cards = [...deck.children].filter((child) => getComputedStyle(child).columnSpan !== 'all')
  // Measured at its own height, not stretched to the window, and without children's entry animations.
  content.classList.add('is-measuring')
  const availablePx = window.innerHeight - (content.getBoundingClientRect().top + window.scrollY) - parseFloat(mainStyle.paddingBottom)
  const measure = (layout: Layout) => {
    apply(content, deck, layout)
    // Balancing can leave the last columns empty, which would sit the cards off centre; such a layout is skipped.
    const used = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size
    return { ...layout, used, height: content.getBoundingClientRect().height }
  }
  const measured = layoutsFor(areaPx, remPx, cards.length).flatMap((layout) => {
    // Shrunk cards leave room to be wider, up to the widest a card goes.
    const widest = (layout.cols * deckRules.maxCard + (layout.cols - 1) * deckRules.gap) * remPx
    const atZoom = (zoom: number) => measure({ ...layout, zoom, width: Math.floor(Math.min(areaPx / zoom, widest)) })
    const largest = measure(layout)
    if (largest.height <= availablePx || layout.zoom === 1) return [largest]
    // Too tall at this size: the same columns at the largest zoom that fits, found by halving, down to no zoom at all.
    let fits = atZoom(1)
    if (fits.height > availablePx) return [largest, fits]
    let over = layout.zoom
    for (let step = 0; step < 4; step += 1) {
      const middle = atZoom(round((fits.zoom + over) / 2))
      if (middle.height <= availablePx) fits = middle
      else over = middle.zoom
    }
    return [fits]
  })
  apply(content, deck, pickLayout(measured.filter((layout) => layout.cols === 1 || layout.used === layout.cols), availablePx, remPx))
  content.classList.remove('is-measuring')
}

/** Keeps the card screen in `content` laid out for its window. `view` re-runs it when the screen changes. */
export function useFitColumns(content: RefObject<HTMLElement | null>, view: string) {
  useLayoutEffect(() => {
    const element = content.current
    if (!element || typeof matchMedia !== 'function' || typeof MutationObserver === 'undefined') return
    const watch = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['open', 'class', 'hidden'] }
    const observer = new MutationObserver(() => run())
    function run() {
      observer.disconnect()
      fit(element!)
      observer.observe(element!, watch)
    }
    run()
    window.addEventListener('resize', run)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', run)
      for (const target of [element, ...element.querySelectorAll<HTMLElement>('.dash')]) for (const name of ['--deck-zoom', '--deck-cols', '--deck-width']) target.style.removeProperty(name)
    }
  }, [content, view])
}
