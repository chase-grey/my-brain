import { useLayoutEffect, useRef } from 'react'
import type { RingArc } from '../domain/lifeRing'
import type { LifeDomain } from '../domain/types'

export const wheelHue: Record<LifeDomain, string> = {
  body: '#e0564d',
  purpose: '#e39b2e',
  connection: '#d8508f',
  build: '#4f9d5b',
  mind: '#3f7fd6',
  creativity: '#9b5de5',
  money: '#2aa08a',
  rest: '#6b7fd7',
}

const INNER = 26
const OUTER = 100
const LABEL = 112
const VIEW = { x: 170, y: 118 }
const GAP = 2.4

function point(radius: number, degrees: number): string {
  const radians = ((degrees - 90) * Math.PI) / 180
  return `${(radius * Math.cos(radians)).toFixed(2)} ${(radius * Math.sin(radians)).toFixed(2)}`
}

function wedge(from: number, to: number, inner: number, outer: number): string {
  const large = to - from > 180 ? 1 : 0
  return `M${point(inner, from)} L${point(outer, from)} A${outer} ${outer} 0 ${large} 1 ${point(outer, to)} L${point(inner, to)} A${inner} ${inner} 0 ${large} 0 ${point(inner, from)} Z`
}

/** How vivid a slice should read: 0 is grey, 1 is the domain's full hue. */
export function sliceHealth(arc: RingArc): number {
  if (arc.state === 'dormant' || arc.state === 'unknown' || arc.fill === undefined) return 0
  return arc.focus ? Math.min(arc.fill, 0.45) : arc.fill
}

export function LifeWheel({ arcs, selected, compact, onSelect }: { arcs: RingArc[]; selected?: LifeDomain; compact?: boolean; onSelect: (domain: LifeDomain) => void }) {
  const frame = useRef<HTMLDivElement>(null)
  const last = useRef<DOMRect | undefined>(undefined)

  // FLIP: move smoothly between the full and compact positions.
  useLayoutEffect(() => {
    const element = frame.current
    if (!element || typeof element.animate !== 'function') return
    const next = element.getBoundingClientRect()
    const prev = last.current
    last.current = next
    if (!prev || prev.width === next.width || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const scale = prev.width / next.width
    element.animate(
      [{ transformOrigin: 'top left', transform: `translate(${prev.left - next.left}px, ${prev.top - next.top}px) scale(${scale})` }, { transformOrigin: 'top left', transform: 'none' }],
      { duration: 380, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
    )
  }, [compact])

  const step = 360 / arcs.length
  return <div className={`wheel-frame${compact ? ' is-compact' : ''}`} ref={frame}>
    <svg className="wheel" viewBox={`-${VIEW.x} -${VIEW.y} ${VIEW.x * 2} ${VIEW.y * 2}`} role="group" aria-label="life wheel">
      {arcs.map((arc, index) => {
        const from = index * step + GAP / 2
        const to = (index + 1) * step - GAP / 2
        const mid = (from + to) / 2
        const health = sliceHealth(arc)
        const extent = arc.fill === undefined ? 0 : INNER + (OUTER - INNER) * Math.max(0.12, arc.fill)
        const hue = wheelHue[arc.domain]
        const dim = selected !== undefined && selected !== arc.domain
        const label = arc.domain
        const anchor = mid < 10 || mid > 350 || Math.abs(mid - 180) < 10 ? 'middle' : mid < 180 ? 'start' : 'end'
        const [lx, ly] = point(LABEL, mid).split(' ').map(Number)
        return <g key={arc.domain} className={`slice${dim ? ' is-dim' : ''}${selected === arc.domain ? ' is-selected' : ''}${arc.state === 'dormant' ? ' is-dormant' : ''}`} style={{ '--hue': hue } as React.CSSProperties}>
          <path className="slice-track" d={wedge(from, to, INNER, OUTER)} />
          {extent > 0 && <path className="slice-fill" d={wedge(from, to, INNER, extent)} style={{ fill: `color-mix(in oklch, ${hue} ${Math.round(25 + 75 * health)}%, var(--muted))` }} />}
          <path className="slice-hit" d={wedge(from - GAP / 2, to + GAP / 2, INNER - 4, OUTER + 4)} role="button" tabIndex={0} aria-label={`${label}${arc.fill === undefined ? ` · ${arc.state}` : ` · ${Math.round(arc.fill * 100)}%`}`} aria-pressed={selected === arc.domain}
            onClick={() => onSelect(arc.domain)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(arc.domain) } }} />
          <text className="slice-label" x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle">{label}</text>
        </g>
      })}
    </svg>
  </div>
}
