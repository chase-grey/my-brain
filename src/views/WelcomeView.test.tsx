import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { firstName, WelcomeView } from './WelcomeView'
import { SetupLanding, setupLanding } from './SetupLanding'

describe('welcome', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('opens on the questions when there is no microsoft app to connect', () => {
    // A dev machine's .env.local sets the client id; this is the screen without one.
    vi.stubEnv('VITE_MICROSOFT_CLIENT_ID', '')
    const html = renderToStaticMarkup(<WelcomeView onDone={() => {}} />)
    expect(html).toContain('about you')
    expect(html).toContain('name')
    expect(html).toContain('step 1 of 2')
  })

  it('starts the name from the microsoft account', () => {
    expect(firstName('Chase Grey')).toBe('Chase')
    expect(firstName('  ')).toBe('')
    expect(firstName(undefined)).toBe('')
  })
})

describe('setup link landing', () => {
  it('offers the home screen only to a phone still in a browser tab', () => {
    expect(setupLanding({ handheld: true, standalone: false })).toBe('install')
    expect(setupLanding({ handheld: true, standalone: true })).toBe('today')
    expect(setupLanding({ handheld: false, standalone: false })).toBe('today')
  })

  it('greets by name', () => {
    expect(renderToStaticMarkup(<SetupLanding name="Sam" onDone={() => {}} />)).toContain('welcome, Sam')
  })
})
