import { trackUrl, type Outage, type OutageWindow, type WorkConfig, type WorkSnapshot } from './types.ts'
import { daysBetween, dedupeQans, designNeglected, isIgnored, offTrackStatuses, prjBelongsTo, QA_1, QA_1_COMP, UNDER_DEVELOPMENT } from './workDashboard.ts'

export type OutageItem = {
  kind: 'dlg' | 'design' | 'prj' | 'qan' | 'slg'
  id: string
  title: string
  why: string
  url: string
  due?: string | null
  /** The role a backup would need to cover, so the plan can name one person per role. */
  cover: 'decision' | 'baton' | 'pqa' | 'dev' | 'fix' | 'owner' | 'author' | 'support'
}

export type OutageSection = { id: string; title: string; items: OutageItem[] }

export type OutagePlan = {
  window: OutageWindow
  workdays: number
  sections: OutageSection[]
  teamOut: Outage[]
  teamIn: string[]
}

function* eachDay(start: string, end: string): Generator<string> {
  const cursor = new Date(`${start}T12:00:00`)
  const last = new Date(`${end}T12:00:00`)
  while (cursor <= last) {
    yield cursor.toLocaleDateString('en-CA')
    cursor.setDate(cursor.getDate() + 1)
  }
}

export function workdaysIn(window: OutageWindow): number {
  let count = 0
  for (const day of eachDay(window.start, window.end)) {
    const weekday = new Date(`${day}T12:00:00`).getDay()
    if (weekday !== 0 && weekday !== 6) count++
  }
  return count
}

