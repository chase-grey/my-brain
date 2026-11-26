import { useState } from 'react'
import {
  CHECK_AREAS, HAPPY, areaReading, challengeText, happyLabels, mindFacts, projectThingId, projectWork, thingsOf,
  withBook, withBookFinished, withChallenge, withHappy, withLog, withReadDay, withTap, withThing, withoutBook, withoutChallenge, withoutLog, withoutThing,
  type AreaContext, type AreaReading, type AreaThing, type Challenge, type ChallengeCounts, type ChallengeStanding, type CheckArea, type Happy,
} from '../domain/areas'
import type { RingArc } from '../domain/lifeRing'
import { stepsLeftMin } from '../domain/projectSteps'
import type { Task } from '../domain/types'
import { duration, newId, shortDate } from '../format'
import { Icon } from '../navIcons'
import { latestRestCheckIn, withRestCheckIn, withSawSomeone, type ProductState } from '../productState'
import { Card, Field, Menu, Segmented, Sheet, Toggle } from '../ui'
import { wheelHue } from './LifeWheel'
import { Bar } from './ProgressView'

type SetProduct = React.Dispatch<React.SetStateAction<ProductState>>

const happyOptions: { value: Happy | ''; label: string }[] = HAPPY.map((value) => ({ value, label: happyLabels[value] }))
const day = (value: string) => shortDate(value).replace(/^[a-z]+, /, '')
const contextOf = (product: ProductState, journalDays: string[]): AreaContext => ({ projects: product.projects, activities: product.activities, journalDays })

function HappyPick({ thing, today, onProduct }: { thing: AreaThing; today: string; onProduct: SetProduct }) {
  return <Segmented label={`happy with how often · ${thing.title}`} options={happyOptions} value={thing.happy ?? ''} onChange={(value) => { if (value) onProduct((current) => withHappy(current, thing, value, today)) }} />
}

function ThingSheet({ area, thing, today, onClose, onProduct }: { area: CheckArea; thing?: AreaThing; today: string; onClose: () => void; onProduct: SetProduct }) {
  const [title, setTitle] = useState(thing?.title ?? '')
  const [streak, setStreak] = useState(thing?.streak !== undefined ? String(thing.streak) : '')

  function save(event: React.FormEvent): void {
    event.preventDefault()
    const name = title.trim()
    if (!name) return
    const count = streak.trim() && Number.isFinite(Number(streak)) ? Math.max(0, Math.round(Number(streak))) : undefined
    const { streak: _streak, streakOn: _streakOn, ...kept } = thing ?? { id: newId('thing'), area, title: name }
    // The streak's date moves only when the number does.
    const run = count === undefined ? {} : { streak: count, streakOn: count === thing?.streak && thing.streakOn ? thing.streakOn : today }
    onProduct((current) => withThing(current, { ...kept, title: name, ...run }))
    onClose()
  }

  return <Sheet title={thing ? thing.title : `add to ${area}`} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <Field label="name"><input autoFocus={!thing} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <Field label="streak"><input inputMode="numeric" min="0" type="number" value={streak} onChange={(event) => setStreak(event.target.value)} /></Field>
      <div className="actions">
        <button className="primary" type="submit" disabled={!title.trim()}>save</button>
        {thing && <button className="plain" type="button" onClick={() => { onProduct((current) => withoutThing(current, thing.id)); onClose() }}>remove</button>}
        <button className="plain" type="button" onClick={onClose}>cancel</button>
      </div>
    </form>
  </Sheet>
}

const countsLabels: Record<ChallengeCounts, string> = { logs: 'what i mark', journal: 'journal days', books: 'books finished' }

