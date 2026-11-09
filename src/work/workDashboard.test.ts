import { describe, expect, it } from 'vitest'
import { config, DAN, design, dlg, GAURESH, ME, prj, qan, review, snapshot, TODAY } from './fixtures'
import { buildDashboard, daysBetween, dlgActivityReason, isIgnored } from './workDashboard'

describe('design reviews that need me', () => {
  it('shows required reviews that are close and hides optional or far-off ones', () => {
    const reviews = [
      review({ designId: '1', name: 'required soon', required: 1, approvalBy: '2026-11-06' }),
      review({ designId: '2', name: 'optional overdue', required: 0, approvalBy: '2026-10-01' }),
      review({ designId: '3', name: 'optional this week', required: 0, approvalBy: '2026-11-08' }),
      review({ designId: '4', name: 'required in two months', required: 1, approvalBy: '2027-01-10' }),
    ]
    const board = buildDashboard(snapshot({ designReviews: reviews }), config(), TODAY)
    expect(board.needsMe.items.map((item) => item.title)).toEqual(['required soon'])
    expect(board.needsMe.hidden.map((item) => [item.title, item.hiddenReason])).toEqual([['optional overdue', 'optional'], ['optional this week', 'optional'], ['required in two months', 'not due for 66d']])
    expect(board.needsMe.items[0].loud).toBe(true)
    const withOptional = buildDashboard(snapshot({ designReviews: reviews }), config({ filters: { ...config().filters, optionalReviews: true } }), TODAY)
    expect(withOptional.needsMe.items.map((item) => item.title)).toEqual(['required soon', 'optional overdue', 'optional this week'])
  })

  it('hides designs the author has abandoned even when my review is required', () => {
    const board = buildDashboard(snapshot({ designReviews: [
      review({ designId: '1', name: 'neglected', required: 1, approvalBy: '2026-09-01', lastUpdate: '2026-08-20' }),
      review({ designId: '2', name: 'overdue but alive', required: 1, approvalBy: '2026-10-20', lastUpdate: '2026-11-01' }),
    ] }), config(), TODAY)
    expect(board.needsMe.items.map((item) => item.title)).toEqual(['overdue but alive'])
    expect(board.needsMe.hidden[0].hiddenReason).toBe('author idle 77d')
  })

  it('does not count reviews assigned to my reports as mine', () => {
    const board = buildDashboard(snapshot({ designReviews: [review({ designId: '1', name: 'dans review', reviewerId: DAN })] }), config(), TODAY)
    expect(board.needsMe.items).toHaveLength(0)
    expect(board.team[0].designs.items.map((item) => item.meta)).toEqual(['reviewing · due in 5d'])
  })
})

describe('dlg batons', () => {
  it('puts dlgs where i hold the baton under needs me and my dlgs with others under waiting', () => {
    const board = buildDashboard(snapshot({ dlgs: [
      dlg({ id: 'a', name: 'pqa on me', statusId: 110, status: 'PQA 1', developerId: DAN, responsibleId: ME, responsibleName: 'Chase Grey', daysInStatus: 6, pqa1Id: ME }),
      dlg({ id: 'b', name: 'mine in qa', statusId: 130, status: 'QA 1', developerId: ME, responsibleId: '7', responsibleName: 'Quinn QA', responsibleRole: 'QA', daysInStatus: 12 }),
      dlg({ id: 'c', name: 'mine under dev', developerId: ME, responsibleId: ME, daysInStatus: 3, underDevSince: '2026-11-02' }),
    ] }), config(), TODAY)
    expect(board.needsMe.items.map((item) => [item.title, item.loud])).toEqual([['pqa on me', true]])
    expect(board.waitingOn.items.map((item) => item.meta)).toEqual(['qa 1 · with Quinn QA · qa · 12d'])
    expect(board.myDlgs.items.map((item) => item.title)).toEqual(['mine in qa', 'mine under dev'])
  })

  it('only surfaces pqa work when the baton is close', () => {
    const board = buildDashboard(snapshot({ dlgs: [
      dlg({ id: 'far', name: 'pqa far off', pqa1Id: ME, devCompDeadline: '2027-01-15' }),
      dlg({ id: 'soon', name: 'pqa soon', pqa1Id: ME, devCompDeadline: '2026-11-09' }),
      dlg({ id: 'active', name: 'pqa active dev', pqa1Id: ME }),
      dlg({ id: 'second', name: 'pqa 2 next', pqa2Id: ME, statusId: 130, status: 'QA 1', responsibleId: '7', responsibleName: 'Quinn QA' }),
    ], activity: [{ employeeId: DAN, dlgId: 'active', prjId: null, qanId: null, slgId: null, hours: 12, lastOn: TODAY, descriptions: [] }] }), config(), TODAY)
    expect(board.needsMe.items.map((item) => item.title)).toEqual(['pqa soon', 'pqa active dev', 'pqa 2 next'])
    expect(board.needsMe.hidden.map((item) => [item.title, item.hiddenReason])).toEqual([['pqa far off', 'pqa later']])
  })
})

