import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen, recognitionSupported, speak, speakable, synthesisSupported, type ListenEnd } from './speech'

export type VoiceState = 'idle' | 'listening' | 'speaking'

/** How many empty listens in a row hands-free tolerates before switching itself off. */
export const silenceLimit = 3

/** What hands-free does when a listen ends without text: try again a few times, then give up quietly. */
export function afterSilentListen(reason: ListenEnd, silences: number, handsFree: boolean): { listenAgain: boolean; handsFree: boolean; silences: number } {
  if (!handsFree || reason === 'cancelled') return { listenAgain: false, handsFree, silences: 0 }
  if (reason === 'silence') {
    const next = silences + 1
    return next >= silenceLimit ? { listenAgain: false, handsFree: false, silences: 0 } : { listenAgain: true, handsFree: true, silences: next }
  }
  return { listenAgain: false, handsFree: false, silences: 0 }
}

export function endMessage(reason: ListenEnd): string | undefined {
  if (reason === 'blocked') return 'microphone blocked · allow it for this site'
  if (reason === 'unavailable') return 'speech recognition needs a microphone and a connection'
  if (reason === 'error') return 'speech recognition failed'
  return undefined
}

/**
 * Listening and talking for the chat. One tap on the mic hears one message and sends it. Hands-free keeps going:
 * it listens, sends, speaks the reply, and listens again, until it is turned off or hears nothing a few times.
 */
export function useVoice({ onTranscript, onProblem }: {
  onTranscript: (text: string) => void
  onProblem: (message: string) => void
}) {
  const supported = useMemo(() => recognitionSupported(), [])
  const canSpeak = useMemo(() => synthesisSupported(), [])
  const [state, setState] = useState<VoiceState>('idle')
  const [transcript, setTranscript] = useState('')
  const [handsFree, setHandsFreeState] = useState(false)
  const handsFreeRef = useRef(false)
  const silencesRef = useRef(0)
  const cancelRef = useRef<() => void>(() => {})
  const onTranscriptRef = useRef(onTranscript)
  const onProblemRef = useRef(onProblem)
  onTranscriptRef.current = onTranscript
  onProblemRef.current = onProblem

  const stop = useCallback(() => {
    cancelRef.current()
    cancelRef.current = () => {}
    setTranscript('')
    setState('idle')
  }, [])

  const startListening = useCallback(() => {
    cancelRef.current()
    setTranscript('')
    setState('listening')
    cancelRef.current = listen((event) => {
      if (event.kind === 'interim') setTranscript(event.text)
      if (event.kind === 'final') onTranscriptRef.current(event.text)
      if (event.kind === 'end') {
        cancelRef.current = () => {}
        setTranscript('')
        setState('idle')
        if (event.reason === 'done') {
          silencesRef.current = 0
          return
        }
        const problem = endMessage(event.reason)
        if (problem) onProblemRef.current(problem)
        const next = afterSilentListen(event.reason, silencesRef.current, handsFreeRef.current)
        silencesRef.current = next.silences
        if (next.handsFree !== handsFreeRef.current) {
          handsFreeRef.current = next.handsFree
          setHandsFreeState(next.handsFree)
        }
        if (next.listenAgain) startListening()
      }
    })
  }, [])

  const setHandsFree = useCallback((next: boolean) => {
    handsFreeRef.current = next
    silencesRef.current = 0
    setHandsFreeState(next)
    if (next) startListening()
    else stop()
  }, [startListening, stop])

  /** Reads a reply aloud, then in hands-free goes back to listening. Does nothing when hands-free is off. */
  const say = useCallback((markdown: string) => {
    if (!handsFreeRef.current) return
    const text = canSpeak ? speakable(markdown) : ''
    if (!text) {
      startListening()
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
      if (handsFreeRef.current) startListening()
      else setState('idle')
    })
  }, [canSpeak, startListening])

  /** The mic button: stop whatever is happening, otherwise hear one message. */
  const toggle = useCallback(() => {
    if (state === 'speaking') {
      stop()
      if (handsFreeRef.current) startListening()
      return
    }
    if (state === 'listening') {
      stop()
      return
    }
    startListening()
  }, [startListening, state, stop])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') { handsFreeRef.current = false; setHandsFreeState(false); stop() } }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      cancelRef.current()
    }
  }, [stop])

  return { supported, canSpeak, state, transcript, handsFree, setHandsFree, say, toggle, stop }
}
