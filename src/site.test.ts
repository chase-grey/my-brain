import { describe, expect, it } from 'vitest'
import { besideThisApp, keepSignIn, signInReturnUrl } from './site'

describe('signInReturnUrl', () => {
  it('is the app itself on the published site', () => {
    expect(signInReturnUrl('https://chase-grey.github.io', '/my-brain/')).toBe('https://chase-grey.github.io/my-brain/')
  })

  it('is the root on localhost, wherever the app sits under it', () => {
    expect(signInReturnUrl('http://localhost:5270', '/my-brain/')).toBe('http://localhost:5270/')
    expect(signInReturnUrl('http://localhost:5173', '/')).toBe('http://localhost:5173/')
    expect(signInReturnUrl('https://localhost', '/')).toBe('https://localhost/')
  })
})

describe('besideThisApp', () => {
  const mail = 'https://chase-grey.github.io/my-mail/'

  it('leaves links alone on the published site', () => {
    expect(besideThisApp(mail, 'https://chase-grey.github.io', '/my-brain/')).toBe(mail)
  })

  it('points at the copy beside a local one', () => {
    expect(besideThisApp(mail, 'http://localhost:5270', '/my-brain/')).toBe('http://localhost:5270/my-mail/')
    expect(besideThisApp(`${mail}#chat`, 'http://localhost:5270', '/my-brain/')).toBe('http://localhost:5270/my-mail/#chat')
  })

  it('leaves links alone where the app is served alone: the dev server and the android shell', () => {
    expect(besideThisApp(mail, 'http://localhost:5173', '/')).toBe(mail)
    expect(besideThisApp(mail, 'https://localhost', '/')).toBe(mail)
  })

  it('leaves a link to anywhere else alone', () => {
    expect(besideThisApp('https://example.com/mail/', 'http://localhost:5270', '/my-brain/')).toBe('https://example.com/mail/')
    expect(besideThisApp('', 'http://localhost:5270', '/my-brain/')).toBe('')
  })
})

describe('keepSignIn', () => {
  it('gives the key to the saved sign-in a life past the browser closing', () => {
    const jar = { cookie: 'other=1; msal.cache.encryption=%7B%22id%22%3A%22a%22%7D' }
    keepSignIn(jar)
    expect(jar.cookie).toBe('msal.cache.encryption=%7B%22id%22%3A%22a%22%7D;path=/;SameSite=None;Secure;max-age=7776000')
  })

  it('writes nothing before there is a sign-in to keep', () => {
    const jar = { cookie: 'other=1' }
    keepSignIn(jar)
    expect(jar.cookie).toBe('other=1')
  })
})