describe('team boards', () => {
  const parked = dlg({ id: 'old', name: 'prototype from 2024', developerId: DAN, responsibleId: DAN, underDevSince: '2024-03-01', daysInStatus: 900 })
  const logged = dlg({ id: 'hot', name: 'efm adapter', developerId: DAN, responsibleId: DAN, underDevSince: '2026-09-01', daysInStatus: 60 })
  const onProject = dlg({ id: 'prj', name: 'on a moving project', developerId: DAN, responsibleId: DAN, underDevSince: '2026-05-01', daysInStatus: 180, prjIds: '100' })
  const onDeadProject = dlg({ id: 'dead', name: 'on a paused project', developerId: DAN, responsibleId: DAN, underDevSince: '2026-05-01', daysInStatus: 180, prjIds: '101' })
  const inReview = dlg({ id: 'rev', name: 'in pqa', developerId: GAURESH, responsibleId: ME, responsibleName: 'Chase Grey', statusId: 110, status: 'PQA 1', daysInStatus: 2 })
  const snap = snapshot({
    dlgs: [parked, logged, onProject, onDeadProject, inReview],
    prjs: [prj({ id: '100', name: 'moving', ownerId: '9', pointPeople: null }), prj({ id: '101', name: 'paused', ownerId: '9', pointPeople: null, status: 'Paused', onTrack: 'Paused' })],
    activity: [{ employeeId: DAN, dlgId: 'hot', prjId: null, qanId: null, slgId: null, hours: 17, lastOn: TODAY, descriptions: ['efm'] }],
  })

  it('explains why each dlg is live and hides the parked ones with a reason', () => {
    const board = buildDashboard(snap, config(), TODAY)
    const dan = board.team.find((entry) => entry.person.id === DAN)!
    expect(dan.dlgs.items.map((item) => [item.title, item.meta])).toEqual([
      ['efm adapter', 'under development · 17h logged in 14d'],
      ['on a moving project', 'under development · on moving'],
    ])
    expect(dan.dlgs.hidden.map((item) => [item.title, item.hiddenReason])).toEqual([
      ['prototype from 2024', 'idle 900d'],
      ['on a paused project', 'idle 180d'],
    ])
    expect(dan.hoursLogged).toBe(17)
    const gauresh = board.team.find((entry) => entry.person.id === GAURESH)!
    expect(gauresh.dlgs.items[0].meta).toBe('pqa 1 · with Chase Grey · 2d in status')
  })

  it('treats an ignored dlg as hidden everywhere and lets the ignore expire', () => {
    const ignores = [{ kind: 'dlg' as const, id: 'hot', note: 'side quest', until: '2026-11-30' }]
    const board = buildDashboard(snap, config({ ignores }), TODAY)
    const dan = board.team.find((entry) => entry.person.id === DAN)!
    expect(dan.dlgs.hidden.find((item) => item.id === 'hot')?.hiddenReason).toBe('ignored · side quest')
    expect(isIgnored(ignores, 'dlg', 'hot', '2026-12-01')).toBeUndefined()
  })

  it('drops a report entirely when the person is ignored', () => {
    const board = buildDashboard(snap, config({ ignores: [{ kind: 'person', id: GAURESH }] }), TODAY)
    expect(board.team.map((entry) => entry.person.id)).toEqual([DAN])
  })
})

describe('products', () => {
  it('keeps important product qans, dedupes versions, and lists off-track projects', () => {
    const board = buildDashboard(snapshot({
      qans: [qan({ id: '5', name: 'critical', priorityId: 2, priority: 'Critical', version: 2026.3 }), qan({ id: '5', name: 'critical', priorityId: 2, priority: 'Critical', version: 2027.1 }), qan({ id: '6', name: 'fyi', priorityId: 6, priority: 'FYI' })],
      qanSummary: [{ product: 'SmartTools', priorityId: 2, priority: 'Critical', openCount: 4, escalated: 2, stale: 2 }],
      prjs: [prj({ id: '1', name: 'behind', onTrack: 'Behind Schedule', ownerId: '9', pointPeople: null }), prj({ id: '2', name: 'fine', ownerId: '9', pointPeople: null }), prj({ id: '3', name: 'not on backlog', ownerId: '9', pointPeople: null, onBacklog: 0 })],
    }), config(), TODAY)
    const product = board.products[0]
    expect(product.important.items.map((item) => item.title)).toEqual(['critical'])
    expect(product.important.items[0].loud).toBe(true)
    expect(product.offTrack.items.map((item) => item.title)).toEqual(['behind'])
    expect(product.prjs.items.map((item) => item.title)).toEqual(['behind', 'fine'])
    expect(product.summary[0].openCount).toBe(4)
  })
})

describe('my projects and designs', () => {
  it('finds projects i own through the point people list and flags waiting reviewers on my designs', () => {
    const board = buildDashboard(snapshot({
      prjs: [prj({ id: '1', name: 'owned by role', ownerId: '9', pointPeople: `9:Coordinator,${ME}:Lead` }), prj({ id: '2', name: 'someone elses', ownerId: '9', pointPeople: '9:Owner' })],
      designs: [design({ id: '7', name: 'my design', pendingReviewers: 2, pendingRequired: 1 })],
    }), config(), TODAY)
    expect(board.myPrjs.items.map((item) => item.title)).toEqual(['owned by role'])
    expect(board.waitingOn.items.map((item) => item.meta)).toEqual(['in review · 2 reviewers pending · 1 required · due in 7d'])
  })
})

it('counts days between dates without timezone drift', () => {
  expect(daysBetween('2026-11-01', '2026-11-05')).toBe(4)
  expect(daysBetween('2026-11-05', '2026-11-01')).toBe(-4)
  expect(dlgActivityReason(dlg({ id: 'x', name: 'x', lastBatonPass: '2026-10-30' }), DAN, snapshot(), config().filters, TODAY)).toBe('baton moved 6d ago')
})
