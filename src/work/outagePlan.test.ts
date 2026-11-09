import { describe, expect, it } from 'vitest'
import { config, DAN, design, dlg, GAURESH, ME, prj, qan, review, snapshot, TODAY } from './fixtures'
import { buildOutagePlan, outagePlanMarkdown, workdaysIn } from './outagePlan'

const window = { start: '2026-11-09', end: '2026-11-12' }

describe('outage plan', () => {
  it('counts workdays in the window', () => {
    expect(workdaysIn(window)).toBe(4)
    expect(workdaysIn({ start: '2026-11-07', end: '2026-11-15' })).toBe(5)
  })

  it('collects what needs a backup while i am out and who is around to take it', () => {
    const plan = buildOutagePlan(snapshot({
      designReviews: [
        review({ designId: '1', name: 'approval due while out', required: 1, approvalBy: '2026-11-11' }),
        review({ designId: '2', name: 'optional and far off', required: 0, approvalBy: '2026-12-20' }),
        review({ designId: '3', name: 'neglected', required: 1, approvalBy: '2026-08-01', lastUpdate: '2026-07-01' }),
      ],
      dlgs: [
        dlg({ id: 'baton', name: 'pqa on my desk', statusId: 110, status: 'PQA 1', developerId: DAN, responsibleId: ME, responsibleName: 'Chase Grey', pqa1Id: ME }),
        dlg({ id: 'soon', name: 'dev comp monday', developerId: DAN, pqa1Id: ME, devCompDeadline: '2026-11-09' }),
        dlg({ id: 'mine', name: 'my own deadline', developerId: ME, responsibleId: ME, qa1Deadline: '2026-11-12' }),
        dlg({ id: 'later', name: 'pqa in december', developerId: DAN, pqa1Id: ME, devCompDeadline: '2026-12-15' }),
      ],
      qans: [qan({ id: '8', name: 'my fix', fixerId: ME, priorityId: 2, priority: 'Critical' })],
      prjs: [prj({ id: '1', name: 'readiness in window', plannedReadiness: '2026-11-10' }), prj({ id: '2', name: 'quiet project', plannedDevComp: '2027-01-10' })],
      designs: [design({ id: '9', name: 'my design in review' })],
      outages: [{ employeeId: GAURESH, employeeName: 'Gauresh Walia', type: 'Vacation', startOn: '2026-11-10', endOn: '2026-11-11', isOoo: true, approved: true }],
    }), config(), window, TODAY)

    expect(plan.sections.map((section) => [section.id, section.items.map((item) => item.title)])).toEqual([
      ['decisions', ['approval due while out']],
      ['batons', ['pqa on my desk']],
      ['pqa', ['dev comp monday']],
      ['deadlines', ['my own deadline']],
      ['fixes', ['my fix']],
      ['projects', ['readiness in window']],
      ['designs', ['my design in review']],
    ])
    expect(plan.teamOut.map((outage) => outage.employeeName)).toEqual(['Gauresh Walia'])
    expect(plan.teamIn).toEqual(['Dan Demp'])
    expect(plan.workdays).toBe(4)
    const markdown = outagePlanMarkdown(plan, 'Chase Grey')
    expect(markdown).toContain('# outage plan 2026-11-09 to 2026-11-12')
    expect(markdown).toContain('available: Dan Demp')
    expect(markdown).toContain('- [ ] [pqa on my desk](https://emc2summary.epic.com/GetSummaryReport.ashx/track/DLG/baton) · pqa 1 · baton with me · backup: ')
  })

  it('respects ignores', () => {
    const plan = buildOutagePlan(snapshot({ dlgs: [dlg({ id: 'baton', name: 'ignored baton', responsibleId: ME })] }), config({ ignores: [{ kind: 'dlg', id: 'baton' }] }), window, TODAY)
    expect(plan.sections).toEqual([])
  })
})
