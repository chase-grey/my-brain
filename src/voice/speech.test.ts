import { describe, expect, it, vi } from 'vitest'
import { chunksForSpeech, dictate, pauseMs, silenceMs, speakable, type ListenEnd, type ListenEvent, type listen } from './speech'
import { nativeEndReason } from './nativeSpeech'
import { endMessage } from './useVoice'

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

describe('hearing a whole message', () => {
  // A recognizer that hears whatever the test feeds it, one stretch at a time.
  function recognizer() {
    const stretches: { on: (event: ListenEvent) => void; cancelled: boolean }[] = []
    const hear = ((on: (event: ListenEvent) => void) => {
      const stretch = { on, cancelled: false }
      stretches.push(stretch)
      return () => { stretch.cancelled = true }
    }) as typeof listen
    const current = () => stretches[stretches.length - 1]
    return {
      hear,
      count: () => stretches.length,
      cancelled: () => current().cancelled,
      interim: (text: string) => current().on({ kind: 'interim', text }),
      // The way a real stretch closes at a breath: its words, then its end.
      breath: (text: string) => { current().on({ kind: 'final', text }); current().on({ kind: 'end', reason: 'done' }) },
      end: (reason: ListenEnd) => current().on({ kind: 'end', reason }),
    }
  }

  function start() {
    vi.useFakeTimers()
    const voice = recognizer()
    const text = vi.fn()
    const end = vi.fn()
    const cancel = dictate({ text, end }, { hear: voice.hear })
    return { voice, text, end, cancel }
  }

  it('keeps listening through a pause and joins what came before and after it', () => {
    const { voice, text, end } = start()
    voice.interim('add milk')
    voice.breath('add milk to the list')
    vi.advanceTimersByTime(pauseMs - 500)
    expect(end).not.toHaveBeenCalled()
    expect(voice.count()).toBe(2)
    voice.interim('and also eggs')
    expect(text).toHaveBeenLastCalledWith('add milk to the list and also eggs')
    vi.advanceTimersByTime(pauseMs - 500)
    expect(end).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(end).toHaveBeenCalledExactlyOnceWith('pause')
    expect(voice.cancelled()).toBe(true)
    vi.useRealTimers()
  })

  it('gives up when nothing is said, and not before', () => {
    const { voice, text, end } = start()
    voice.end('silence')
    vi.advanceTimersByTime(silenceMs - 1)
    expect(end).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(end).toHaveBeenCalledExactlyOnceWith('silence')
    expect(text).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not time out as silent once a word has been heard', () => {
    const { voice, end } = start()
    voice.interim('hello')
    vi.advanceTimersByTime(pauseMs)
    expect(end).toHaveBeenCalledExactlyOnceWith('pause')
    vi.advanceTimersByTime(silenceMs)
    expect(end).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('stops on a real problem and says which', () => {
    const { voice, end } = start()
    voice.end('blocked')
    expect(end).toHaveBeenCalledExactlyOnceWith('blocked')
    vi.advanceTimersByTime(silenceMs)
    expect(voice.count()).toBe(1)
    vi.useRealTimers()
  })

  it('ends without a word when cancelled', () => {
    const { voice, end, cancel } = start()
    voice.interim('never mind')
    cancel()
    vi.advanceTimersByTime(silenceMs + pauseMs)
    expect(end).not.toHaveBeenCalled()
    expect(voice.cancelled()).toBe(true)
    vi.useRealTimers()
  })
})

it('only explains the endings the user can do something about', () => {
  expect(endMessage('blocked')).toContain('microphone')
  expect(endMessage('unavailable')).toContain('connection')
  expect(endMessage('silence')).toBeUndefined()
  expect(endMessage('pause')).toBeUndefined()
})

it('maps the android recognizer messages onto the same endings', () => {
  expect(nativeEndReason('No match')).toBe('silence')
  expect(nativeEndReason('No speech input')).toBe('silence')
  expect(nativeEndReason('Insufficient permissions')).toBe('blocked')
  expect(nativeEndReason('Network timeout')).toBe('unavailable')
  expect(nativeEndReason('Client side error')).toBe('error')
})
