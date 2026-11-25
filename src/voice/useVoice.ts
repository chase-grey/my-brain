import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { dictate, recognitionSupported, speak, speakable, synthesisSupported, type DictationEnd } from './speech'
import { asksToStopListening } from './stopPhrase'

export type VoiceState = 'idle' | 'listening' | 'speaking'

export function endMessage(reason: DictationEnd): string | undefined {
  if (reason === 'blocked') return 'microphone blocked · allow it for this site'
  if (reason === 'unavailable') return 'speech recognition needs a microphone and a connection'
  if (reason === 'error') return 'speech recognition failed'
  return undefined
}

/**
 * Talking with the chat. The mic starts a conversation: it listens until the speaker stops, hands the message over to be
 * sent, reads the reply aloud, and listens again. It ends on a second tap, on the words "stop listening", or when the app is
 * hidden. Quiet does not end it: it keeps listening.
 * Words are handed over as they are heard, so they sit in the message box and are never lost when listening ends.
 */
export function useVoice({ onListen, onText, onSend, onProblem }: {
  /** Listening is about to start. */
  onListen: () => void
  /** Everything heard so far in this message. */
  onText: (text: string) => void
  /** The speaker has stopped; the message is ready to go. */
  onSend: () => void
  onProblem: (message: string) => void
}) {
  const supported = useMemo(() => recognitionSupported(), [])
  const canSpeak = useMemo(() => synthesisSupported(), [])
  const [state, setStateValue] = useState<VoiceState>('idle')
  const [on, setOnValue] = useState(false)
  const stateRef = useRef<VoiceState>('idle')
  const onRef = useRef(false)
  const cancelRef = useRef<() => void>(() => {})
  const listenAgain = useRef<() => void>(() => {})
  const handlers = useRef({ onListen, onText, onSend, onProblem })
  handlers.current = { onListen, onText, onSend, onProblem }

  const setState = useCallback((next: VoiceState) => { stateRef.current = next; setStateValue(next) }, [])
  const setOn = useCallback((next: boolean) => { onRef.current = next; setOnValue(next) }, [])

  /** Stops listening or speaking without ending the conversation. */
  const quiet = useCallback(() => {
    cancelRef.current()
    cancelRef.current = () => {}
    setState('idle')
  }, [setState])

  const stop = useCallback(() => {
    setOn(false)
    quiet()
  }, [quiet, setOn])

  const listenNow = useCallback(() => {
    cancelRef.current()
    setState('listening')
    handlers.current.onListen()
    let heard = ''
    cancelRef.current = dictate({
      text: (text) => { heard = text; handlers.current.onText(text) },
      end: (reason) => {
        cancelRef.current = () => {}
        setState('idle')
        if (reason === 'pause') {
          if (asksToStopListening(heard)) {
            handlers.current.onText('')
            setOn(false)
          } else handlers.current.onSend()
          return
        }
        if (reason === 'silence' && onRef.current) {
          listenAgain.current()
          return
        }
        setOn(false)
        const problem = endMessage(reason)
        if (problem) handlers.current.onProblem(problem)
      },
    })
  }, [setOn, setState])
  listenAgain.current = listenNow

  const start = useCallback(() => {
    setOn(true)
    listenNow()
  }, [listenNow, setOn])

  /** Reads a reply aloud while a conversation is on, then listens again, or ends the conversation after an error. */
  const say = useCallback((markdown: string, then: 'listen' | 'stop' = 'listen') => {
    if (!onRef.current) return
    const next = () => {
      if (then === 'listen' && onRef.current) listenNow()
      else stop()
    }
    const text = canSpeak ? speakable(markdown) : ''
    if (!text) {
      next()
      return
    }
    cancelRef.current()
    setState('speaking')
    const utterance = speak(text)
    let cancelled = false
    cancelRef.current = () => { cancelled = true; utterance.cancel() }
    void utterance.done.then(() => {
      if (cancelled) return
      cancelRef.current = () => {}
      next()
    })
  }, [canSpeak, listenNow, setState, stop])

  /** The mic button: cut a spoken reply short and listen, end the conversation, or start one. */
  const toggle = useCallback(() => {
    if (stateRef.current === 'speaking') listenNow()
    else if (onRef.current) stop()
    else start()
  }, [listenNow, start, stop])

  /** The message was sent by hand while listening: stop hearing it, and still read the reply. */
  const sent = useCallback(() => {
    if (stateRef.current === 'listening') quiet()
  }, [quiet])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      cancelRef.current()
    }
  }, [stop])

  return { supported, state, on, start, stop, say, toggle, sent }
}