function inWindow(date: string | null | undefined, window: OutageWindow, graceAfter = 2): boolean {
  if (!date) return false
  const day = date.slice(0, 10)
  return day <= addDays(window.end, graceAfter) && day >= window.start
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`)
  value.setDate(value.getDate() + days)
  return value.toLocaleDateString('en-CA')
}

function overlaps(outage: Outage, window: OutageWindow): boolean {
  return outage.startOn <= window.end && outage.endOn >= window.start
}

export function buildOutagePlan(snapshot: WorkSnapshot, config: WorkConfig, window: OutageWindow, today: string): OutagePlan {
  const me = snapshot.me.id
  const filters = config.filters
  const hidden = (kind: 'dlg' | 'design' | 'prj' | 'qan' | 'slg', id: string | number) => Boolean(isIgnored(config.ignores, kind, id, today))
  const qans = dedupeQans(snapshot.qans)

  const decisions: OutageItem[] = snapshot.designReviews
    .filter((review) => review.reviewerId === me && !hidden('design', review.designId) && !designNeglected(review, filters, today))
    .filter((review) => review.required || inWindow(review.approvalBy, window, 7))
    .filter((review) => !review.approvalBy || review.approvalBy <= addDays(window.end, 7))
    .map((review) => ({
      kind: 'design', id: String(review.designId), title: review.name, url: trackUrl('XDS', review.designId), due: review.approvalBy, cover: 'decision',
      why: review.approvalBy ? (daysBetween(today, review.approvalBy) < 0 ? `approval ${-daysBetween(today, review.approvalBy)}d overdue` : `approval due ${review.approvalBy}`) : 'required review, no date',
    }))

  const batons: OutageItem[] = []
  const pqa: OutageItem[] = []
  const deadlines: OutageItem[] = []
  for (const dlg of snapshot.dlgs) {
    if (hidden('dlg', dlg.id)) continue
    if (dlg.responsibleId === me && (dlg.statusId > UNDER_DEVELOPMENT || dlg.developerId !== me)) {
      batons.push({ kind: 'dlg', id: dlg.id, title: dlg.name, url: trackUrl('DLG', dlg.id), due: dlg.currentDue, cover: dlg.developerId === me ? 'dev' : 'baton', why: `${dlg.status.toLowerCase()} · baton with me${dlg.currentDue ? ` · due ${dlg.currentDue}` : ''}` })
      continue
    }
    if (dlg.pqa1Id === me && dlg.statusId === UNDER_DEVELOPMENT && (inWindow(dlg.devCompDeadline, window, 3) || (dlg.devCompDeadline !== null && dlg.devCompDeadline < window.start))) {
      pqa.push({ kind: 'dlg', id: dlg.id, title: dlg.name, url: trackUrl('DLG', dlg.id), due: dlg.devCompDeadline, cover: 'pqa', why: `pqa 1 expected · dev comp ${dlg.devCompDeadline}` })
    } else if (dlg.pqa1Id === me && dlg.statusId === UNDER_DEVELOPMENT && dlg.developerId !== me && dlg.developerId && snapshot.activity.some((row) => row.employeeId === dlg.developerId && row.dlgId === dlg.id && row.hours >= 8)) {
      pqa.push({ kind: 'dlg', id: dlg.id, title: dlg.name, url: trackUrl('DLG', dlg.id), due: dlg.devCompDeadline, cover: 'pqa', why: 'pqa 1 likely · dev is active on it' })
    } else if (dlg.pqa2Id === me && (dlg.statusId === QA_1 || dlg.statusId === QA_1_COMP)) {
      pqa.push({ kind: 'dlg', id: dlg.id, title: dlg.name, url: trackUrl('DLG', dlg.id), due: dlg.pqa2Deadline, cover: 'pqa', why: `pqa 2 next · ${dlg.status.toLowerCase()}` })
    } else if ((dlg.pqa1Id === me || dlg.pqa2Id === me) && (inWindow(dlg.pqa1Deadline, window) || inWindow(dlg.pqa2Deadline, window))) {
      pqa.push({ kind: 'dlg', id: dlg.id, title: dlg.name, url: trackUrl('DLG', dlg.id), due: dlg.pqa1Deadline ?? dlg.pqa2Deadline, cover: 'pqa', why: 'pqa deadline falls in the window' })
    }
    if (dlg.developerId === me) {
      const dates = [dlg.devCompDeadline, dlg.qa1Deadline, dlg.qa2Deadline, dlg.currentDue].filter((date): date is string => Boolean(date) && inWindow(date, window))
      if (dates.length) deadlines.push({ kind: 'dlg', id: dlg.id, title: dlg.name, url: trackUrl('DLG', dlg.id), due: dates.sort()[0], cover: 'dev', why: `${dlg.status.toLowerCase()} · deadline ${dates.sort()[0]}` })
    }
  }

  const fixes: OutageItem[] = qans.filter((qan) => qan.fixerId === me && !hidden('qan', qan.id)).map((qan) => ({
    kind: 'qan', id: String(qan.id), title: qan.name, url: trackUrl('ZQN', qan.id), cover: 'fix', why: `${qan.priority.toLowerCase()} · ${qan.status.toLowerCase()}${qan.escalatedOn ? ' · escalated' : ''}`,
  }))

  const support: OutageItem[] = snapshot.slgs.filter((slg) => (slg.batonId === me || slg.assignedId === me) && !hidden('slg', slg.id)).map((slg) => ({
    kind: 'slg', id: String(slg.id), title: slg.title, url: trackUrl('SLG', slg.id), cover: 'support', why: `${slg.customer ?? 'customer'} · ${slg.status.toLowerCase()}`,
  }))

  const projects: OutageItem[] = snapshot.prjs.filter((prj) => prj.active && prjBelongsTo(prj, me) && !hidden('prj', prj.id)).flatMap((prj) => {
    const dates = [prj.plannedDevComp, prj.plannedQa1, prj.plannedReadiness, prj.dueOn].filter((date): date is string => Boolean(date) && inWindow(date, window))
    const reasons: string[] = []
    if (dates.length) reasons.push(`milestone ${dates.sort()[0]}`)
    if (offTrackStatuses.has(prj.onTrack ?? '')) reasons.push(prj.onTrack!.toLowerCase())
    if (prj.onTrackOverdue) reasons.push('status update overdue')
    if (!reasons.length) return []
    return [{ kind: 'prj' as const, id: String(prj.id), title: prj.name, url: trackUrl('PRJ', prj.id), due: dates.sort()[0] ?? null, cover: 'owner' as const, why: reasons.join(' · ') }]
  })

  const designs: OutageItem[] = snapshot.designs.filter((design) => (design.leadId === me || design.creatorId === me) && design.status === 'In Review' && !hidden('design', design.id)).map((design) => ({
    kind: 'design', id: String(design.id), title: design.name, url: trackUrl('XDS', design.id), due: design.approvalBy, cover: 'author', why: `${design.pendingReviewers} reviewers pending${design.waitingForChanges ? ` · ${design.waitingForChanges} want changes` : ''}`,
  }))

  const teamOut = snapshot.outages.filter((outage) => outage.employeeId !== me && overlaps(outage, window))
  const teamIn = snapshot.team.filter((person) => person.level === 1 && !teamOut.some((outage) => outage.employeeId === person.id)).map((person) => person.name)

  const sections: OutageSection[] = [
    { id: 'decisions', title: 'decisions due', items: decisions },
    { id: 'batons', title: 'batons i hold', items: batons },
    { id: 'pqa', title: 'pqa likely to reach me', items: pqa },
    { id: 'deadlines', title: 'my deadlines in the window', items: deadlines },
    { id: 'fixes', title: 'fixes assigned to me', items: fixes },
    { id: 'projects', title: 'projects i own', items: projects },
    { id: 'designs', title: 'designs i lead in review', items: designs },
    { id: 'support', title: 'support logs on me', items: support },
  ].filter((section) => section.items.length)

  return { window, workdays: workdaysIn(window), sections, teamOut, teamIn }
}

export function outagePlanMarkdown(plan: OutagePlan, meName: string): string {
  const lines: string[] = []
  lines.push(`# outage plan ${plan.window.start} to ${plan.window.end}`)
  lines.push('')
  lines.push(`${meName} out ${plan.workdays} workdays. Built from the work snapshot; verify anything you hand off in Track before leaving.`)
  lines.push('')
  if (plan.teamOut.length) {
    lines.push('## also out')
    for (const outage of plan.teamOut) lines.push(`- ${outage.employeeName}: ${outage.type.toLowerCase()} ${outage.startOn} to ${outage.endOn}`)
    lines.push('')
  }
  if (plan.teamIn.length) {
    lines.push(`available: ${plan.teamIn.join(', ')}`)
    lines.push('')
  }
  for (const section of plan.sections) {
    lines.push(`## ${section.title}`)
    for (const item of section.items) lines.push(`- [ ] [${item.title}](${item.url}) · ${item.why} · backup: `)
    lines.push('')
  }
  return lines.join('\n')
}
