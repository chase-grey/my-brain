import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Icon } from './navIcons'
import { duration } from './format'
import type { Task } from './domain/types'

export function Card({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children?: ReactNode; className?: string }) {
  return <section className={`card ${className}`.trim()}>
    {(title || aside) && <header className="card-head">{title && <h2>{title}</h2>}{aside}</header>}
    {children}
  </section>
}

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean }

export function Menu({ label = 'more', items, align = 'end', children, controls }: { label?: string; items: MenuItem[]; align?: 'start' | 'end'; children?: ReactNode; /** Pickers shown above the items; choosing in one leaves the menu open. */ controls?: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const element = details.current
    if (!element) return
    const close = (event: Event) => {
      if (!element.open || element.contains(event.target as Node)) return
      element.open = false
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])
  return <details className={`menu menu-${align}`} ref={details}>
    <summary aria-label={label} title={label}>{children ?? <Icon name="more" />}</summary>
    <div className="menu-list" role="menu">
      {controls}
      {items.map((item) => <button key={item.label} role="menuitem" type="button" disabled={item.disabled} onClick={() => { details.current!.open = false; item.onSelect() }}>{item.label}</button>)}
    </div>
  </details>
}

/** Motion is on: a browser that can say so, and a person who has not asked for less of it. */
export function motionOn(): boolean {
  return typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function Toggle({ done, label, onToggle }: { done: boolean; label: string; onToggle: () => void }) {
  // The check pops only when it was just ticked here, never for one that was already done when the list was drawn.
  const [ticked, setTicked] = useState(false)
  return <button className={`toggle${done ? ' is-done' : ''}${done && ticked ? ' is-ticked' : ''}`} type="button" aria-pressed={done} aria-label={label} onClick={() => { setTicked(!done); onToggle() }}><span>{done && <Icon name="check" size={14} />}</span></button>
}

/** How long a ticked task stays to be seen done before it leaves its list (AGENTS.md, "motion"). The row's animation in styles.css runs to the same length. */
export const leaveMs = 640

export function TaskRow({ task, done, hint, onToggle, onOpen }: { task: Task; done: boolean; hint?: string; onToggle: () => void; onOpen?: () => void }) {
  const row = useRef<HTMLLIElement>(null)
  const [leaving, setLeaving] = useState<number>()
  const latest = useRef(onToggle)
  latest.current = onToggle
  // What is still owed when the row goes away early (another screen opened mid-animation): the tick itself.
  const owed = useRef<() => void>(undefined)
  useEffect(() => () => owed.current?.(), [])
  useEffect(() => { if (done) setLeaving(undefined) }, [done])

  function toggle() {
    if (leaving !== undefined) {
      // A second tap while it is leaving takes the tick back before anything was saved.
      owed.current = undefined
      setLeaving(undefined)
      return
    }
    if (done || !motionOn()) return onToggle()
    setLeaving(row.current?.offsetHeight ?? 0)
  }

  useEffect(() => {
    if (leaving === undefined) return
    const finish = () => { owed.current = undefined; latest.current() }
    owed.current = finish
    const timer = setTimeout(() => {
      if (owed.current !== finish) return
      finish()
      setLeaving(undefined)
    }, leaveMs)
    return () => clearTimeout(timer)
  }, [leaving])

  const shownDone = done || leaving !== undefined
  return <li ref={row} className={`row${shownDone ? ' is-done' : ''}${leaving !== undefined ? ' is-leaving' : ''}`} style={leaving !== undefined ? { '--row-h': `${leaving}px` } as CSSProperties : undefined}>
    <Toggle done={shownDone} label={`${shownDone ? 'undo' : 'complete'} ${task.title}`} onToggle={toggle} />
    {onOpen
      ? <button className="row-main" type="button" onClick={onOpen}><span className="row-title">{task.title}</span>{hint && <small>{hint}</small>}</button>
      : <div className="row-main"><span className="row-title">{task.title}</span>{hint && <small>{hint}</small>}</div>}
    <span className="row-meta">{duration(task.estimateMin)}</span>
  </li>
}

export function Segmented<T extends string | number>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  return <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => <button key={String(option.value)} type="button" aria-pressed={value === option.value} className={value === option.value ? 'selected' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>
}

export function Chips<T extends string>({ label, options, values, onToggle }: { label: string; options: { value: T; label: string }[]; values: T[]; onToggle: (value: T) => void }) {
  return <div className="chips" role="group" aria-label={label}>
    {options.map((option) => <button key={option.value} type="button" aria-pressed={values.includes(option.value)} className={values.includes(option.value) ? 'selected' : ''} onClick={() => onToggle(option.value)}>{option.label}</button>)}
  </div>
}

export function Field({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`field ${className}`.trim()}><span>{label}</span>{children}</label>
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog className="sheet" ref={dialog} aria-label={title} onCancel={onClose} onClose={onClose} onClick={(event) => { if (event.target === dialog.current) onClose() }}>
    <div className="sheet-body"><h2>{title}</h2>{children}</div>
  </dialog>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>
}

/** A list that is empty because everything on it was dealt with: the accent dot with the check cut out, no words (~/.claude/patterns/empty-states.md). */
export function Done({ label }: { label: string }) {
  const cut = useId()
  return <div className="done">
    <svg viewBox="0 0 100 100" role="img" aria-label={label}>
      <mask id={cut}><rect width="100" height="100" fill="#fff" /><path d="M29 52.5 43.5 67 72 36" fill="none" stroke="#000" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" /></mask>
      <circle cx="50" cy="50" r="50" mask={`url(#${cut})`} />
    </svg>
  </div>
}
