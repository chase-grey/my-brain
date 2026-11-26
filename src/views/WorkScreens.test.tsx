import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkScreens, WorkScreensNotice } from './WorkScreens'

it('says loading until the work screens arrive', () => {
  expect(renderToStaticMarkup(<WorkScreens currentDay="2026-11-26" />)).toContain('>loading<')
})

it('says the bridge is not running and how to start it', () => {
  const html = renderToStaticMarkup(<WorkScreensNotice state={{ kind: 'away' }} />)
  expect(html).toContain('work bridge isn&#x27;t running')
  expect(html).toContain('npm run bridge')
})

it('shows what went wrong when the bridge sent something broken', () => {
  expect(renderToStaticMarkup(<WorkScreensNotice state={{ kind: 'failed', message: 'work bridge returned no work screens' }} />)).toContain('no work screens')
})

it('shows nothing of its own once the screens are drawn', () => {
  expect(renderToStaticMarkup(<WorkScreensNotice state={{ kind: 'ready' }} />)).toBe('')
})
