import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { WorkBridgeProvider } from '../data/workBridgeProvider'
import { shortDate, today } from '../format'
import { Card, Empty, Field, Menu, Sheet } from '../ui'
import { buildOutagePlan, outagePlanMarkdown, type OutagePlan } from '../work/outagePlan'
import { defaultWorkConfig, type Ignore, type IgnoreKind, type OutageWindow, type WorkConfig, type WorkFilters, type WorkSnapshot } from '../work/types'
import { buildDashboard, ignoredCount, type Dashboard, type Item, type Panel, type TeamBoard } from '../work/workDashboard'

type IgnoreDraft = { kind: IgnoreKind; id: string; title: string }

function capturedText(iso: string, now = new Date()): string {
  const captured = new Date(iso)
  const minutes = Math.round((now.getTime() - captured.getTime()) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return shortDate(iso.slice(0, 10))
}

function ItemRow({ item, onIgnore, onUnignore }: { item: Item; onIgnore?: (item: Item) => void; onUnignore?: (item: Item) => void }) {
  const ignored = item.hiddenReason?.startsWith('ignored')
  const actions = ignored
    ? [{ label: 'stop ignoring', onSelect: () => onUnignore?.(item) }]
    : [{ label: 'ignore', onSelect: () => onIgnore?.(item) }]
  return <li className={`row${item.loud ? ' is-loud' : ''}${item.hiddenReason ? ' is-hidden' : ''}`}>
    <a className="row-main" href={item.url} target="_blank" rel="noreferrer">
      <span className="row-title">{item.title}</span>
      <small className="row-sub">{item.hiddenReason ? `${item.hiddenReason} · ${item.meta}` : item.meta}</small>
    </a>
    {(onIgnore || onUnignore) && <Menu label={`actions for ${item.title}`} items={actions} />}
  </li>
}

const LIST_CAP = 8

function PanelList({ panel, showHidden, empty, onIgnore, onUnignore }: { panel: Panel; showHidden: boolean; empty: string; onIgnore: (item: Item) => void; onUnignore: (item: Item) => void }) {
  const [expanded, setExpanded] = useState(false)
  const items = showHidden ? [...panel.items, ...panel.hidden] : panel.items
  if (!items.length) return <Empty>{empty}</Empty>
  const shown = expanded ? items : items.slice(0, LIST_CAP)
  return <>
    <ul className="rows">{shown.map((item) => <ItemRow key={`${item.kind}-${item.id}-${item.meta}`} item={item} onIgnore={onIgnore} onUnignore={onUnignore} />)}</ul>
    {items.length > LIST_CAP && <button className="link-button" type="button" onClick={() => setExpanded((current) => !current)}>{expanded ? 'fewer' : `${items.length - LIST_CAP} more`}</button>}
  </>
}

function HiddenToggle({ panel, open, onToggle }: { panel: Panel; open: boolean; onToggle: () => void }) {
  if (!panel.hidden.length) return <span className="count">{panel.items.length}</span>
  const ignored = ignoredCount(panel)
  return <button className="pill" type="button" aria-pressed={open} onClick={onToggle}>
    {panel.items.length} · {panel.hidden.length} hidden{ignored ? ` (${ignored} ignored)` : ''}
  </button>
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div className="dash-section"><h3>{label}</h3>{children}</div>
}

export function WorkDashboardView({ provider = new WorkBridgeProvider(), currentDay = today(), initial }: { provider?: WorkBridgeProvider; currentDay?: string; initial?: { snapshot: WorkSnapshot; config: WorkConfig } }) {
  const [snapshot, setSnapshot] = useState<WorkSnapshot | undefined>(initial?.snapshot)
  const [config, setConfig] = useState<WorkConfig>(initial?.config ?? defaultWorkConfig)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(!initial)
  const [refreshing, setRefreshing] = useState(false)
  const [hiddenOpen, setHiddenOpen] = useState<Record<string, boolean>>({})
  const [ignoreDraft, setIgnoreDraft] = useState<IgnoreDraft>()
  const [ignoreNote, setIgnoreNote] = useState('')
  const [ignoreDays, setIgnoreDays] = useState<number | 'forever'>('forever')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [outageOpen, setOutageOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (initial) return
    let active = true
    Promise.all([provider.snapshot(), provider.config()]).then(([loadedSnapshot, loadedConfig]) => {
      if (!active) return
      setSnapshot(loadedSnapshot)
      setConfig(loadedConfig)
      setError(undefined)
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message.toLowerCase() : 'work bridge unavailable')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [provider, initial])

  const dashboard: Dashboard | undefined = useMemo(() => snapshot ? buildDashboard(snapshot, config, currentDay) : undefined, [snapshot, config, currentDay])
  const outage: OutagePlan | undefined = useMemo(() => snapshot && config.outage?.start && config.outage.end ? buildOutagePlan(snapshot, config, config.outage, currentDay) : undefined, [snapshot, config, currentDay])

  async function refresh(): Promise<void> {
    setRefreshing(true)
    try {
      setSnapshot(await provider.refreshSnapshot())
      setError(undefined)
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message.toLowerCase() : 'refresh failed')
    } finally {
      setRefreshing(false)
    }
  }

  async function applyConfig(action: () => Promise<WorkConfig>): Promise<void> {
    try {
      setConfig(await action())
      setError(undefined)
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message.toLowerCase() : 'could not save')
    }
  }

  function startIgnore(item: Item): void {
    setIgnoreDraft({ kind: item.kind, id: item.id, title: item.title })
    setIgnoreNote('')
    setIgnoreDays('forever')
  }

  function confirmIgnore(): void {
    if (!ignoreDraft) return
    const entry: Ignore = { kind: ignoreDraft.kind, id: ignoreDraft.id, note: ignoreNote.trim() || undefined }
    if (ignoreDays !== 'forever') {
      const until = new Date(`${currentDay}T12:00:00`)
      until.setDate(until.getDate() + ignoreDays)
      entry.until = until.toLocaleDateString('en-CA')
    }
    setIgnoreDraft(undefined)
    void applyConfig(() => provider.ignore(entry))
  }

  function unignore(item: Item): void {
    void applyConfig(() => provider.unignore(item.kind, item.id))
  }

  const toggleHidden = (key: string) => setHiddenOpen((current) => ({ ...current, [key]: !current[key] }))
  const panelProps = (key: string, panel: Panel) => ({ panel, showHidden: Boolean(hiddenOpen[key]), onIgnore: startIgnore, onUnignore: unignore })
  const headFor = (key: string, panel: Panel) => <HiddenToggle panel={panel} open={Boolean(hiddenOpen[key])} onToggle={() => toggleHidden(key)} />

  const menuItems = [
    { label: refreshing ? 'refreshing' : 'refresh now', onSelect: () => void refresh(), disabled: refreshing },
    { label: 'filters', onSelect: () => setFiltersOpen(true) },
    { label: config.outage ? 'change outage' : 'plan an outage', onSelect: () => setOutageOpen(true) },
  ]

  return <>
    <header className="view-head">
      <h1>dashboard</h1>
      {snapshot && <span className="count">{refreshing ? 'refreshing' : `data ${capturedText(snapshot.capturedAt)}`}</span>}
      <Menu items={menuItems} />
    </header>
    {loading && <Empty>loading</Empty>}
    {error && <p className="note">{error}{!snapshot && ' · start the work bridge with npm run bridge'}</p>}
    {dashboard?.errors.length ? <p className="note">some data did not load: {dashboard.errors.map((item) => item.split(':')[0]).join(', ')}</p> : null}

    {dashboard && <div className="dash">
      <Card className="dash-card is-attention" title="needs me" aside={headFor('needs', dashboard.needsMe)}>
        <PanelList {...panelProps('needs', dashboard.needsMe)} empty="nothing waiting on you" />
      </Card>

      <Card className="dash-card" title="waiting on others" aside={headFor('waiting', dashboard.waitingOn)}>
        <PanelList {...panelProps('waiting', dashboard.waitingOn)} empty="nothing out with other people" />
      </Card>

      {outage && <Card className="dash-card is-attention dash-outage" title={`out ${shortDate(outage.window.start)} to ${shortDate(outage.window.end)}`} aside={<span className="count">{outage.workdays} workdays</span>}>
        {outage.teamOut.length > 0 && <p className="note">also out: {outage.teamOut.map((item) => `${item.employeeName} ${shortDate(item.startOn)}`).join(', ')}</p>}
        {outage.sections.length === 0 && <Empty>nothing needs a backup</Empty>}
        {outage.sections.map((section) => <Section key={section.id} label={section.title}>
          <ul className="rows">{section.items.map((item) => <li key={`${item.kind}-${item.id}`} className="row">
            <a className="row-main" href={item.url} target="_blank" rel="noreferrer"><span className="row-title">{item.title}</span><small className="row-sub">{item.why}</small></a>
          </li>)}</ul>
        </Section>)}
        <div className="actions">
          <button className="secondary" type="button" onClick={() => { void navigator.clipboard?.writeText(outagePlanMarkdown(outage, dashboard.me.name)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }) }}>{copied ? 'copied' : 'copy plan'}</button>
          <button className="plain" type="button" onClick={() => void applyConfig(() => provider.saveConfig({ outage: null }))}>clear</button>
        </div>
      </Card>}

      <Card className="dash-card" title="my work">
        <Section label="dlgs">
          <PanelList {...panelProps('my-dlgs', dashboard.myDlgs)} empty="no open dlgs" />
          {dashboard.myDlgs.hidden.length > 0 && <button className="link-button" type="button" onClick={() => toggleHidden('my-dlgs')}>{hiddenOpen['my-dlgs'] ? 'hide idle' : `${dashboard.myDlgs.hidden.length} idle`}</button>}
        </Section>
        <Section label="projects">
          <PanelList {...panelProps('my-prjs', dashboard.myPrjs)} empty="no active projects" />
          {dashboard.myPrjs.hidden.length > 0 && <button className="link-button" type="button" onClick={() => toggleHidden('my-prjs')}>{hiddenOpen['my-prjs'] ? 'hide parked' : `${dashboard.myPrjs.hidden.length} parked`}</button>}
        </Section>
        <Section label="designs">
          <PanelList {...panelProps('my-designs', dashboard.myDesigns)} empty="no designs in flight" />
          {dashboard.myDesigns.hidden.length > 0 && <button className="link-button" type="button" onClick={() => toggleHidden('my-designs')}>{hiddenOpen['my-designs'] ? 'hide idle' : `${dashboard.myDesigns.hidden.length} idle`}</button>}
        </Section>
      </Card>

      {dashboard.team.map((board) => <TeamCard key={board.person.id} board={board} hiddenOpen={hiddenOpen} onToggle={toggleHidden} onIgnore={startIgnore} onUnignore={unignore} />)}

      {dashboard.products.map((product) => <ProductCards key={product.name} product={product} hiddenOpen={hiddenOpen} onToggle={toggleHidden} onIgnore={startIgnore} onUnignore={unignore} />)}
    </div>}

    {ignoreDraft && <Sheet title={`ignore ${ignoreDraft.title}`} onClose={() => setIgnoreDraft(undefined)}>
      <div className="stack">
        <Field label="why"><input value={ignoreNote} onChange={(event) => setIgnoreNote(event.target.value)} placeholder="old prototype" /></Field>
        <Field label="for">
          <div className="chips">
            {([['forever', 'forever'], [30, '30 days'], [90, '90 days']] as const).map(([value, label]) => <button key={label} type="button" className={ignoreDays === value ? 'selected' : ''} onClick={() => setIgnoreDays(value)}>{label}</button>)}
          </div>
        </Field>
        <div className="actions"><button className="primary" type="button" onClick={confirmIgnore}>ignore</button><button className="plain" type="button" onClick={() => setIgnoreDraft(undefined)}>cancel</button></div>
      </div>
    </Sheet>}

    {filtersOpen && <FiltersSheet config={config} onClose={() => setFiltersOpen(false)} onSave={(changes) => { setFiltersOpen(false); void applyConfig(() => provider.saveConfig(changes)) }} />}

    {outageOpen && <OutageSheet window={config.outage ?? { start: currentDay, end: currentDay }} onClose={() => setOutageOpen(false)} onSave={(window) => { setOutageOpen(false); void applyConfig(() => provider.saveConfig({ outage: window })) }} />}
  </>
}

