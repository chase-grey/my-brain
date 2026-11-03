import { useEffect, useRef, type ReactNode } from 'react'
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

export function Menu({ label = 'more', items, align = 'end', children }: { label?: string; items: MenuItem[]; align?: 'start' | 'end'; children?: ReactNode }) {
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
      {items.map((item) => <button key={item.label} role="menuitem" type="button" disabled={item.disabled} onClick={() => { details.current!.open = false; item.onSelect() }}>{item.label}</button>)}
    </div>
  </details>
}

export function Toggle({ done, label, onToggle }: { done: boolean; label: string; onToggle: () => void }) {
  return <button className={`toggle${done ? ' is-done' : ''}`} type="button" aria-pressed={done} aria-label={label} onClick={onToggle}><span>{done && <Icon name="check" size={14} />}</span></button>
}

export function TaskRow({ task, done, hint, onToggle, onOpen }: { task: Task; done: boolean; hint?: string; onToggle: () => void; onOpen?: () => void }) {
  return <li className={`row${done ? ' is-done' : ''}`}>
    <Toggle done={done} label={`${done ? 'undo' : 'complete'} ${task.title}`} onToggle={onToggle} />
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
