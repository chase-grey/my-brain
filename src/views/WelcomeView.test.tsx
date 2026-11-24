import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { aiAnswered, aiSettings, firstName, noAiAnswers, WelcomeView } from './WelcomeView'
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

describe('welcome ai step', () => {
  it('waits for each question in turn', () => {
    expect(aiAnswered(noAiAnswers)).toBe(false)
    expect(aiAnswered({ ...noAiAnswers, want: false })).toBe(true)
    expect(aiAnswered({ ...noAiAnswers, want: true })).toBe(false)
    expect(aiAnswered({ ...noAiAnswers, want: true, path: 'paste' })).toBe(true)
    expect(aiAnswered({ ...noAiAnswers, want: true, path: 'key' })).toBe(false)
    expect(aiAnswered({ ...noAiAnswers, want: true, path: 'key', key: 'sk-ant-1' })).toBe(true)
    // The provider with no address of its own needs one typed, and a model.
    expect(aiAnswered({ ...noAiAnswers, want: true, path: 'key', key: 'k', provider: 'custom' })).toBe(false)
    expect(aiAnswered({ ...noAiAnswers, want: true, path: 'key', key: 'k', provider: 'custom', baseUrl: 'http://localhost:1234/v1' })).toBe(false)
    expect(aiAnswered({ ...noAiAnswers, want: true, path: 'key', key: 'k', provider: 'custom', baseUrl: 'http://localhost:1234/v1', model: 'llama' })).toBe(true)
    expect(aiSettings({ ...noAiAnswers, want: true, path: 'key', key: 'k', provider: 'custom', baseUrl: 'http://localhost:1234/v1/', model: ' llama ' })).toEqual({ aiMode: 'key', aiProvider: 'custom', aiBaseUrl: 'http://localhost:1234/v1', aiModel: 'llama', anthropicApiKey: 'k', jevApiKey: '' })
  })

  it('starts on anthropic and keeps a jev key beside it', () => {
    expect(aiSettings({ ...noAiAnswers, want: true, path: 'key', key: ' sk-ant-1 ', jevKey: ' jev-1 ' })).toEqual({ aiMode: 'key', aiProvider: 'anthropic', aiBaseUrl: '', aiModel: '', anthropicApiKey: 'sk-ant-1', jevApiKey: 'jev-1' })
  })

  it('sends another provider its own key, without jev', () => {
    expect(aiSettings({ ...noAiAnswers, want: true, path: 'key', provider: 'openai', key: 'sk-1', jevKey: 'jev-1' })).toEqual({ aiMode: 'key', aiProvider: 'openai', aiBaseUrl: '', aiModel: '', anthropicApiKey: 'sk-1', jevApiKey: '' })
  })

  it('keeps no key for copy and paste or for not now', () => {
    expect(aiSettings({ ...noAiAnswers, want: true, path: 'paste', key: 'typed-then-changed-mind' })).toEqual({ aiMode: 'paste', aiProvider: 'anthropic', aiBaseUrl: '', aiModel: '', anthropicApiKey: '', jevApiKey: '' })
    expect(aiSettings({ ...noAiAnswers, want: false, path: 'key', key: 'typed-then-changed-mind' }).aiMode).toBe('off')
    expect(aiSettings({ ...noAiAnswers, want: false, path: 'key', key: 'typed-then-changed-mind' }).anthropicApiKey).toBe('')
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
