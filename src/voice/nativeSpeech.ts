// The android shell's webview has no speech recognition and unreliable speech synthesis, so inside the shell
// both go through the phone's own recognizer and text-to-speech engine. Same contract as the browser versions.
import type { ListenEnd, ListenEvent } from './speech'

export function nativeEndReason(message: string): ListenEnd {
  const text = message.toLowerCase()
  if (text.includes('no match') || text.includes('no speech')) return 'silence'
  if (text.includes('permission')) return 'blocked'
  if (text.includes('network') || text.includes('not available') || text.includes('busy')) return 'unavailable'
  return 'error'
}

/** One utterance through android's recognizer. No interim text arrives this way; the final text comes when it ends. */
export function listenNatively(on: (event: ListenEvent) => void, lang: string): () => void {
  let cancelled = false
  let stop: (() => Promise<void>) | undefined
  const end = (reason: ListenEnd) => on({ kind: 'end', reason: cancelled ? 'cancelled' : reason })
  void (async () => {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
      stop = () => SpeechRecognition.stop()
      if (!(await SpeechRecognition.available()).available) return end('unavailable')
      if ((await SpeechRecognition.requestPermissions()).speechRecognition !== 'granted') return end('blocked')
      if (cancelled) return end('cancelled')
      const { matches } = await SpeechRecognition.start({ language: lang, maxResults: 1, partialResults: false, popup: false })
      const text = matches?.[0]?.trim() ?? ''
      if (cancelled || !text) return end('silence')
      on({ kind: 'final', text })
      end('done')
    } catch (error) {
      end(nativeEndReason(error instanceof Error ? error.message : String(error)))
    }
  })()
  return () => {
    cancelled = true
    void stop?.().catch(() => {})
  }
}

/** Reads text through android's text-to-speech engine. `done` settles when it finishes or is stopped; never rejects. */
export function speakNatively(text: string, lang: string): { done: Promise<void>; cancel: () => void } {
  let stop: (() => Promise<void>) | undefined
  let settle = () => {}
  const done = new Promise<void>((resolve) => { settle = resolve })
  void (async () => {
    try {
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech')
      stop = () => TextToSpeech.stop()
      await TextToSpeech.speak({ text, lang, rate: 1.0 })
    } catch {
      // Nothing to hear is not worth an error; the caller moves on either way.
    } finally {
      settle()
    }
  })()
  return {
    done,
    cancel: () => {
      void stop?.().catch(() => {})
      settle()
    },
  }
}