function TeamCard({ board, hiddenOpen, onToggle, onIgnore, onUnignore }: { board: TeamBoard; hiddenOpen: Record<string, boolean>; onToggle: (key: string) => void; onIgnore: (item: Item) => void; onUnignore: (item: Item) => void }) {
  const key = (part: string) => `team-${board.person.id}-${part}`
  const out = board.outages[0]
  const list = (part: string, panel: Panel, empty: string, idleLabel: string) => <Section label={part}>
    <PanelList panel={panel} showHidden={Boolean(hiddenOpen[key(part)])} empty={empty} onIgnore={onIgnore} onUnignore={onUnignore} />
    {panel.hidden.length > 0 && <button className="link-button" type="button" onClick={() => onToggle(key(part))}>{hiddenOpen[key(part)] ? `hide ${idleLabel}` : `${panel.hidden.length} ${idleLabel}`}</button>}
  </Section>
  return <Card className="dash-card dash-team" title={board.person.name.toLowerCase()} aside={<span className="count">{board.hoursLogged}h logged{out ? ` · out ${shortDate(out.startOn)}` : ''}</span>}>
    {list('dlgs', board.dlgs, 'no live dlgs', 'parked')}
    {list('projects', board.prjs, 'no active projects', 'parked')}
    {list('designs', board.designs, 'no designs in flight', 'idle')}
    {list('qans', board.qans, 'no important fixes', 'low priority')}
  </Card>
}

