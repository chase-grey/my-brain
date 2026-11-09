import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { UsageView } from './UsageView'

it('links each space to the dashboard that bills its chat', () => {
  const personal = renderToStaticMarkup(<UsageView domain="personal" />)
  const work = renderToStaticMarkup(<UsageView domain="work" />)
  expect(personal).toContain('console.anthropic.com/settings/usage')
  expect(personal).toContain('console.anthropic.com/settings/cost')
  expect(personal).not.toContain('claude.ai/settings/usage')
  expect(work).toContain('claude.ai/settings/usage')
  expect(work).not.toContain('console.anthropic.com')
})