function ChallengeSheet({ area, challenge, things, today, context, onClose, onProduct }: { area: CheckArea; challenge?: Challenge; things: AreaThing[]; today: string; context: AreaContext; onClose: () => void; onProduct: SetProduct }) {
  const [title, setTitle] = useState(challenge?.title ?? '')
  const [target, setTarget] = useState(challenge ? String(challenge.target) : '')
  const [by, setBy] = useState(challenge?.by ?? '')
  const [thingId, setThingId] = useState(challenge?.thingId ?? '')
  const [counts, setCounts] = useState<ChallengeCounts>(challenge?.counts ?? 'logs')
  const ready = title.trim() && Number(target) >= 1

  function save(event: React.FormEvent): void {
    event.preventDefault()
    if (!ready) return
    const next: Challenge = {
      id: challenge?.id ?? newId('challenge'), area, title: title.trim(), target: Math.round(Number(target)), counts,
      startOn: challenge?.startOn ?? today, taps: challenge?.taps ?? 0,
      ...(by ? { by } : {}), ...(thingId && counts === 'logs' ? { thingId } : {}), ...(challenge?.metOn ? { metOn: challenge.metOn } : {}),
    }
    onProduct((current) => withChallenge(current, next, today, context))
    onClose()
  }

  return <Sheet title={challenge ? 'edit challenge' : 'challenge'} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      <Field label="what"><input autoFocus={!challenge} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <div className="grid-2">
        <Field label="how many"><input inputMode="numeric" min="1" type="number" value={target} onChange={(event) => setTarget(event.target.value)} /></Field>
        <Field label="by"><input type="date" value={by} onChange={(event) => setBy(event.target.value)} /></Field>
      </div>
      {area === 'mind' && <Field label="counts"><select value={counts} onChange={(event) => setCounts(event.target.value as ChallengeCounts)}>{(Object.keys(countsLabels) as ChallengeCounts[]).map((item) => <option key={item} value={item}>{countsLabels[item]}</option>)}</select></Field>}
      {things.length > 0 && counts === 'logs' && <Field label="for"><select value={thingId} onChange={(event) => setThingId(event.target.value)}><option value="">all of {area}</option>{things.map((thing) => <option key={thing.id} value={thing.id}>{thing.title}</option>)}</select></Field>}
      <div className="actions">
        <button className="primary" type="submit" disabled={!ready}>save</button>
        {challenge && <button className="plain" type="button" onClick={() => { onProduct((current) => withoutChallenge(current, challenge.id)); onClose() }}>remove</button>}
        <button className="plain" type="button" onClick={onClose}>cancel</button>
      </div>
    </form>
  </Sheet>
}

function ChallengeRow({ standing, today, context, onOpen, onProduct }: { standing: ChallengeStanding; today: string; context: AreaContext; onOpen: () => void; onProduct: SetProduct }) {
  const { challenge, state, progress } = standing
  const loud = state === 'behind'
  return <li className={`goal challenge${loud ? ' is-loud' : ''}`}>
    <div className="challenge-head">
      <button type="button" onClick={onOpen}><span className="row-title">{challenge.title}</span><small>{challengeText(standing)}{challenge.by ? ` · by ${day(challenge.by)}` : ''}</small></button>
      {challenge.counts === 'logs' && state !== 'met' && <button className="secondary small" type="button" aria-label={`one more · ${challenge.title}`} onClick={() => onProduct((current) => withTap(current, challenge.id, 1, today, context))}>+1</button>}
    </div>
    <Bar fraction={progress} loud={loud} />
  </li>
}

/** "saw someone": a name, with the people seen lately one tap away. */
export function SawSomeoneSheet({ product, today, onClose, onProduct }: { product: ProductState; today: string; onClose: () => void; onProduct: SetProduct }) {
  const [person, setPerson] = useState('')
  const [thingId, setThingId] = useState('')
  const things = thingsOf('connection', product)
  const recent = [...product.people].filter((item) => item.lastSeenOn).sort((a, b) => b.lastSeenOn!.localeCompare(a.lastSeenOn!)).slice(0, 8)
  const save = (name: string) => {
    if (!name.trim()) return
    onProduct((current) => withSawSomeone(current, name.trim(), today, thingId || undefined))
    onClose()
  }
  return <Sheet title="saw someone" onClose={onClose}>
    <form className="stack" onSubmit={(event) => { event.preventDefault(); save(person) }}>
      {things.length > 0 && <Field label="for"><select value={thingId} onChange={(event) => setThingId(event.target.value)}><option value="">all of connection</option>{things.map((thing) => <option key={thing.id} value={thing.id}>{thing.title}</option>)}</select></Field>}
      {recent.length > 0 && <div className="chips" role="group" aria-label="recent">{recent.map((item) => <button key={item.id} type="button" onClick={() => save(item.displayName)}>{item.displayName}</button>)}</div>}
      <Field label="who"><input autoFocus={!recent.length} value={person} onChange={(event) => setPerson(event.target.value)} /></Field>
      <div className="actions"><button className="primary" type="submit" disabled={!person.trim()}>save</button><button className="plain" type="button" onClick={onClose}>cancel</button></div>
    </form>
  </Sheet>
}