function ProductCards({ product, hiddenOpen, onToggle, onIgnore, onUnignore }: { product: Dashboard['products'][number]; hiddenOpen: Record<string, boolean>; onToggle: (key: string) => void; onIgnore: (item: Item) => void; onUnignore: (item: Item) => void }) {
  const name = product.name.toLowerCase()
  const importantKey = `product-${product.name}-important`
  const prjKey = `product-${product.name}-prjs`
  const headline = product.summary.filter((row) => [1, 2, 4].includes(row.priorityId))
  return <>
    <Card className="dash-card dash-product" title={`${name} quality`} aside={<HiddenToggle panel={product.important} open={Boolean(hiddenOpen[importantKey])} onToggle={() => onToggle(importantKey)} />}>
      {headline.length > 0 && <table className="dash-table"><tbody>
        {headline.map((row) => <tr key={row.priorityId}><th scope="row">{row.priority.toLowerCase()}</th><td>{row.openCount} open</td><td>{row.escalated ? `${row.escalated} escalated` : ''}</td><td>{row.stale ? `${row.stale} over 30 days` : ''}</td></tr>)}
      </tbody></table>}
      <PanelList panel={product.important} showHidden={Boolean(hiddenOpen[importantKey])} empty="no important qans open" onIgnore={onIgnore} onUnignore={onUnignore} />
    </Card>
    <Card className="dash-card dash-product" title={`${name} projects`} aside={<HiddenToggle panel={product.prjs} open={Boolean(hiddenOpen[prjKey])} onToggle={() => onToggle(prjKey)} />}>
      {product.offTrack.items.length > 0 && <Section label="off track"><PanelList panel={product.offTrack} showHidden={false} empty="" onIgnore={onIgnore} onUnignore={onUnignore} /></Section>}
      <Section label="moving">
        <PanelList panel={{ items: product.prjs.items.filter((item) => !item.loud), hidden: product.prjs.hidden }} showHidden={Boolean(hiddenOpen[prjKey])} empty="nothing moving on the backlog" onIgnore={onIgnore} onUnignore={onUnignore} />
      </Section>
    </Card>
  </>
}

