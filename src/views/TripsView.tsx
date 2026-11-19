import { useEffect, useMemo, useRef, useState } from 'react'
import type { VaultStore } from '../companion/githubVault'
import { shortDate } from '../format'
import { Icon } from '../navIcons'
import { addItem, addSection, packingItems, packingProgress, parsePacking, removeItem, serializePacking, setItemDone, type PackingList } from '../trips/packing'
import { PackingSync, type StorageLike } from '../trips/packingSync'
import { alwaysList, cleanName, createTrip, defaultListHead, defaultListPath, deleteTrip, loadOverview, parseTrip, tripListHead, tripNights, tripPaths, type Trip, type TripOverview } from '../trips/trip'
import { Card, Chips, Empty, Field, Menu, Toggle } from '../ui'

/** The vault the screens read. `invalidate` drops a cached file listing so changes made elsewhere show up. */
export type TripVault = VaultStore & { invalidate?: () => void }

type Route = { screen: 'list' } | { screen: 'new' } | { screen: 'trip'; folder: string } | { screen: 'default'; name: string }

const flushAfterMs = 1500

function routeFromHash(): Route {
  if (typeof location === 'undefined') return { screen: 'list' }
  const [name, screen, ...rest] = location.hash.replace(/^#/, '').split('/')
  const id = decodeURIComponent(rest.join('/'))
  if (name !== 'trips') return { screen: 'list' }
  if (screen === 'new') return { screen: 'new' }
  if (screen === 'trip' && id) return { screen: 'trip', folder: id }
  if (screen === 'default' && id) return { screen: 'default', name: id }
  return { screen: 'list' }
}

function hashFor(route: Route): string {
  if (route.screen === 'trip') return `#trips/trip/${encodeURIComponent(route.folder)}`
  if (route.screen === 'default') return `#trips/default/${encodeURIComponent(route.name)}`
  return route.screen === 'new' ? '#trips/new' : '#trips'
}

function browserStorage(): StorageLike | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : 'something went wrong'
}

function dateRange(trip: Pick<Trip, 'start' | 'end'>): string {
  if (!trip.start) return ''
  return trip.end && trip.end !== trip.start ? `${shortDate(trip.start)} – ${shortDate(trip.end)}` : shortDate(trip.start)
}

function AddLine({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('')
  function submit(event: React.FormEvent) {
    event.preventDefault()
    const clean = text.trim()
    if (!clean) return
    onAdd(clean)
    setText('')
  }
  return <form className="add-line" onSubmit={submit}><input aria-label={label} value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} /><button className="primary" type="submit" disabled={!text.trim()}>add</button></form>
}

/** One packing list, saved on the device at every change and pushed to the vault shortly after. */
function PackingEditor({ sync, path, checkable, newHead, onProgress }: { sync: PackingSync; path: string; checkable: boolean; newHead: string[]; onProgress?: (unsynced: boolean) => void }) {
  const read = () => { const cached = sync.cached(path); return cached === undefined ? { head: newHead, sections: [] } : parsePacking(cached) }
  const [list, setList] = useState<PackingList>(read)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  function flush(): void {
    clearTimeout(timer.current)
    timer.current = undefined
    if (!sync.pending().length) return
    void sync.flush().then(() => { setList(read()); onProgress?.(false) }, () => onProgress?.(true))
  }

  useEffect(() => {
    let live = true
    void sync.refresh(path).then(() => { if (live) { setList(read()); onProgress?.(false) } }, () => { if (live) onProgress?.(true) })
    const onHide = () => { if (document.visibilityState === 'hidden') flush() }
    document.addEventListener('visibilitychange', onHide)
    return () => { live = false; document.removeEventListener('visibilitychange', onHide); flush() }
  }, [path])

  function change(next: PackingList): void {
    if (next === list) return
    setList(next)
    sync.save(path, serializePacking(next))
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, flushAfterMs)
  }

  const sections = list.sections.length ? list.sections : [{ heading: '', title: '', lines: [] }]
  return <>
    {sections.map((section, index) => {
      const items = section.lines.filter((line) => line.kind === 'item')
      return <Card key={index} title={section.title || undefined}>
        {items.length > 0 && <ul className="rows">{items.map((item) => <li className={`row${checkable && item.done ? ' is-done' : ''}`} key={item.text}>
          {checkable && <Toggle done={item.done} label={`${item.done ? 'unpack' : 'pack'} ${item.text}`} onToggle={() => change(setItemDone(list, item.text, !item.done))} />}
          <div className="row-main"><span className="row-title">{item.text}</span></div>
          <button className="row-remove" type="button" aria-label={`remove ${item.text}`} title="remove" onClick={() => change(removeItem(list, item.text))}><Icon name="close" size={16} /></button>
        </li>)}</ul>}
        <AddLine label={section.title ? `add to ${section.title}` : 'add an item'} placeholder="add an item" onAdd={(text) => change(addItem(list, text, section.title))} />
      </Card>
    })}
    <AddLine label="add a section" placeholder="new section" onAdd={(title) => change(addSection(list, title))} />
  </>
}

