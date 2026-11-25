import { expect, it } from 'vitest'
import { asksToStopListening } from './stopPhrase'

it('takes the phrase on its own, however the recognizer writes it', () => {
  for (const heard of ['stop listening', 'Stop listening.', ' STOP  LISTENING! ', 'okay, stop listening please', 'stop listening now']) {
    expect(asksToStopListening(heard), heard).toBe(true)
  }
})

it('leaves a message that only contains the phrase alone', () => {
  for (const heard of ['', 'stop', 'listening', 'remind me to stop listening to the news', 'stop listening to that podcast', 'add milk. stop listening']) {
    expect(asksToStopListening(heard), heard).toBe(false)
  }
})
