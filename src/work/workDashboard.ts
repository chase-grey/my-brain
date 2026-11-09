import { trackUrl, type Activity, type Design, type DesignReview, type Dlg, type Ignore, type IgnoreKind, type Outage, type Person, type Prj, type Qan, type QanSummary, type WorkConfig, type WorkFilters, type WorkSnapshot } from './types.ts'

export type ItemKind = 'dlg' | 'design' | 'prj' | 'qan' | 'slg'
export type Item = {
  kind: ItemKind
  id: string
  title: string
  meta: string
  url: string
  due?: string | null
  loud: boolean
  hiddenReason?: string
}
export type Panel = { items: Item[]; hidden: Item[] }

export type TeamBoard = {
  person: Person
  dlgs: Panel
  prjs: Panel
  designs: Panel
  qans: Panel
  outages: Outage[]
  hoursLogged: number
}

export type ProductBoard = {
  name: string
  summary: QanSummary[]
  important: Panel
  offTrack: Panel
  prjs: Panel
}

export type Dashboard = {
  capturedAt: string
  errors: string[]
  me: Person
  needsMe: Panel
  waitingOn: Panel
  myDlgs: Panel
  myPrjs: Panel
  myDesigns: Panel
  team: TeamBoard[]
  products: ProductBoard[]
}

