import { describe, expect, it } from 'vitest'
import { besideThisApp, signInReturnUrl } from './site'

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
