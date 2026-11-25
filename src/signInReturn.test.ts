import { describe, expect, it } from 'vitest'
import { isSignInResponse, keptSignInResponse, rememberPlace, signInArrival, signInWindowMs, takeSignInResponse } from './signInReturn'

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}

describe('coming back from a microsoft sign-in', () => {
  it('knows the answer in the hash or the query, and nothing else', () => {
    expect(isSignInResponse('#code=abc&state=xyz', '')).toBe(true)
    expect(isSignInResponse('#error=access_denied&state=xyz', '')).toBe(true)
    expect(isSignInResponse('', '?code=abc&state=xyz')).toBe(true)
    expect(isSignInResponse('#settings', '')).toBe(false)
    expect(isSignInResponse('#code=abc', '')).toBe(false)
  })

  it('passes a popup or frame answer to the window that asked, in the shell too', () => {
    expect(signInArrival(true, true, false)).toBe('pass')
    expect(signInArrival(true, false, false)).toBe('pass')
    // The frame that renews a sign-in inside the shell: starting the app there left the renewal to time out.
    expect(signInArrival(true, true, true)).toBe('pass')
  })

  it('keeps the answer only on the shell page that left for microsoft whole', () => {
    expect(signInArrival(true, false, true)).toBe('keep')
    expect(signInArrival(false, false, true)).toBe('none')
    expect(signInArrival(false, true, false)).toBe('none')
  })

  it('comes back to the screen the sign-in was started from, with the answer out of the address', () => {
    const store = memory()
    rememberPlace(store, '#settings')
    let address = ''
    takeSignInResponse(store, { hash: '#code=abc&state=xyz', pathname: '/', search: '' }, (url) => { address = url })
    expect(address).toBe('/#settings')
    expect(store.values.size).toBe(0)
    expect(keptSignInResponse()).toBe('#code=abc&state=xyz')
  })

  it('gives the answer out once', () => {
    takeSignInResponse(memory(), { hash: '#error=access_denied&state=xyz', pathname: '/', search: '' }, () => {})
    expect(keptSignInResponse()).toBe('#error=access_denied&state=xyz')
    expect(keptSignInResponse()).toBeUndefined()
  })

  it('comes back to the bare page when no screen was remembered', () => {
    let address = ''
    takeSignInResponse(memory(), { hash: '#code=abc&state=xyz', pathname: '/', search: '' }, (url) => { address = url })
    expect(address).toBe('/')
    keptSignInResponse()
  })

  it('leaves a sign-in window open long enough to type a password and a code', () => {
    expect(signInWindowMs).toBeGreaterThanOrEqual(5 * 60_000)
  })
})
