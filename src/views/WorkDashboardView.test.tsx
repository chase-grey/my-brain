import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { config, DAN, dlg, ME, prj, qan, review, snapshot, TODAY } from '../work/fixtures'
import { WorkDashboardView } from './WorkDashboardView'

const loaded = snapshot({
  designReviews: [review({ designId: '1', name: 'Skills in Factory', required: 1, approvalBy: '2026-11-06' })],
  dlgs: [
    dlg({ id: 'a', name: 'Letter Generation', statusId: 110, status: 'PQA 1', developerId: DAN, responsibleId: ME, responsibleName: 'Chase Grey', daysInStatus: 6 }),
    dlg({ id: 'old', name: 'Prototype from 2024', developerId: DAN, responsibleId: DAN, daysInStatus: 900 }),
  ],
  prjs: [prj({ id: '1', name: 'Behind project', onTrack: 'Behind Schedule', ownerId: '9', pointPeople: null })],
  qans: [qan({ id: '5', name: 'Critical thing', priorityId: 2, priority: 'Critical' })],
  qanSummary: [{ product: 'SmartTools', priorityId: 2, priority: 'Critical', openCount: 4, escalated: 2, stale: 2 }],
})

it('renders attention, team, and product cards from a snapshot', () => {
  const html = renderToStaticMarkup(<WorkDashboardView currentDay={TODAY} initial={{ snapshot: loaded, config: config() }} />)
  expect(html).toContain('needs me')
  expect(html).toContain('Skills in Factory')
  expect(html).toContain('Letter Generation')
  expect(html).toContain('dan demp')
  expect(html).toContain('1 parked')
  expect(html).not.toContain('Prototype from 2024')
  expect(html).toContain('smarttools quality')
  expect(html).toContain('4 open')
  expect(html).toContain('Behind project')
  expect(html).toContain('https://emc2summary.epic.com/GetSummaryReport.ashx/track/DLG/a')
})

it('shows the outage card when a window is configured', () => {
  const html = renderToStaticMarkup(<WorkDashboardView currentDay={TODAY} initial={{ snapshot: loaded, config: config({ outage: { start: '2026-11-09', end: '2026-11-12' } }) }} />)
  expect(html).toContain('4 workdays')
  expect(html).toContain('batons i hold')
  expect(html).toContain('copy plan')
})
