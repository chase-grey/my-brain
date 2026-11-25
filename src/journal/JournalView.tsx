import { useCallback, useEffect, useRef, useState } from 'react'
import { holdUpdates } from '../appUpdate'
import type { Attachment } from '../companion/attachments'
import type { VaultStore } from '../companion/githubVault'
import { Icon } from '../navIcons'
import { Empty } from '../ui'
import { dictate, recognitionSupported } from '../voice/speech'
import { endMessage } from '../voice/useVoice'
import { dayLabel, entryBlock, entryParts, journalAttachment, journalDays, journalPath, loadDraft, saveDraft } from './journal'

/** The days with an entry, as a list to pick from. The chat uses it too. */
export function JournalDays({ days, onOpen }: { days: string[] | undefined; onOpen: (day: string) => void }) {
  if (!days) return <Empty>loading</Empty>
  if (!days.length) return <Empty>no entries yet</Empty>
  return <ul className="history-list" aria-label="journal entries">
    {days.map((day) => <li key={day}><button className="history-main" type="button" onClick={() => onOpen(day)}><span className="history-title">{dayLabel(day)}</span></button></li>)}
  </ul>
}

/**
 * The journal: say or type whatever is on your mind and save it under today. Nothing here goes to the ai.
 * An entry reaches the chat only when it is added to a message by hand.
 */
export function JournalView({ vault, onSettings, onChat }: {
  vault?: VaultStore
  onSettings: () => void
  /** Open the chat with this entry attached to the next message. */
  onChat: (attachment: Attachment) => void
}) {
  const [days, setDays] = useState<string[]>()
  const [open, setOpen] = useState<{ day: string; content?: string }>()
  const [draft, setDraftValue] = useState(loadDraft)
  const draftRef = useRef(draft)
  const [listening, setListening] = useState(false)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string>()
  const cancelRef = useRef<() => void>(() => {})
  const canListen = recognitionSupported()

  const setDraft = useCallback((text: string) => {
    draftRef.current = text
    setDraftValue(text)
    saveDraft(text)
  }, [])

  // A reload would stop the listening; the words themselves are already kept on the device.
  useEffect(() => (listening || saving ? holdUpdates() : undefined), [listening, saving])

  const load = useCallback(() => {
    if (!vault) return
    vault.listNotes().then((notes) => setDays(journalDays(notes))).catch(() => { setDays((current) => current ?? []); setProblem("couldn't load the journal") })
  }, [vault])
  useEffect(load, [load])

  const stop = useCallback(() => {
    cancelRef.current()
    cancelRef.current = () => {}
    setListening(false)
  }, [])

  // A brain dump has long silences in it, so listening only ends when it is told to: each time the recognizer
  // decides the speaker has finished, it is started again after the words so far.
  const listen = useCallback(() => {
    const before = draftRef.current.trim()
    setListening(true)
    setProblem(undefined)
    cancelRef.current = dictate({
      text: (text) => setDraft([before, text].filter(Boolean).join(' ')),
      end: (reason) => {
        if (reason === 'pause' || reason === 'silence') return listen()
        cancelRef.current = () => {}
        setListening(false)
        setProblem(endMessage(reason))
      },
    })
  }, [setDraft])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') stop() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      cancelRef.current()
    }
  }, [stop])

  async function save() {
    const text = draftRef.current.trim()
    if (!text || !vault || saving) return
    stop()
    setSaving(true)
    setProblem(undefined)
    const now = new Date()
    try {
      await vault.appendNote(journalPath(now.toLocaleDateString('en-CA')), entryBlock(text, now))
      setDraft('')
      setOpen(undefined)
      load()
    } catch {
      setProblem("couldn't save · your words are still here")
    } finally {
      setSaving(false)
    }
  }

  function show(day: string) {
    if (!vault) return
    setOpen({ day })
    vault.readNote(journalPath(day))
      .then(({ content }) => setOpen((current) => current?.day === day ? { day, content } : current))
      .catch(() => { setOpen(undefined); setProblem("couldn't open that entry") })
  }

  if (!vault) return <section className="chat" aria-label="journal">
    <header className="view-head"><h1>journal</h1></header>
    <Empty>no notes · <button className="link" type="button" onClick={onSettings}>set them up in settings</button></Empty>
  </section>

  return <section className="chat" aria-label="journal">
    <header className="view-head">
      {open && <button className="icon-button" type="button" aria-label="back to journal" onClick={() => setOpen(undefined)}><Icon name="back" /></button>}
      <h1>{open ? dayLabel(open.day) : 'journal'}</h1>
      {open?.content !== undefined && <button className="pill" type="button" onClick={() => onChat(journalAttachment(open.day, open.content!))}>add to chat</button>}
    </header>
    <div className="thread">
      <div className="chat-history">
        {open
          ? open.content === undefined
            ? <Empty>loading</Empty>
            : <article className="journal-entry">{entryParts(open.content).map((part, index) => part.kind === 'time' ? <h2 key={index}>{part.text}</h2> : <p key={index}>{part.text}</p>)}</article>
          : <JournalDays days={days} onOpen={show} />}
      </div>
      {problem && <p className="journal-problem" role="alert">{problem}</p>}
      <div className={`composer journal-box${canListen ? ' has-mic' : ''}`}>
        <textarea className="composer-input" aria-label="entry" placeholder={listening ? 'listening' : 'what is on your mind'} rows={draft ? 5 : 1} value={draft} onChange={(event) => setDraft(event.target.value)} />
        {canListen && <button className={`composer-mic${listening ? ' is-listening' : ''}`} type="button" aria-pressed={listening} aria-label={listening ? 'stop' : 'talk'} onClick={() => (listening ? stop() : listen())}><Icon name="waveform" size={20} /></button>}
        <button className="composer-send" type="button" aria-label="save" disabled={!draft.trim() || saving} onClick={() => { void save() }}><Icon name="check" size={18} /></button>
      </div>
    </div>
  </section>
}