/** The optional log: which area, which thing, and a few words. Never required for a slice to fill. */
export function AreaLogSheet({ area: preset, product, today, journalDays = [], onClose, onProduct }: { area?: CheckArea; product: ProductState; today: string; journalDays?: string[]; onClose: () => void; onProduct: SetProduct }) {
  const areas = CHECK_AREAS.filter((item) => item !== 'connection' && !product.ringOff.includes(item))
  const [area, setArea] = useState<CheckArea>(preset ?? areas[0] ?? 'purpose')
  const [thingId, setThingId] = useState('')
  const [note, setNote] = useState('')
  const [minutes, setMinutes] = useState('')
  const things = thingsOf(area, product, product.projects)
  const picked = things.some((thing) => thing.id === thingId) ? thingId : ''

  function save(event: React.FormEvent): void {
    event.preventDefault()
    const spent = Number(minutes)
    onProduct((current) => withLog(current, {
      id: newId('log'), area, on: today,
      ...(picked ? { thingId: picked } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(spent > 0 ? { minutes: Math.round(spent) } : {}),
    }, today, contextOf(current, journalDays)))
    onClose()
  }

  return <Sheet title={area === 'projects' ? 'worked on' : 'did something'} onClose={onClose}>
    <form className="stack" onSubmit={save}>
      {!preset && <Field label="area"><select value={area} onChange={(event) => setArea(event.target.value as CheckArea)}>{areas.map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>}
      {things.length > 0 && <Field label="for"><select value={picked} onChange={(event) => setThingId(event.target.value)}><option value="">all of {area}</option>{things.map((thing) => <option key={thing.id} value={thing.id}>{thing.title}</option>)}</select></Field>}
      <Field label="what"><input autoFocus value={note} onChange={(event) => setNote(event.target.value)} /></Field>
      {area === 'projects' && <Field label="minutes"><input inputMode="numeric" min="0" type="number" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></Field>}
      <div className="actions"><button className="primary" type="submit">save</button><button className="plain" type="button" onClick={onClose}>cancel</button></div>
    </form>
  </Sheet>
}

function Reading({ product, today, onProduct }: { product: ProductState; today: string; onProduct: SetProduct }) {
  const [title, setTitle] = useState('')
  const open = product.books.filter((book) => !book.finishedOn)
  const finished = product.books.filter((book) => book.finishedOn).sort((a, b) => b.finishedOn!.localeCompare(a.finishedOn!))
  return <Card className="slice-detail" title="reading">
    {open.length > 0 && <ul className="rows">{open.map((book) => <li className="row" key={book.id}>
      <Toggle done={book.readOn.includes(today)} label={`read today · ${book.title}`} onToggle={() => onProduct((current) => withReadDay(current, book.id, today))} />
      <div className="row-main"><span className="row-title">{book.title}</span><small>{book.readOn.length ? `read ${book.readOn.length} ${book.readOn.length === 1 ? 'day' : 'days'}` : `started ${day(book.startedOn)}`}</small></div>
      <Menu label={`options for ${book.title}`} items={[
        { label: 'finished', onSelect: () => onProduct((current) => withBookFinished(current, book.id, today)) },
        { label: 'remove', onSelect: () => onProduct((current) => withoutBook(current, book.id)) },
      ]} />
    </li>)}</ul>}
    {finished.length > 0 && <ul className="slice-facts">{finished.slice(0, 5).map((book) => <li key={book.id}><span>{book.title}</span><small>finished {day(book.finishedOn!)}</small></li>)}</ul>}
    <form className="add-line" onSubmit={(event) => {
      event.preventDefault()
      const name = title.trim()
      if (!name) return
      onProduct((current) => withBook(current, { id: newId('book'), title: name, startedOn: today, readOn: [] }))
      setTitle('')
    }}>
      <input aria-label="book" placeholder="book" value={title} onChange={(event) => setTitle(event.target.value)} />
      <button className="secondary" type="submit" disabled={!title.trim()}>add</button>
    </form>
  </Card>
}

/** One of the five areas judged by answers: its things, its challenges, and what was logged. */
export function AreaDetail({ arc, product, tasks = [], today, journalDays, onProduct, onGoals, onProject }: { arc: RingArc; product: ProductState; tasks?: Task[]; today: string; journalDays: string[]; onProduct: SetProduct; onGoals: () => void; /** Opens a project's steps. */ onProject?: (id: string) => void }) {
  const reading = arc.area!
  const area = reading.area
  const context = contextOf(product, journalDays)
  const [thing, setThing] = useState<AreaThing | 'new'>()
  const [challenge, setChallenge] = useState<Challenge | 'new'>()
  const [logging, setLogging] = useState(false)
  const [past, setPast] = useState(false)
  const hue = { '--hue': wheelHue[area] } as React.CSSProperties
  const things = reading.things
  const happy = things.filter((item) => item.thing.happy === 'happy').length
  const answered = things.filter((item) => item.thing.happy).length
  const logs = product.areaLogs.filter((log) => log.area === area).sort((a, b) => b.on.localeCompare(a.on)).slice(0, 5)
  const titleOf = (id?: string) => things.find((item) => item.thing.id === id)?.thing.title
  const facts = area === 'mind' ? mindFacts(product, today, journalDays) : undefined
  const done = area === 'projects' ? product.projects.filter((project) => project.domain === 'personal' && project.status === 'done') : []

  function meta(item: AreaThing): string {
    const parts: string[] = []
    if (area === 'projects') {
      const project = product.projects.find((entry) => projectThingId(entry.id) === item.id)
      if (project) {
        const work = projectWork(project, product, product.activities, today)
        if (work.tasks) parts.push(`${work.tasks} ${work.tasks === 1 ? 'task' : 'tasks'}`)
        if (work.minutes) parts.push(duration(work.minutes))
        const left = tasks.filter((task) => task.projectId === project.id && !task.completed).reduce((sum, task) => sum + task.estimateMin, 0) + stepsLeftMin(product, project.id)
        if (left) parts.push(`${duration(left)} left`)
      }
    }
    if (item.streak !== undefined) parts.push(`streak ${item.streak}${item.streakOn ? ` · ${day(item.streakOn)}` : ''}`)
    return parts.join(' · ')
  }

  return <>
    <Card className="slice-detail" title="check-in" aside={answered > 0 && reading.due ? <span className="count is-loud">due</span> : undefined}>
      {reading.fill !== undefined && <>
        <p className="slice-stat">{answered > 0 ? <><strong>{happy} of {answered}</strong> happy</> : <><strong>{Math.round(reading.fill * 100)}%</strong></>}</p>
        <div className="slice-bar" style={hue}><Bar fraction={reading.fill} loud={reading.drifting} /></div>
      </>}
      {things.length > 0 && <ul className="things">{things.map(({ thing: item, due }) => <li key={item.id}>
        {area === 'projects'
          ? <button className="thing-head" type="button" onClick={() => onProject?.(item.id.replace(/^project:/, ''))}><span className="row-title">{item.title}</span><small>{meta(item)}{due && item.happy ? <strong>{meta(item) ? ' · ' : ''}due</strong> : null}</small></button>
          : <button className="thing-head" type="button" onClick={() => setThing(item)}><span className="row-title">{item.title}</span><small>{meta(item)}{due && item.happy ? <strong>{meta(item) ? ' · ' : ''}due</strong> : null}</small></button>}
        <HappyPick thing={item} today={today} onProduct={onProduct} />
      </li>)}</ul>}
      <div className="actions">{area === 'projects'
        ? <button className="secondary" type="button" onClick={onGoals}>add project</button>
        : <button className="secondary" type="button" onClick={() => setThing('new')}>add</button>}</div>
    </Card>

    <Card className="slice-detail" title="challenges">
      {reading.challenges.length > 0 && <ul className="goals" style={hue}>{reading.challenges.map((standing) => <ChallengeRow key={standing.challenge.id} standing={standing} today={today} context={context} onOpen={() => setChallenge(standing.challenge)} onProduct={onProduct} />)}</ul>}
      {past && <ul className="slice-facts">{reading.past.map((standing) => <li key={standing.challenge.id}><button className="slice-fact-button" type="button" onClick={() => setChallenge(standing.challenge)}><span>{standing.challenge.title}</span><small>{standing.state === 'met' ? 'met' : `${standing.count} of ${standing.challenge.target}`}</small></button></li>)}</ul>}
      <div className="actions">
        <button className="secondary" type="button" onClick={() => setChallenge('new')}>add challenge</button>
        {reading.past.length > 0 && <button className="plain" type="button" aria-expanded={past} onClick={() => setPast(!past)}>past · {reading.past.length}</button>}
      </div>
    </Card>

    {facts && <Card className="slice-detail" title="last 28 days">
      <ul className="slice-facts">
        <li><span>journal days</span><small>{facts.journalDays}</small></li>
        <li><span>days read</span><small>{facts.readDays}</small></li>
        <li><span>books finished this year</span><small>{facts.booksFinished}</small></li>
      </ul>
    </Card>}
    {area === 'mind' && <Reading product={product} today={today} onProduct={onProduct} />}

    <Card className="slice-detail" title="log" aside={reading.logged28 > 0 ? <span className="count">{reading.logged28} in 28 days</span> : undefined}>
      {logs.length > 0 && <ul className="rows">{logs.map((log) => <li className="row" key={log.id}>
        <div className="row-main"><span className="row-title">{log.note ?? log.withPeople?.join(', ') ?? titleOf(log.thingId) ?? area}</span><small>{[day(log.on), log.note || log.withPeople ? titleOf(log.thingId) : undefined, log.minutes ? duration(log.minutes) : undefined].filter(Boolean).join(' · ')}</small></div>
        <button className="row-remove" type="button" aria-label="remove" title="remove" onClick={() => onProduct((current) => withoutLog(current, log.id))}><Icon name="close" size={16} /></button>
      </li>)}</ul>}
      <div className="actions"><button className="secondary" type="button" onClick={() => setLogging(true)}>{area === 'connection' ? 'saw someone' : area === 'projects' ? 'worked on' : 'did something'}</button></div>
    </Card>

    {done.length > 0 && <Card className="slice-detail" title="finished">
      <ul className="slice-facts">{done.map((project) => <li key={project.id}><span>{project.title}</span></li>)}</ul>
    </Card>}

    {thing && <ThingSheet area={area} thing={thing === 'new' ? undefined : thing} today={today} onClose={() => setThing(undefined)} onProduct={onProduct} />}
    {challenge && <ChallengeSheet area={area} challenge={challenge === 'new' ? undefined : challenge} things={things.map((item) => item.thing)} today={today} context={context} onClose={() => setChallenge(undefined)} onProduct={onProduct} />}
    {logging && (area === 'connection'
      ? <SawSomeoneSheet product={product} today={today} onClose={() => setLogging(false)} onProduct={onProduct} />
      : <AreaLogSheet area={area} product={product} today={today} journalDays={journalDays} onClose={() => setLogging(false)} onProduct={onProduct} />)}
  </>
}

function RestRating({ product, today, onProduct }: { product: ProductState; today: string; onProduct: SetProduct }) {
  const { checkIn, due } = latestRestCheckIn(product, today)
  const [rating, setRating] = useState<number>(checkIn?.rating ?? 5)
  const changed = due || rating !== checkIn?.rating
  return <li>
    <div className="thing-head"><span className="row-title">rested enough this month</span><small>{rating} of 10</small></div>
    <input aria-label="rested enough this month" min="1" max="10" type="range" value={rating} onChange={(event) => setRating(Number(event.target.value))} />
    {changed && <button className="primary small" type="button" onClick={() => onProduct((current) => withRestCheckIn(current, rating, today))}>save</button>}
  </li>
}

/** What the month review asks again: every thing's answer, and the felt rating for rest. */
export function AreaCheckIn({ product, today, onProduct }: { product: ProductState; today: string; onProduct: SetProduct }) {
  const context = contextOf(product, [])
  const readings: AreaReading[] = CHECK_AREAS.filter((area) => !product.ringOff.includes(area)).map((area) => areaReading(area, product, today, context)).filter((reading) => reading.things.length > 0)
  const rest = !product.ringOff.includes('rest')
  if (!readings.length && !rest) return null
  return <Card title="check-in">
    {readings.map((reading) => <section className="check-area" key={reading.area} style={{ '--hue': wheelHue[reading.area] } as React.CSSProperties}>
      <h3>{reading.area}</h3>
      <ul className="things">{reading.things.map(({ thing, due }) => <li key={thing.id}>
        <div className="thing-head"><span className="row-title">{thing.title}</span>{due && thing.happy ? <small><strong>due</strong></small> : null}</div>
        <HappyPick thing={thing} today={today} onProduct={onProduct} />
      </li>)}</ul>
    </section>)}
    {rest && <section className="check-area" style={{ '--hue': wheelHue.rest } as React.CSSProperties}>
      <h3>rest</h3>
      <ul className="things"><RestRating product={product} today={today} onProduct={onProduct} /></ul>
    </section>}
  </Card>
}