function FiltersSheet({ config, onClose, onSave }: { config: WorkConfig; onClose: () => void; onSave: (changes: Partial<WorkConfig>) => void }) {
  const [filters, setFilters] = useState<WorkFilters>(config.filters)
  const [products, setProducts] = useState(config.products.join(', '))
  const number = (key: keyof Omit<WorkFilters, 'qanPriorityIds' | 'optionalReviews'>, label: string) => <Field label={label}>
    <input type="number" min={0} value={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: Number(event.target.value) }))} />
  </Field>
  return <Sheet title="filters" onClose={onClose}>
    <div className="stack">
      <div className="grid-2">
        {number('teamActivityDays', 'hours logged within days')}
        {number('teamBatonDays', 'baton moved within days')}
        {number('pqaNearDays', 'pqa near when dev comp within days')}
        {number('designOptionalStaleDays', 'design idle after days')}
        {number('designOverdueGraceDays', 'design overdue grace days')}
        {number('reviewHorizonDays', 'show reviews due within days')}
        {number('qanStaleWorkdays', 'important qans after workdays')}
      </div>
      <label className="check"><input type="checkbox" checked={filters.optionalReviews} onChange={(event) => setFilters((current) => ({ ...current, optionalReviews: event.target.checked }))} /> show optional reviews</label>
      <Field label="products"><input value={products} onChange={(event) => setProducts(event.target.value)} /></Field>
      <div className="actions">
        <button className="primary" type="button" onClick={() => onSave({ filters, products: products.split(',').map((item) => item.trim()).filter(Boolean) })}>save</button>
        <button className="plain" type="button" onClick={onClose}>cancel</button>
      </div>
    </div>
  </Sheet>
}

function OutageSheet({ window, onClose, onSave }: { window: OutageWindow; onClose: () => void; onSave: (window: OutageWindow) => void }) {
  const [start, setStart] = useState(window.start)
  const [end, setEnd] = useState(window.end)
  return <Sheet title="plan an outage" onClose={onClose}>
    <div className="stack">
      <div className="grid-2">
        <Field label="first day out"><input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></Field>
        <Field label="last day out"><input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></Field>
      </div>
      <div className="actions">
        <button className="primary" type="button" disabled={!start || !end || end < start} onClick={() => onSave({ start, end })}>show what needs a backup</button>
        <button className="plain" type="button" onClick={onClose}>cancel</button>
      </div>
    </div>
  </Sheet>
}