function TripList({ vault, sync, currentDay, onOpen }: { vault: TripVault; sync: PackingSync; currentDay: string; onOpen: (route: Route) => void }) {
  const [overview, setOverview] = useState<TripOverview | undefined>(() => sync.overview())
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    async function load(): Promise<void> {
      try {
        await sync.flush().catch(() => undefined)
        vault.invalidate?.()
        const next = await loadOverview(vault, currentDay, (path) => sync.refresh(path))
        sync.setOverview(next)
        if (live) { setOverview(next); setError(undefined) }
      } catch (failure) {
        if (live) setError(message(failure))
      }
    }
    void load()
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { live = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [vault, sync, currentDay])

  const trips = overview?.trips ?? []
  const defaults = overview?.defaults ?? []
  const lists = defaults.some((list) => list.name === alwaysList) ? defaults : [{ name: alwaysList, total: 0 }, ...defaults]

  return <>
    <header className="view-head"><h1>trips</h1>{error && overview && <span className="row-meta">not synced</span>}<button className="icon-button" type="button" aria-label="new trip" title="new trip" onClick={() => onOpen({ screen: 'new' })}><Icon name="plus" /></button></header>
    <Card>
      {trips.length
        ? <ul className="rows">{trips.map((trip) => {
          const cached = sync.cached(tripPaths(trip.folder).packing)
          const progress = cached === undefined ? { done: trip.packed, total: trip.total } : packingProgress(parsePacking(cached))
          const past = Boolean(trip.end && trip.end < currentDay)
          return <li className={`row${past ? ' is-past' : ''}`} key={trip.folder}><button className="row-main" type="button" onClick={() => onOpen({ screen: 'trip', folder: trip.folder })}><span className="row-title">{trip.destination}</span><small>{[dateRange(trip), progress.total ? `${progress.done} of ${progress.total} packed` : ''].filter(Boolean).join(' · ')}</small></button></li>
        })}</ul>
        : <Empty>{error && !overview ? error : overview ? 'no trips yet' : 'loading'}</Empty>}
    </Card>
    <Card title="packing defaults">
      <ul className="rows">{lists.map((list) => {
        const cached = sync.cached(defaultListPath(list.name))
        const total = cached === undefined ? list.total : packingItems(parsePacking(cached)).length
        return <li className="row" key={list.name}><button className="row-main" type="button" onClick={() => onOpen({ screen: 'default', name: list.name })}><span className="row-title">{list.name}</span></button><span className="row-meta">{total}</span></li>
      })}</ul>
      <AddLine label="add a trip type" placeholder="new trip type" onAdd={(name) => { const clean = cleanName(name); if (clean) onOpen({ screen: 'default', name: clean }) }} />
    </Card>
  </>
}

function NewTrip({ vault, sync, onCreated, onCancel }: { vault: TripVault; sync: PackingSync; onCreated: (folder: string) => void; onCancel: () => void }) {
  const [destination, setDestination] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [types, setTypes] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const options = (sync.overview()?.defaults ?? []).filter((list) => list.name !== alwaysList).map((list) => ({ value: list.name, label: list.name }))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(undefined)
    try {
      const { trip } = await createTrip(vault, { destination, start, end: end || start, types })
      vault.invalidate?.()
      onCreated(trip.folder)
    } catch (failure) {
      setError(message(failure))
      setSaving(false)
    }
  }

  return <>
    <header className="view-head"><button className="icon-button" type="button" aria-label="back to trips" onClick={onCancel}><Icon name="back" /></button><h1>new trip</h1></header>
    <Card>
      <form className="stack" onSubmit={(event) => void submit(event)}>
        <Field label="destination"><input value={destination} onChange={(event) => setDestination(event.target.value)} required /></Field>
        <Field label="start"><input type="date" value={start} onChange={(event) => setStart(event.target.value)} required /></Field>
        <Field label="end"><input type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} /></Field>
        {options.length > 0 && <Chips label="trip types" options={options} values={types} onToggle={(value) => setTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />}
        {error && <p className="empty">{error}</p>}
        <div className="actions"><button className="primary" type="submit" disabled={saving || !destination.trim() || !start}>create</button><button className="secondary" type="button" onClick={onCancel}>cancel</button></div>
      </form>
    </Card>
  </>
}

