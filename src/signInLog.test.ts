import { describe, expect, it } from 'vitest'
import { answerShape, errorWords, mergeLogs, noteSignIn, scrub, signInLog } from './signInLog'

function store(): Pick<Storage, 'getItem' | 'setItem'> {
  const kept = new Map<string, string>()
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => { kept.set(key, value) } }
}

describe('the sign-in log', () => {
  it('keeps each step with its time, newest last', () => {
    const kept = store()
    noteSignIn('sign in', { how: 'redirect' }, kept, new Date('2026-11-25T18:00:00Z'))
    noteSignIn('page leaving', undefined, kept, new Date('2026-11-25T18:00:01Z'))
    expect(signInLog(kept)).toBe('2026-11-25T18:00:00.000Z sign in how=redirect\n2026-11-25T18:00:01.000Z page leaving')
  })

  it('drops the oldest lines past its length', () => {
    const kept = store()
    for (let index = 0; index < 200; index += 1) noteSignIn(`step ${index}`, undefined, kept)
    const lines = signInLog(kept).split('\n')
    expect(lines).toHaveLength(150)
    expect(lines.at(-1)).toMatch(/step 199$/)
  })

  it('never keeps a token, a code or an email', () => {
    const token = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.abcdefghijklmnopqrstuvwxyz0123456789'
    expect(scrub(`got ${token} for sam@example.com`)).toBe('got … for …')
    const kept = store()
    noteSignIn('answer', { code: token }, kept)
    expect(signInLog(kept)).not.toContain(token)
  })

  it('names what microsoft sent back without its values', () => {
    expect(answerShape('#code=M.C123_secret&state=abc&client_info=xyz')).toBe('fields code,state,client_info')
    expect(answerShape('#error=access_denied&error_subcode=cancel&state=abc')).toBe('fields error,error_subcode,state error=access_denied error_subcode=cancel')
    expect(answerShape('')).toBe('nothing')
  })

  it('keeps the reason under a timed out sign-in', () => {
    expect(errorWords({ errorCode: 'timed_out', subError: 'failed_to_redirect', errorMessage: '' })).toBe('timed_out · failed_to_redirect')
    expect(errorWords(new TypeError('failed to fetch'))).toBe('TypeError · failed to fetch')
  })

  it('puts the lines from the shell among the lines from the app by time', () => {
    const app = '2026-11-25T18:00:00.000Z sign in\n2026-11-25T18:00:09.000Z start'
    const shell = '2026-11-25T18:00:01.500Z webview page started https://login.live.com/'
    expect(mergeLogs(app, shell).split('\n').map((line) => line.slice(25))).toEqual(['sign in', 'webview page started https://login.live.com/', 'start'])
    expect(mergeLogs(app, '')).toBe(app)
  })
})
