import { useEffect, useRef, useState } from 'react'
import { advance, cardPlace, currentStep, litBox, saveGuide, skip, stepPosition, stepsFor, useGuide, type Box, type Guide, type TourStep, type TourView } from '../tour'

/** The clear space between the tour's card and what it points at, or the edge of the window. */
const gap = 12

/** What sits on screen for a step: its own button, or the … it is kept under, or for a docked chat the chat itself. */
function targetOf(step: TourStep): Element | undefined {
  const candidates = [
    ...document.querySelectorAll(`[data-tour="${step.target}"]`),
    ...(step.target === 'chat' ? document.querySelectorAll('.dock') : []),
    ...document.querySelectorAll('.rail-more summary, .tabbar > .menu > summary'),
  ]
  // The rail and the tab bar are both in the page, and only one of them is drawn.
  return candidates.find((element) => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 })
}

const sameBox = (a: Box | undefined, b: Box | undefined) => a === b || (a !== undefined && b !== undefined && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height)

/**
 * The first-run tour, as a card floating over the app (src/tour.ts).
 *
 * It owns the screen while it is up: the page behind is dimmed and takes no taps, the screen each step
 * is about is opened under it, and the one thing the step is about is left lit. What is lit is measured
 * every frame, since the screen behind is still arriving when the step changes; nothing is stopped to measure.
 */
export function Tour({ view, aiOn, onView }: { view: string; aiOn: boolean; onView: (view: TourView) => void }) {
  const guide = useGuide()
  const steps = stepsFor(guide, aiOn)
  const step = currentStep(steps, guide)
  const layer = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [spot, setSpot] = useState<Box>()
  const [place, setPlace] = useState<{ top: number; left: number }>()
  // Where the person was when the tour came up, to go back to when it ends.
  const cameFrom = useRef<TourView | undefined>(undefined)
  const stepId = step?.id
  const stepView = step?.view

  useEffect(() => {
    if (!stepView) return
    if (cameFrom.current === undefined) cameFrom.current = view === 'chat' ? 'chat' : 'today'
    if (view !== stepView) onView(stepView)
  }, [stepView, view, onView])

  useEffect(() => {
    if (!step) return
    let frame = 0
    const measure = () => {
      const window_ = { width: window.innerWidth, height: window.innerHeight }
      const target = targetOf(step)
      const rect = target?.getBoundingClientRect()
      const lit = rect && litBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height }, window_, 6)
      const next = lit && { top: Math.round(lit.top), left: Math.round(lit.left), width: Math.round(lit.width), height: Math.round(lit.height) }
      setSpot((before) => sameBox(before, next) ? before : next)
      const box = card.current
      if (box && box.offsetHeight > 0) {
        // The layer is padded by the status bar's height, which is the one place that number can be read in pixels.
        const top = layer.current ? parseFloat(getComputedStyle(layer.current).paddingTop) || 0 : 0
        const to = cardPlace(next, { width: box.offsetWidth, height: box.offsetHeight }, { ...window_, top }, gap)
        const rounded = { top: Math.round(to.top), left: Math.round(to.left) }
        setPlace((before) => before && before.top === rounded.top && before.left === rounded.left ? before : rounded)
      }
      frame = requestAnimationFrame(measure)
    }
    frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [stepId])

  if (!step) return null

  const save = (next: Guide) => {
    saveGuide(next)
    if (next.done) onView(cameFrom.current ?? 'today')
  }
  const { index, total } = stepPosition(steps, step)

  return <div className={`tour${spot ? '' : ' is-dim'}`} ref={layer}>
    {spot && <div className="tour-spot" aria-hidden="true" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} />}
    <div className="tour-card" ref={card} role="dialog" aria-modal="true" aria-labelledby="tour-title" style={place ? { top: place.top, left: place.left } : { visibility: 'hidden' }}>
      {/* Keyed by step, so each one arrives rather than having its words swapped. */}
      <div className="tour-step" key={step.id}>
        <header><h2 id="tour-title">{step.title}</h2><span>{index} of {total}</span></header>
        <p>{step.body}</p>
        <div className="actions">
          <button className="primary" type="button" onClick={() => save(advance(steps, guide, step.id))}>{index === total ? 'done' : 'next'}</button>
          {index < total && <button className="plain" type="button" onClick={() => save(skip(guide))}>skip tour</button>}
        </div>
      </div>
    </div>
  </div>
}
