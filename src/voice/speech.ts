// A thin layer over the browser's own speech APIs, so the chat can listen and talk without a service or a key.
// On Android Chrome recognition goes through Google's recognizer and needs the network; synthesis is on-device.
// Inside the android shell the same two calls go to the phone's recognizer and speech engine instead.
import { isNativeApp } from '../native/platform'
import { listenNatively, speakNatively } from './nativeSpeech'

export type ListenEnd = 'done' | 'silence' | 'blocked' | 'unavailable' | 'cancelled' | 'error'
export type ListenEvent = { kind: 'interim'; text: string } | { kind: 'final'; text: string } | { kind: 'end'; reason: ListenEnd }

type Recognizer = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

function recognizerClass(): (new () => Recognizer) | undefined {
  if (typeof window === 'undefined') return undefined
  const w = window as Window & { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

export function recognitionSupported(): boolean {
  return isNativeApp() || recognizerClass() !== undefined
}

export function synthesisSupported(): boolean {
  return isNativeApp() || (typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function')
}

function endReason(code: string): ListenEnd {
  if (code === 'no-speech') return 'silence'
  if (code === 'not-allowed' || code === 'service-not-allowed') return 'blocked'
  if (code === 'aborted') return 'cancelled'
  if (code === 'network' || code === 'audio-capture') return 'unavailable'
  return 'error'
}

/** Listens for one utterance. Interim text streams in; the final text arrives once, right before `end`. Returns a cancel. */
export function listen(on: (event: ListenEvent) => void, lang = navigator.language): () => void {
  if (isNativeApp()) return listenNatively(on, lang)
  const Recognition = recognizerClass()
  if (!Recognition) {
    on({ kind: 'end', reason: 'unavailable' })
    return () => {}
  }
  const recognizer = new Recognition()
  recognizer.lang = lang
  recognizer.continuous = false
  recognizer.interimResults = true
  let text = ''
  let reason: ListenEnd = 'done'
  let finished = false

  recognizer.onresult = (event) => {
    text = Array.from(event.results).map((result) => result[0]?.transcript ?? '').join('').trim()
    on({ kind: 'interim', text })
  }
  recognizer.onerror = (event) => {
    reason = endReason(event.error)
  }
  recognizer.onend = () => {
    if (finished) return
    finished = true
    if (text && reason !== 'cancelled') on({ kind: 'final', text })
    on({ kind: 'end', reason: text ? 'done' : reason })
  }
  try {
    recognizer.start()
  } catch {
    finished = true
    on({ kind: 'end', reason: 'error' })
  }
  return () => {
    if (finished) return
    reason = 'cancelled'
    text = ''
    recognizer.abort()
  }
}

/** Turns the model's markdown into something worth hearing: no symbols, links read as their text, code skipped. */
export function speakable(markdown: string): string {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, ' code. ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .split('\n')
    .map((line) => line
      .replace(/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/, '')
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/^\s*\|/, '').replace(/\|\s*$/, '').replace(/\s*\|\s*/g, ', ')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(^|\W)[*_](\S(?:.*?\S)?)[*_](?=\W|$)/g, '$1$2')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean)
  return lines.map((line) => /[.!?:;,]$/.test(line) ? line : `${line}.`).join(' ')
}

/** Splits long text at sentence ends so no single utterance is long enough to be cut off. */
export function chunksForSpeech(text: string, max = 200): string[] {
  const chunks: string[] = []
  let current = ''
  for (const sentence of text.match(/[^.!?]+[.!?]*\s*/g) ?? [text]) {
    if (current && current.length + sentence.length > max) {
      chunks.push(current.trim())
      current = ''
    }
    current += sentence
  }
  if (current.trim()) chunks.push(current.trim())
  return chunks
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices()
  const prefix = lang.split('-')[0]
  return voices.find((voice) => voice.lang === lang && voice.localService)
    ?? voices.find((voice) => voice.lang === lang)
    ?? voices.find((voice) => voice.lang.startsWith(prefix))
}

/** Speaks text aloud. `done` settles when the last chunk ends or is cancelled; it never rejects. */
export function speak(text: string, lang = navigator.language): { done: Promise<void>; cancel: () => void } {
  if (!text.trim()) return { done: Promise.resolve(), cancel: () => {} }
  if (isNativeApp()) return speakNatively(text, lang)
  if (!synthesisSupported()) return { done: Promise.resolve(), cancel: () => {} }
  speechSynthesis.cancel()
  const voice = pickVoice(lang)
  const chunks = chunksForSpeech(text)
  let settle = () => {}
  const done = new Promise<void>((resolve) => { settle = resolve })
  let remaining = chunks.length
  const finishOne = () => { if (--remaining <= 0) settle() }
  for (const chunk of chunks) {
    const utterance = new SpeechSynthesisUtterance(chunk)
    utterance.lang = lang
    if (voice) utterance.voice = voice
    utterance.onend = finishOne
    utterance.onerror = finishOne
    speechSynthesis.speak(utterance)
  }
  return {
    done,
    cancel: () => {
      speechSynthesis.cancel()
      settle()
    },
  }
}
