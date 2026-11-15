import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WelcomeView } from './WelcomeView'

describe('welcome', () => {
  it('asks for a name and a key, and offers to skip microsoft', () => {
    const html = renderToStaticMarkup(<WelcomeView onDone={() => {}} />)
    expect(html).toContain('my brain')
    expect(html).toContain('name')
    expect(html).toContain('anthropic api key')
    expect(html).toMatch(/connect microsoft|start/)
  })
})