function TripPage({ vault, sync, folder, onBack }: { vault: TripVault; sync: PackingSync; folder: string; onBack: () => void }) {
  const paths = tripPaths(folder)
  const [trip, setTrip] = useState<Trip>(() => sync.overview()?.trips.find((item) => item.folder === folder) ?? parseTrip(folder, sync.cached(paths.trip) ?? ''))
  const [unsynced, setUnsynced] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    void sync.refresh(paths.trip).then((note) => { if (live && note !== undefined) setTrip(parseTrip(folder, note)) }, () => undefined)
    return () => { live = false }
  }, [folder])

  async function remove(): Promise<void> {
    if (!confirm(`delete ${trip.destination}?`)) return
    try {
      vault.invalidate?.()
      await deleteTrip(vault, folder)
      sync.forget(paths.trip)
      sync.forget(paths.packing)
      onBack()
    } catch (failure) {
      setError(message(failure))
    }
  }

  const nights = tripNights(trip)
  return <>
    <header className="view-head"><button className="icon-button" type="button" aria-label="back to trips" onClick={onBack}><Icon name="back" /></button><h1>{trip.destination}</h1>{unsynced && <span className="row-meta">not synced</span>}<Menu items={[{ label: 'delete trip', onSelect: () => void remove() }]} /></header>
    {trip.start && <p className="row-meta">{[dateRange(trip), nights ? `${nights} ${nights === 1 ? 'night' : 'nights'}` : '', ...trip.types].filter(Boolean).join(' · ')}</p>}
    {error && <p className="empty">{error}</p>}
    <PackingEditor key={paths.packing} sync={sync} path={paths.packing} checkable newHead={tripListHead} onProgress={setUnsynced} />
  </>
}

function DefaultListPage({ vault, sync, name, onBack }: { vault: TripVault; sync: PackingSync; name: string; onBack: () => void }) {
  const path = defaultListPath(name)
  const [unsynced, setUnsynced] = useState(false)
  const [error, setError] = useState<string>()

  async function remove(): Promise<void> {
    if (!confirm(`delete ${name}?`)) return
    try {
      vault.invalidate?.()
      if ((await vault.listNotes()).some((note) => note.path === path)) await vault.deleteNote(path)
      sync.forget(path)
      onBack()
    } catch (failure) {
      setError(message(failure))
    }
  }

  return <>
    <header className="view-head"><button className="icon-button" type="button" aria-label="back to trips" onClick={onBack}><Icon name="back" /></button><h1>{name}</h1>{unsynced && <span className="row-meta">not synced</span>}<Menu items={[{ label: 'delete list', onSelect: () => void remove() }]} /></header>
    {error && <p className="empty">{error}</p>}
    <PackingEditor key={path} sync={sync} path={path} checkable={false} newHead={defaultListHead} onProgress={setUnsynced} />
  </>
}

export function TripsView({ vault, storage, currentDay, onSettings }: { vault?: TripVault; storage?: StorageLike; currentDay: string; onSettings: () => void }) {
  const [route, setRoute] = useState<Route>(routeFromHash)
  const depth = useRef(0)
  const sync = useMemo(() => vault ? new PackingSync(vault, storage ?? browserStorage()) : undefined, [vault, storage])

  useEffect(() => {
    const onPop = () => { depth.current = Math.max(0, depth.current - 1); setRoute(routeFromHash()) }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function open(next: Route, replace = false): void {
    setRoute(next)
    if (replace) history.replaceState(null, '', hashFor(next))
    else { history.pushState(null, '', hashFor(next)); depth.current += 1 }
  }

  function back(): void {
    if (depth.current > 0) { history.back(); return }
    open({ screen: 'list' }, true)
  }

  if (!vault || !sync) return <>
    <header className="view-head"><h1>trips</h1></header>
    <Empty>no vault · <button className="link" type="button" onClick={onSettings}>add one in settings</button></Empty>
  </>

  if (route.screen === 'new') return <NewTrip vault={vault} sync={sync} onCreated={(folder) => open({ screen: 'trip', folder }, true)} onCancel={back} />
  if (route.screen === 'trip') return <TripPage key={route.folder} vault={vault} sync={sync} folder={route.folder} onBack={back} />
  if (route.screen === 'default') return <DefaultListPage key={route.name} vault={vault} sync={sync} name={route.name} onBack={back} />
  return <TripList vault={vault} sync={sync} currentDay={currentDay} onOpen={open} />
}
