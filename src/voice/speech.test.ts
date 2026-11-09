import { expect, it } from 'vitest'
import { chunksForSpeech, speakable } from './speech'
import { nativeEndReason } from './nativeSpeech'
import { afterSilentListen, endMessage, silenceLimit } from './useVoice'

it('reads markdown as plain sentences', () => {
  expect(speakable('## today\n\n- **call plumber** · due *today*\n- buy [milk](https://x.y/z)\n\nsee https://example.com for more'))
    .toBe('today. call plumber · due today. buy milk. see link for more.')
})

it('skips code, html, and table rules but keeps table cells', () => {
  expect(speakable('run this:\n\n```sh\nnpm test\n```\n\n| task | when |\n|---|---|\n| dishes | tonight |\n\n<br>done `now`'))
    .toBe('run this: code. task, when. dishes, tonight. done now.')
})

it('leaves punctuation alone and drops empty lines', () => {
  expect(speakable('all set!\n\n\nanything else?')).toBe('all set! anything else?')
  expect(speakable('')).toBe('')
})

it('splits long text at sentence ends', () => {
  const text = 'one is here. two follows. three is the end.'
  expect(chunksForSpeech(text, 22)).toEqual(['one is here.', 'two follows.', 'three is the end.'])
  expect(chunksForSpeech(text, 500)).toEqual([text])
  expect(chunksForSpeech('no punctuation at all', 5)).toEqual(['no punctuation at all'])
})

it('hands-free retries silence a few times then switches off', () => {
  let silences = 0
  for (let i = 1; i < silenceLimit; i++) {
    const next = afterSilentListen('silence', silences, true)
    expect(next).toEqual({ listenAgain: true, handsFree: true, silences: i })
    silences = next.silences
  }
  expect(afterSilentListen('silence', silences, true)).toEqual({ listenAgain: false, handsFree: false, silences: 0 })
})

it('hands-free stops on real problems and never restarts when off or cancelled', () => {
  expect(afterSilentListen('blocked', 0, true)).toEqual({ listenAgain: false, handsFree: false, silences: 0 })
  expect(afterSilentListen('cancelled', 2, true)).toEqual({ listenAgain: false, handsFree: true, silences: 0 })
  expect(afterSilentListen('silence', 0, false)).toEqual({ listenAgain: false, handsFree: false, silences: 0 })
})

it('only explains the endings the user can do something about', () => {
  expect(endMessage('blocked')).toContain('microphone')
  expect(endMessage('unavailable')).toContain('connection')
  expect(endMessage('silence')).toBeUndefined()
  expect(endMessage('done')).toBeUndefined()
})

it('maps the android recognizer messages onto the same endings', () => {
  expect(nativeEndReason('No match')).toBe('silence')
  expect(nativeEndReason('No speech input')).toBe('silence')
  expect(nativeEndReason('Insufficient permissions')).toBe('blocked')
  expect(nativeEndReason('Network timeout')).toBe('unavailable')
  expect(nativeEndReason('Client side error')).toBe('error')
})
