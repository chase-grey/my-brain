import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Icon } from '../navIcons'
import { dragged, type Arranged } from './arrange'
import { inJournal } from './notes'

/** How long a finger rests on a card before it is picked up. A finger that moves first is scrolling. */
export const holdMs = 320
/** How far a press may wander and still be a press. */
const slopPx = 8
/** Near the top or bottom edge the list scrolls under a card being carried. */
const edgePx = 64

type Kind = 'favorite' | 'group' | 'note'
type Carry = { kind: Kind; key: string; over?: string }

/** Where a carried note may be let go: on a group, on the favorites, or on the folder above. */
export const favoritesDrop = 'favorites'

/**
 * The notes list: every title a card. Favorites and groups are carried to a new place in their own list, and a
 * note is carried onto a group, the folder above or the favorites. With a mouse a card is carried as soon as it
 * is pulled; with a finger after a short hold, so the list still scrolls.
 */
export function NotesList({ arranged, label, above, canArrange, onOpen, onFolder, onFavorites, onGroups, onInto, onFavorite }: {
  arranged: Arranged
  label: string
  /** The folder above this one, to carry a note out to. */
  above?: { path: string; name: string }
  /** Whether anything can be carried: not in the journal, and not where notes can only be read. */
  canArrange: boolean
  onOpen: (path: string) => void
  onFolder: (path: string) => void
  onFavorites: (paths: string[]) => void
  onGroups: (paths: string[]) => void
  onInto: (note: string, folder: string) => void
  onFavorite: (note: string) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [carry, setCarry] = useState<Carry>()
  // The order while a card is being carried through it.
  const [order, setOrder] = useState<string[]>()
  const live = useRef<{
    pointer: number; x: number; y: number; startY: number; element: HTMLElement; kind: Kind; key: string
    active: boolean; timer?: ReturnType<typeof setTimeout>; top: number; scroll: number; frame?: number; order?: string[]; over?: string
  } | undefined>(undefined)
  const swallow = useRef(false)

  const favorites = carry?.kind === 'favorite' && order ? order.flatMap((path) => arranged.favorites.find((item) => item.path === path) ?? []) : arranged.favorites
  const groups = carry?.kind === 'group' && order ? order.flatMap((path) => arranged.groups.find((item) => item.path === path) ?? []) : arranged.groups

  const scroller = () => wrap.current?.closest<HTMLElement>('.chat-history') ?? undefined

  /** The carried card stays under the pointer whatever the list around it does. */
  function follow() {
    const state = live.current
    if (!state?.active) return
    const moved = state.y - state.startY + ((scroller()?.scrollTop ?? 0) - state.scroll) - (state.element.offsetTop - state.top)
    state.element.style.transform = `translateY(${moved}px)`
  }
  useLayoutEffect(follow)

  function place() {
    const state = live.current
    if (!state?.active || !wrap.current) return
    follow()
    if (state.kind === 'note') {
      const under = document.elementsFromPoint(state.x, state.y).find((element) => element instanceof HTMLElement && element.dataset.drop && !state.element.contains(element)) as HTMLElement | undefined
      const over = under?.dataset.drop
      if (over !== state.over) {
        state.over = over
        setCarry({ kind: state.kind, key: state.key, over })
      }
      return
    }
    const others = [...wrap.current.querySelectorAll<HTMLElement>(`[data-kind="${state.kind}"]`)].filter((element) => element !== state.element)
    // A card takes another's place once its middle is past the other's middle.
    const own = state.element.getBoundingClientRect()
    const middle = own.top + own.height / 2
    let to = others.findIndex((element) => {
      const box = element.getBoundingClientRect()
      return middle < box.top + box.height / 2
    })
    if (to < 0) to = others.length
    const now = dragged(state.order!, state.key, to)
    if (now.join('\n') !== state.order!.join('\n')) {
      state.order = now
      setOrder(now)
    }
  }

  function tick() {
    const state = live.current
    if (!state?.active) return
    const box = scroller()
    if (box) {
      const edge = box.getBoundingClientRect()
      const speed = state.y < edge.top + edgePx ? -Math.ceil((edge.top + edgePx - state.y) / 6) : state.y > edge.bottom - edgePx ? Math.ceil((state.y - (edge.bottom - edgePx)) / 6) : 0
      if (speed) {
        box.scrollTop += speed
        place()
      }
    }
    state.frame = requestAnimationFrame(tick)
  }

  function begin() {
    const state = live.current
    if (!state || state.active) return
    state.active = true
    state.top = state.element.offsetTop
    state.scroll = scroller()?.scrollTop ?? 0
    state.order = state.kind === 'favorite' ? arranged.favorites.map((item) => item.path) : state.kind === 'group' ? arranged.groups.map((item) => item.path) : undefined
    try { wrap.current?.setPointerCapture(state.pointer) } catch { /* the pointer already left */ }
    try { navigator.vibrate?.(8) } catch { /* no buzz here */ }
    setOrder(state.order)
    setCarry({ kind: state.kind, key: state.key })
    state.frame = requestAnimationFrame(tick)
  }

  function end(commit: boolean) {
    const state = live.current
    live.current = undefined
    if (!state) return
    clearTimeout(state.timer)
    if (state.frame !== undefined) cancelAnimationFrame(state.frame)
    if (!state.active) return
    state.element.style.transform = ''
    try { wrap.current?.releasePointerCapture(state.pointer) } catch { /* already let go */ }
    // The press that carried a card is not also a tap on it.
    swallow.current = true
    setTimeout(() => { swallow.current = false }, 400)
    setCarry(undefined)
    setOrder(undefined)
    if (!commit) return
    if (state.kind === 'note') {
      if (state.over === favoritesDrop) onFavorite(state.key)
      else if (state.over) onInto(state.key, state.over)
      return
    }
    const was = (state.kind === 'favorite' ? arranged.favorites : arranged.groups).map((item) => item.path)
    if (state.order && state.order.join('\n') !== was.join('\n')) (state.kind === 'favorite' ? onFavorites : onGroups)(state.order)
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canArrange || live.current || (event.pointerType === 'mouse' && event.button !== 0)) return
    const element = (event.target as HTMLElement).closest<HTMLElement>('[data-kind]')
    if (!element || !element.dataset.key) return
    live.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, startY: event.clientY, element, kind: element.dataset.kind as Kind, key: element.dataset.key, active: false, top: 0, scroll: 0 }
    if (event.pointerType !== 'mouse') live.current.timer = setTimeout(begin, holdMs)
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    const state = live.current
    if (!state || event.pointerId !== state.pointer) return
    if (!state.active) {
      if (Math.hypot(event.clientX - state.x, event.clientY - state.startY) < slopPx) return
      if (event.pointerType !== 'mouse') return end(false)
      begin()
    }
    state.x = event.clientX
    state.y = event.clientY
    place()
  }

  // A finger carrying a card must not also scroll the list. Only a listener that is not passive can say so.
  useEffect(() => {
    const element = wrap.current
    if (!element) return
    const hold = (event: TouchEvent) => { if (live.current?.active && event.cancelable) event.preventDefault() }
    const menu = (event: Event) => { if (live.current) event.preventDefault() }
    element.addEventListener('touchmove', hold, { passive: false })
    element.addEventListener('contextmenu', menu)
    return () => {
      element.removeEventListener('touchmove', hold)
      element.removeEventListener('contextmenu', menu)
      const state = live.current
      live.current = undefined
      clearTimeout(state?.timer)
      if (state?.frame !== undefined) cancelAnimationFrame(state.frame)
    }
  }, [])

  const carried = (kind: Kind, key: string) => (carry?.kind === kind && carry.key === key ? ' is-carried' : '')
  const dropping = carry?.kind === 'note'
  const item = (kind: Kind, key: string) => (canArrange ? { 'data-kind': kind, 'data-key': key } : {})

  return <div ref={wrap} className={`notes-arrange${carry ? ' is-carrying' : ''}`} onPointerDown={down} onPointerMove={move} onPointerUp={() => end(true)} onPointerCancel={() => end(false)}
    onClickCapture={(event) => { if (swallow.current) { swallow.current = false; event.preventDefault(); event.stopPropagation() } }}>
    {dropping && above && <div className="notes-above"><div className={`note-card notes-drop${carry.over === above.path ? ' is-over' : ''}`} data-drop={above.path}><Icon name="back" size={18} /><span className="note-card-title">{above.name}</span></div></div>}
    {favorites.length > 0 && <>
      <h2 className="notes-label">favorites</h2>
      <ul className={`notes-list${dropping && carry.over === favoritesDrop ? ' is-over' : ''}`} aria-label="favorites" {...(dropping && !arranged.favorites.some((note) => note.path === carry.key) ? { 'data-drop': favoritesDrop } : {})}>
        {favorites.map((note) => <li key={note.path} className={carried('favorite', note.path)} {...item('favorite', note.path)}>
          <button className="note-card" type="button" onClick={() => onOpen(note.path)}><span className="note-card-title">{note.title}</span><span className="note-card-star"><Icon name="star" size={16} /></span></button>
        </li>)}
      </ul>
      {(groups.length > 0 || arranged.notes.length > 0) && <h2 className="notes-label">{label}</h2>}
    </>}
    {(groups.length > 0 || arranged.notes.length > 0) && <ul className="notes-list" aria-label={label}>
      {groups.map((group) => <li key={group.path} className={carried('group', group.path)} {...item('group', group.path)}>
        <button className={`note-card note-group${dropping && carry.over === group.path ? ' is-over' : ''}`} type="button" {...(canArrange && !inJournal(group.path) ? { 'data-drop': group.path } : {})} onClick={() => onFolder(group.path)}><span className="note-card-title">{group.name}</span><small>{group.count}</small></button>
      </li>)}
      {arranged.notes.map((note) => <li key={note.path} className={carried('note', note.path)} {...item('note', note.path)}>
        <button className="note-card" type="button" onClick={() => onOpen(note.path)}><span className="note-card-title">{note.title}</span></button>
      </li>)}
    </ul>}
  </div>
}