const DAY = 86_400_000
export const UNDER_DEVELOPMENT = 100
export const PQA_1 = 110
export const PQA_1_COMP = 120
export const QA_1 = 130
export const QA_1_COMP = 140
export const PQA_2 = 150

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00`) - Date.parse(`${from.slice(0, 10)}T12:00:00`)) / DAY)
}

export function isIgnored(ignores: Ignore[], kind: IgnoreKind, id: string | number, today: string): Ignore | undefined {
  return ignores.find((ignore) => ignore.kind === kind && String(ignore.id) === String(id) && (!ignore.until || ignore.until >= today))
}

function split(items: Item[]): Panel {
  return { items: items.filter((item) => !item.hiddenReason), hidden: items.filter((item) => item.hiddenReason) }
}

function ignoredReason(ignore: Ignore | undefined): string | undefined {
  if (!ignore) return undefined
  return ignore.note ? `ignored · ${ignore.note}` : 'ignored'
}

function dueText(date: string | null | undefined, today: string): string {
  if (!date) return ''
  const days = daysBetween(today, date)
  if (days < 0) return `${-days}d overdue`
  if (days === 0) return 'due today'
  return `due in ${days}d`
}

function sinceText(date: string | null | undefined, today: string, label: string): string {
  if (!date) return ''
  const days = daysBetween(date, today)
  return `${label} ${days}d`
}

/** Track fills unassigned slots with placeholder people; they are not someone to wait on. */
export function personName(name: string | null | undefined): string | null {
  if (!name || /^(assigned, not|not assigned|.*, tester)$/i.test(name.trim())) return null
  return name
}

function shortName(name: string, max = 44): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name
}

function joinMeta(parts: (string | null | undefined)[]): string {
  return parts.filter((part) => part && part.length).join(' · ')
}

export function dedupeQans(qans: Qan[]): Qan[] {
  const seen = new Set<string>()
  return qans.filter((qan) => {
    const key = String(qan.id)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function linkedPrjIds(dlg: Dlg): string[] {
  return dlg.prjIds ? dlg.prjIds.split(',').map((id) => id.trim()).filter(Boolean) : []
}

const idlePrjStatuses = new Set(['Not Started', 'Paused', 'Done'])
const idleTrackStatuses = new Set(['Paused', 'Not Started', 'Completed'])
export const offTrackStatuses = new Set(['Behind Schedule', 'In Jeopardy', 'Bumped'])

export function prjIsMoving(prj: Prj): boolean {
  return Boolean(prj.active) && !idlePrjStatuses.has(prj.status) && !idleTrackStatuses.has(prj.onTrack ?? '')
}

export function hoursOn(activity: Activity[], employeeId: string, kind: 'dlgId' | 'prjId' | 'qanId' | 'slgId', id: string | number): number {
  return activity.filter((row) => row.employeeId === employeeId && row[kind] === String(id)).reduce((sum, row) => sum + row.hours, 0)
}

/** Why a developer's DLG counts as live work, or undefined when it looks parked. */
export function dlgActivityReason(dlg: Dlg, developerId: string, snapshot: WorkSnapshot, filters: WorkFilters, today: string): string | undefined {
  if (dlg.statusId > UNDER_DEVELOPMENT) return dlg.daysInStatus !== null ? `${dlg.daysInStatus}d in status` : 'in review'
  const hours = hoursOn(snapshot.activity, developerId, 'dlgId', dlg.id)
  if (hours > 0) return `${Math.round(hours * 4) / 4}h logged in ${filters.teamActivityDays}d`
  if (dlg.lastBatonPass && daysBetween(dlg.lastBatonPass, today) <= filters.teamBatonDays) return `baton moved ${daysBetween(dlg.lastBatonPass, today)}d ago`
  if (dlg.underDevSince && daysBetween(dlg.underDevSince, today) <= filters.teamBatonDays) return 'started recently'
  const prjs = linkedPrjIds(dlg).map((id) => snapshot.prjs.find((prj) => String(prj.id) === id)).filter((prj): prj is Prj => Boolean(prj))
  const moving = prjs.find(prjIsMoving)
  if (moving) return `on ${shortName(moving.name)}`
  return undefined
}

function dlgItem(dlg: Dlg, meta: string, loud = false, hiddenReason?: string): Item {
  return { kind: 'dlg', id: dlg.id, title: dlg.name, meta, url: trackUrl('DLG', dlg.id), due: dlg.currentDue, loud, hiddenReason }
}

function designTitle(design: { name: string }): string {
  return design.name
}

/** A design nobody has touched: the author is not waiting on the reviewer, so the reviewer owes nothing yet. */
export function designNeglected(review: { lastUpdate: string | null; approvalBy: string | null }, filters: WorkFilters, today: string): string | undefined {
  const idle = review.lastUpdate ? daysBetween(review.lastUpdate, today) : Number.POSITIVE_INFINITY
  if (idle <= filters.designOptionalStaleDays) return undefined
  const overdueBy = review.approvalBy ? daysBetween(review.approvalBy, today) : Number.POSITIVE_INFINITY
  if (overdueBy <= filters.designOverdueGraceDays) return undefined
  return Number.isFinite(idle) ? `author idle ${idle}d` : 'author idle'
}

export function reviewItems(reviews: DesignReview[], config: WorkConfig, today: string): Item[] {
  return reviews.map((review) => {
    const ignore = isIgnored(config.ignores, 'design', review.designId, today)
    const neglected = designNeglected(review, config.filters, today)
    const dueIn = review.approvalBy ? daysBetween(today, review.approvalBy) : undefined
    const overdue = dueIn !== undefined && dueIn < 0
    let hiddenReason = ignoredReason(ignore) ?? neglected
    if (!hiddenReason && !review.required && !config.filters.optionalReviews) hiddenReason = 'optional'
    if (!hiddenReason && dueIn !== undefined && dueIn > config.filters.reviewHorizonDays) hiddenReason = `not due for ${dueIn}d`
    const meta = joinMeta([
      review.required ? 'required' : 'optional',
      review.perspective,
      review.leadName ? `lead ${review.leadName}` : null,
      dueText(review.approvalBy, today),
      review.activeReviewers !== null && review.totalReviewers ? `${review.activeReviewers}/${review.totalReviewers} reviewed` : null,
    ])
    return { kind: 'design', id: String(review.designId), title: designTitle(review), meta, url: trackUrl('XDS', review.designId), due: review.approvalBy, loud: Boolean(review.required) && (overdue || (dueIn !== undefined && dueIn <= 2)), hiddenReason }
  })
}

function pqaNearReason(dlg: Dlg, me: string, snapshot: WorkSnapshot, filters: WorkFilters, today: string): string | undefined {
  if (dlg.pqa1Id === me && dlg.statusId === UNDER_DEVELOPMENT) {
    if (dlg.devCompDeadline && daysBetween(today, dlg.devCompDeadline) <= filters.pqaNearDays) return `pqa 1 soon · dev comp ${dueText(dlg.devCompDeadline, today)}`
    if (dlg.developerId && hoursOn(snapshot.activity, dlg.developerId, 'dlgId', dlg.id) >= 8) return 'pqa 1 soon · dev is active'
  }
  if (dlg.pqa2Id === me && (dlg.statusId === QA_1 || dlg.statusId === QA_1_COMP)) return `pqa 2 next · ${dlg.status.toLowerCase()}`
  return undefined
}

export function buildDashboard(snapshot: WorkSnapshot, config: WorkConfig, today: string): Dashboard {
  const me = snapshot.me.id
  const filters = config.filters
  const qans = dedupeQans(snapshot.qans)
  const ignored = (kind: IgnoreKind, id: string | number) => ignoredReason(isIgnored(config.ignores, kind, id, today))

  // needs me
  const needs: Item[] = []
  needs.push(...reviewItems(snapshot.designReviews.filter((review) => review.reviewerId === me), config, today))
  for (const dlg of snapshot.dlgs) {
    const hidden = ignored('dlg', dlg.id)
    // My own under-development DLGs are my work, not a baton someone passed me.
    if (dlg.responsibleId === me && (dlg.statusId > UNDER_DEVELOPMENT || dlg.developerId !== me)) {
      needs.push(dlgItem(dlg, joinMeta([dlg.status.toLowerCase(), 'baton with me', dlg.daysInStatus !== null ? `${dlg.daysInStatus}d` : null, dueText(dlg.currentDue, today)]), (dlg.daysInStatus ?? 0) >= 5 || (dlg.currentDue !== null && daysBetween(today, dlg.currentDue) <= 1), hidden))
      continue
    }
    const near = pqaNearReason(dlg, me, snapshot, filters, today)
    if (near) needs.push(dlgItem(dlg, joinMeta([near, personName(dlg.responsibleName) ? `with ${dlg.responsibleName}` : null]), false, hidden))
    else if ((dlg.pqa1Id === me || dlg.pqa2Id === me) && dlg.developerId !== me) needs.push(dlgItem(dlg, joinMeta([dlg.status.toLowerCase(), personName(dlg.responsibleName) ? `with ${dlg.responsibleName}` : null]), false, hidden ?? 'pqa later'))
    if (dlg.developerId === me && (dlg.highPriOpenComments ?? 0) > 0 && dlg.responsibleId !== me) needs.push(dlgItem(dlg, `${dlg.highPriOpenComments} open high-pri comments`, true, hidden))
  }
  for (const qan of qans.filter((qan) => qan.fixerId === me)) {
    needs.push({ kind: 'qan', id: String(qan.id), title: qan.name, meta: joinMeta([qan.priority.toLowerCase(), qan.status.toLowerCase(), qan.workDaysInStatus !== null ? `${qan.workDaysInStatus} workdays` : null, qan.escalatedOn ? 'escalated' : null]), url: trackUrl('ZQN', qan.id), loud: qan.priorityId <= 2 || Boolean(qan.escalatedOn), hiddenReason: ignored('qan', qan.id) })
  }
  for (const slg of snapshot.slgs.filter((slg) => slg.batonId === me)) {
    needs.push({ kind: 'slg', id: String(slg.id), title: slg.title, meta: joinMeta([slg.customer, slg.status.toLowerCase(), sinceText(slg.lastCustomerPost, today, 'customer posted')]), url: trackUrl('SLG', slg.id), loud: true, hiddenReason: ignored('slg', slg.id) })
  }

  // waiting on others
  const waiting: Item[] = []
  for (const dlg of snapshot.dlgs.filter((dlg) => dlg.developerId === me && dlg.responsibleId !== me && dlg.statusId > UNDER_DEVELOPMENT)) {
    waiting.push(dlgItem(dlg, joinMeta([dlg.status.toLowerCase(), personName(dlg.responsibleName) ? `with ${dlg.responsibleName}` : null, dlg.responsibleRole?.toLowerCase(), dlg.daysInStatus !== null ? `${dlg.daysInStatus}d` : null]), (dlg.daysInStatus ?? 0) >= 10, ignored('dlg', dlg.id)))
  }
  for (const dlg of snapshot.dlgs.filter((dlg) => dlg.developerId !== me && dlg.responsibleId !== me && ((dlg.pqa1Id === me && dlg.statusId === PQA_1) || (dlg.pqa2Id === me && dlg.statusId === PQA_2)))) {
    waiting.push(dlgItem(dlg, joinMeta([`${dlg.status.toLowerCase()} back with ${personName(dlg.responsibleName) ?? 'dev'}`, dlg.daysInStatus !== null ? `${dlg.daysInStatus}d` : null]), false, ignored('dlg', dlg.id)))
  }
  for (const design of snapshot.designs.filter((design) => (design.leadId === me || design.creatorId === me) && design.pendingReviewers > 0 && design.status !== 'Draft')) {
    waiting.push({ kind: 'design', id: String(design.id), title: design.name, meta: joinMeta([design.status.toLowerCase(), `${design.pendingReviewers} reviewers pending`, design.pendingRequired ? `${design.pendingRequired} required` : null, dueText(design.approvalBy, today)]), url: trackUrl('XDS', design.id), due: design.approvalBy, loud: design.approvalBy !== null && daysBetween(today, design.approvalBy) < 0, hiddenReason: ignored('design', design.id) })
  }

  // my work
  const myDlgs = snapshot.dlgs.filter((dlg) => dlg.developerId === me).map((dlg) => {
    const reason = dlgActivityReason(dlg, me, snapshot, filters, today)
    return dlgItem(dlg, joinMeta([dlg.status.toLowerCase(), reason ?? sinceText(dlg.underDevSince, today, 'started'), dueText(dlg.currentDue, today)]), dlg.currentDue !== null && daysBetween(today, dlg.currentDue) <= 2, ignored('dlg', dlg.id) ?? (reason ? undefined : `idle ${dlg.daysInStatus ?? '?'}d`))
  })
  const myPrjs = prjItems(snapshot.prjs.filter((prj) => prjBelongsTo(prj, me)), config, today)
  const myDesigns = designItems(snapshot.designs.filter((design) => design.leadId === me || design.creatorId === me), config, today)

  // team
  const team: TeamBoard[] = snapshot.team.filter((person) => person.level === 1 && !isIgnored(config.ignores, 'person', person.id, today)).map((person) => {
    const dlgs = snapshot.dlgs.filter((dlg) => dlg.developerId === person.id).map((dlg) => {
      const reason = dlgActivityReason(dlg, person.id, snapshot, filters, today)
      const withSomeone = dlg.responsibleId && dlg.responsibleId !== person.id && personName(dlg.responsibleName) ? `with ${dlg.responsibleName}` : null
      return dlgItem(dlg, joinMeta([dlg.status.toLowerCase(), withSomeone, reason, dueText(dlg.currentDue, today)]), dlg.statusId > UNDER_DEVELOPMENT && (dlg.daysInStatus ?? 0) >= 10, ignored('dlg', dlg.id) ?? (reason ? undefined : `idle ${dlg.daysInStatus ?? '?'}d`))
    })
    const reviews = snapshot.designReviews.filter((review) => review.reviewerId === person.id && review.required)
    const designs = designItems(snapshot.designs.filter((design) => design.leadId === person.id || design.creatorId === person.id), config, today)
    for (const review of reviews) {
      const neglected = designNeglected(review, filters, today)
      designs.push({ kind: 'design', id: String(review.designId), title: review.name, meta: joinMeta(['reviewing', dueText(review.approvalBy, today)]), url: trackUrl('XDS', review.designId), due: review.approvalBy, loud: false, hiddenReason: ignored('design', review.designId) ?? neglected })
    }
    const qanItems = qans.filter((qan) => qan.fixerId === person.id).map((qan): Item => ({ kind: 'qan', id: String(qan.id), title: qan.name, meta: joinMeta([qan.priority.toLowerCase(), qan.status.toLowerCase(), qan.workDaysInStatus !== null ? `${qan.workDaysInStatus} workdays` : null]), url: trackUrl('ZQN', qan.id), loud: qan.priorityId <= 2 || Boolean(qan.escalatedOn), hiddenReason: ignored('qan', qan.id) ?? (filters.qanPriorityIds.includes(qan.priorityId) ? undefined : 'low priority') }))
    return {
      person,
      dlgs: split(dlgs),
      prjs: split(prjItems(snapshot.prjs.filter((prj) => prjBelongsTo(prj, person.id)), config, today)),
      designs: split(designs),
      qans: split(qanItems),
      outages: snapshot.outages.filter((outage) => outage.employeeId === person.id),
      hoursLogged: Math.round(snapshot.activity.filter((row) => row.employeeId === person.id).reduce((sum, row) => sum + row.hours, 0) * 4) / 4,
    }
  })

  // products
  const products: ProductBoard[] = config.products.map((name) => {
    const important = qans.filter((qan) => qan.product === name && filters.qanPriorityIds.includes(qan.priorityId)).map((qan): Item => {
      const stale = (qan.workDaysInStatus ?? 0) > filters.qanStaleWorkdays
      const urgent = qan.priorityId <= 2 || Boolean(qan.escalatedOn)
      let hiddenReason = ignored('qan', qan.id)
      if (!hiddenReason && /^future$/i.test(qan.status)) hiddenReason = 'deferred to future'
      else if (!hiddenReason && /request to close/i.test(qan.status)) hiddenReason = 'closing'
      else if (!hiddenReason && !urgent && !stale) hiddenReason = `under ${filters.qanStaleWorkdays} workdays`
      return {
        kind: 'qan', id: String(qan.id), title: qan.name,
        meta: joinMeta([qan.priority.toLowerCase(), qan.status.toLowerCase(), qan.functionalArea, qan.workDaysInStatus !== null ? `${Math.round(qan.workDaysInStatus)} workdays` : null, qan.escalatedOn ? 'escalated' : null]),
        url: trackUrl('ZQN', qan.id), loud: urgent, hiddenReason,
      }
    })
    const prjs = prjItems(snapshot.prjs.filter((prj) => prj.product === name && prj.active && prj.onBacklog && prj.status !== 'Done'), config, today)
    return {
      name,
      summary: snapshot.qanSummary.filter((row) => row.product === name),
      important: split(important),
      offTrack: split(prjs.filter((item) => item.loud)),
      prjs: split(prjs),
    }
  })

  return {
    capturedAt: snapshot.capturedAt,
    errors: snapshot.errors,
    me: snapshot.me,
    needsMe: split(needs),
    waitingOn: split(waiting),
    myDlgs: split(myDlgs),
    myPrjs: split(myPrjs),
    myDesigns: split(myDesigns),
    team,
    products,
  }
}

export function prjBelongsTo(prj: Prj, employeeId: string): boolean {
  if (prj.ownerId === employeeId) return true
  const roles = (prj.pointPeople ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
  return roles.some((entry) => {
    const [id, role] = entry.split(':')
    return id === employeeId && /owner|lead/i.test(role ?? '')
  })
}

export function prjItems(prjs: Prj[], config: WorkConfig, today: string): Item[] {
  return prjs.filter((prj) => prj.active).map((prj) => {
    const off = offTrackStatuses.has(prj.onTrack ?? '')
    const overdue = Boolean(prj.onTrackOverdue)
    return {
      kind: 'prj', id: String(prj.id), title: prj.name,
      meta: joinMeta([prj.status.toLowerCase(), prj.onTrack?.toLowerCase(), overdue ? 'status overdue' : null, prj.targetVersion, prj.remainingHours !== null ? `${Math.round(prj.remainingHours)}h left` : null, (prj.openImportantIssues ?? 0) > 0 ? `${prj.openImportantIssues} issues` : null]),
      url: trackUrl('PRJ', prj.id), due: prj.dueOn, loud: off || overdue,
      hiddenReason: ignoredReason(isIgnored(config.ignores, 'prj', prj.id, today)) ?? (prjIsMoving(prj) ? undefined : (prj.status === 'Done' ? 'done' : prj.onTrack?.toLowerCase() === 'paused' || prj.status === 'Paused' ? 'paused' : 'not started')),
    }
  })
}

export function designItems(designs: Design[], config: WorkConfig, today: string): Item[] {
  return designs.map((design) => {
    const idle = design.lastUpdate ? daysBetween(design.lastUpdate, today) : null
    return {
      kind: 'design', id: String(design.id), title: design.name,
      meta: joinMeta([design.status.toLowerCase(), design.pendingReviewers ? `${design.pendingReviewers} pending` : null, design.waitingForChanges ? `${design.waitingForChanges} want changes` : null, dueText(design.approvalBy, today), idle !== null ? `updated ${idle}d ago` : null]),
      url: trackUrl('XDS', design.id), due: design.approvalBy, loud: design.waitingForChanges > 0 || (design.approvalBy !== null && daysBetween(today, design.approvalBy) < 0 && design.status === 'In Review'),
      hiddenReason: ignoredReason(isIgnored(config.ignores, 'design', design.id, today)) ?? (idle !== null && idle > 60 ? `idle ${idle}d` : design.status === 'Draft' ? 'draft' : undefined),
    }
  })
}

export function ignoredCount(panel: Panel): number {
  return panel.hidden.filter((item) => item.hiddenReason?.startsWith('ignored')).length
}
