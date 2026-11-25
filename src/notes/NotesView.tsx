import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { holdUpdates } from '../appUpdate'
import type { Attachment } from '../companion/attachments'
import type { VaultNote, VaultStore } from '../companion/githubVault'
import type { Domain } from '../domain/types'
import { dayLabel, entryBlock, entryParts, journalFolder, journalPath, loadDraft, saveDraft, withNewEntry, type JournalStore } from '../journal/journal'
import { Icon } from '../navIcons'
import type { AppSettings } from '../settings'
import { Empty, Menu } from '../ui'
import { dictate, recognitionSupported, voiceAllowed } from '../voice/speech'
import { endMessage } from '../voice/useVoice'
import { NoteEditor } from './NoteEditor'
import { findNotes, folderName, inJournal, keepUnsaved, listFolder, loadUnsaved, mergeNote, newNotePath, noteAttachment, notesFolder, noteTitle } from './notes'
import { tidy, tidyModel, tidyTools, type TidyTool } from './tidy'

type EditableStore = JournalStore & Pick<VaultStore, 'writeNote'>

const today = () => new Date().toLocaleDateString('en-CA')
const missing = (error: unknown) => (error as { status?: number } | undefined)?.status === 404

/** How long after the last change a note is sent to the vault. */
const saveAfterMs = 3000

/**
 * The ai's tidying of a note. What it returns is shown in place of the note as an offer: `before` holds the note
 * as it was until the offer is kept or undone.
 */
function useTidy({ domain, settings, read, show, onProblem }: { domain: Domain; settings: AppSettings; read: () => string; show: (text: string) => void; onProblem: (problem?: string) => void }) {
  const [working, setWorking] = useState(false)
  const [before, setBefore] = useState<string>()
  const beforeRef = useRef<string | undefined>(undefined)
  const settle = useCallback((value?: string) => {
    beforeRef.current = value
    setBefore(value)
  }, [])
  async function run(tool: TidyTool) {
    if (working || beforeRef.current !== undefined) return
    setWorking(true)
    onProblem(undefined)
    try {
      const model = await tidyModel(domain, settings)
      if (!model) return onProblem(domain === 'work' ? 'only on the work pc' : 'ai is off or has no key')
      const was = read()
      const now = await tidy(was, tool, model)
      if (read() !== was) return onProblem('the note changed in the meantime, so nothing was changed')
      if (now.trim() === was.trim()) return onProblem('nothing to change')
      settle(was)
      show(now)
    } catch (error) {
      onProblem(error instanceof Error && error.message ? error.message : "couldn't reach the ai")
    } finally {
      setWorking(false)
    }
  }
  return { working, before, beforeRef, run, settle }
}

function TidyBar({ working, offered, onKeep, onUndo }: { working: boolean; offered: boolean; onKeep: () => void; onUndo: () => void }) {
  if (working) return <p className="notes-bar">working</p>
  if (!offered) return null
  return <p className="notes-bar"><button className="pill" type="button" aria-pressed="true" onClick={onKeep}>keep</button><button className="pill" type="button" onClick={onUndo}>undo</button></p>
}

/** One note, always editable: type or talk straight into it. It saves itself. */
function NotePage({ path, newEntry, domain, vault, settings, onBack, onChat, onSaved }: {
  path: string
  /** Start a new journal entry at the end: the time as a heading and the cursor under it. */
  newEntry?: boolean
  domain: Domain
  vault: EditableStore
  settings: AppSettings
  onBack: () => void
  onChat: (attachment: Attachment) => void
  onSaved: () => void
}) {
  const [shown, setShown] = useState<{ source: string; key: number; atEnd: boolean }>()
  const [problem, setProblem] = useState<string>()
  const [waiting, setWaiting] = useState(false)
  const [listening, setListening] = useState(false)
  const text = useRef('')
  // The vault's copy as last seen, which every change here is measured against.
  const base = useRef('')
  // A new entry with nothing written under its heading yet: leaving it that way saves nothing.
  const untouched = useRef<string | undefined>(undefined)
  const dirty = useRef(false)
  const busy = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const editor = useRef<Editor | undefined>(undefined)
  const cancel = useRef<() => void>(() => {})
  const spot = useRef<number | undefined>(undefined)
  const canListen = voiceAllowed(domain) && recognitionSupported()

  const show = useCallback((source: string) => {
    text.current = source
    setShown((current) => ({ source, key: (current?.key ?? 0) + 1, atEnd: false }))
  }, [])
  const tidying = useTidy({ domain, settings, read: () => text.current, show, onProblem: setProblem })
  const offer = tidying.beforeRef

  const push = useCallback(async () => {
    clearTimeout(timer.current)
    if (busy.current || !dirty.current || offer.current !== undefined) return
    busy.current = true
    const mine = text.current
    try {
      const theirs = await vault.readNote(path).then(({ content }) => content, (error: unknown) => { if (missing(error)) return ''; throw error })
      const content = mergeNote(base.current, mine, theirs)
      if (content !== theirs) await vault.writeNote(path, content)
      if (newEntry) saveDraft('', domain)
      if (text.current === mine) {
        base.current = content
        dirty.current = false
        keepUnsaved(path, undefined)
        setWaiting(false)
        // Someone else changed the note too: show it with their part in.
        if (content !== mine) show(content)
      } else {
        // More was written while this was on its way. What is in the vault now holds `mine` plus anyone else's part.
        base.current = mine
        keepUnsaved(path, { content: text.current, base: mine })
      }
      setProblem(undefined)
      onSaved()
    } catch {
      setProblem("couldn't save · your words are kept on this device")
    } finally {
      busy.current = false
      if (dirty.current) timer.current = setTimeout(() => { void push() }, saveAfterMs)
    }
  }, [domain, newEntry, offer, onSaved, path, show, vault])
  const pushRef = useRef(push)
  pushRef.current = push

  const changed = useCallback(() => {
    clearTimeout(timer.current)
    if (text.current === base.current || text.current.trim() === untouched.current?.trim()) {
      dirty.current = false
      keepUnsaved(path, undefined)
      setWaiting(false)
      return
    }
    dirty.current = true
    setWaiting(true)
    keepUnsaved(path, { content: text.current, base: base.current })
    timer.current = setTimeout(() => { void pushRef.current() }, saveAfterMs)
  }, [path])

  useEffect(() => {
    let live = true
    const kept = loadUnsaved()[path]
    vault.readNote(path).then(({ content }) => content, (error: unknown) => { if (missing(error)) return ''; throw error }).then((stored) => {
      if (!live) return
      base.current = stored
      let source = kept ? mergeNote(kept.base, kept.content, stored) : stored
      if (newEntry) {
        // Words left unsaved by the old journal box are not lost: they start the entry.
        const waitingWords = loadDraft(domain)
        const at = new Date()
        if (!waitingWords) untouched.current = withNewEntry(source, at)
        source = withNewEntry(source, at, waitingWords)
      }
      text.current = source
      setShown({ source, key: 0, atEnd: Boolean(newEntry) })
      changed()
    }).catch(() => { if (live) setProblem("couldn't open that note") })
    return () => { live = false }
  }, [changed, domain, newEntry, path, vault])

  const stop = useCallback(() => {
    cancel.current()
    cancel.current = () => {}
    spot.current = undefined
    setListening(false)
  }, [])

  // Spoken words go into the note where the cursor is. A brain dump has long silences in it, so listening only
  // ends when it is told to: each time the recognizer decides the speaker has finished, it starts again after the words so far.
  const listen = useCallback(() => {
    const current = editor.current
    if (!current) return
    if (spot.current === undefined && !current.isFocused) current.commands.setTextSelection(current.state.doc.content.size)
    const from = Math.min(spot.current ?? current.state.selection.to, current.state.doc.content.size)
    const $from = current.state.doc.resolve(from)
    const last = $from.parent.textBetween(0, $from.parentOffset).slice(-1)
    const lead = last && !/\s/.test(last) ? ' ' : ''
    let length = 0
    setListening(true)
    setProblem(undefined)
    cancel.current = dictate({
      text: (heard) => {
        const words = `${lead}${heard}`
        try {
          current.commands.command(({ tr }) => {
            tr.insertText(words, from, Math.min(from + length, tr.doc.content.size))
            return true
          })
          length = words.length
        } catch {
          // The note was changed under the words; the next stretch starts where the cursor is.
          length = 0
        }
      },
      end: (reason) => {
        spot.current = length ? from + length : undefined
        if (reason === 'pause' || reason === 'silence') return listen()
        cancel.current = () => {}
        spot.current = undefined
        setListening(false)
        setProblem(endMessage(reason))
      },
    })
  }, [])

  // Leaving the note or hiding the app saves now. An offer from the ai that was not kept is dropped first.
  const leave = useCallback(() => {
    if (offer.current !== undefined) {
      text.current = offer.current
      tidying.settle(undefined)
    }
    void pushRef.current()
  }, [offer, tidying.settle])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== 'hidden') return
      stop()
      void pushRef.current()
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      cancel.current()
      leave()
    }
  }, [leave, stop])

  // A reload would stop the listening and drop an offer; the words themselves are already kept on the device.
  const held = waiting || listening || tidying.working || tidying.before !== undefined
  useEffect(() => (held ? holdUpdates() : undefined), [held])

  function keep() {
    tidying.settle(undefined)
    changed()
    void push()
  }
  function undo() {
    const was = tidying.before
    tidying.settle(undefined)
    if (was === undefined) return
    show(was)
    changed()
  }

  return <section className="chat notes" aria-label={noteTitle(path)}>
    <header className="view-head">
      <button className="icon-button" type="button" aria-label="back" onClick={onBack}><Icon name="back" /></button>
      <h1>{noteTitle(path)}</h1>
      {canListen && shown && <button className={`icon-button notes-mic${listening ? ' is-listening' : ''}`} type="button" aria-pressed={listening} aria-label={listening ? 'stop' : 'talk'} onClick={() => (listening ? stop() : listen())}><Icon name="waveform" size={20} /></button>}
      {shown && <Menu items={[
        ...tidyTools.map((tool) => ({ label: tool.label, onSelect: () => { stop(); void tidying.run(tool.id) }, disabled: tidying.working || tidying.before !== undefined })),
        { label: 'add to chat', onSelect: () => onChat(noteAttachment(path, text.current)) },
      ]} />}
    </header>
    <TidyBar working={tidying.working} offered={tidying.before !== undefined} onKeep={keep} onUndo={undo} />
    {problem && <p className="journal-problem" role="alert">{problem}</p>}
    <div className="chat-history notes-page">
      {shown
        ? <NoteEditor key={shown.key} source={shown.source} startAtEnd={shown.atEnd} onEditor={(current) => { editor.current = current }} onDone={() => { void push() }} onChange={(markdown) => {
          text.current = markdown
          // The ai's version is only an offer: changing it is not a save until it is kept.
          if (offer.current === undefined) changed()
        }} />
        : !problem && <Empty>loading</Empty>}
    </div>
  </section>
}

/** A journal entry kept where it can only be read and added to (the work vault): shown as it was written. */
function EntryPage({ path, vault, onBack, onChat }: { path: string; vault: JournalStore; onBack: () => void; onChat: (attachment: Attachment) => void }) {
  const [content, setContent] = useState<string>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    let live = true
    vault.readNote(path).then((note) => { if (live) setContent(note.content) }).catch(() => { if (live) setProblem("couldn't open that entry") })
    return () => { live = false }
  }, [path, vault])
  return <section className="chat notes" aria-label={noteTitle(path)}>
    <header className="view-head">
      <button className="icon-button" type="button" aria-label="back" onClick={onBack}><Icon name="back" /></button>
      <h1>{noteTitle(path)}</h1>
      {content !== undefined && <button className="pill" type="button" onClick={() => onChat(noteAttachment(path, content))}>add to chat</button>}
    </header>
    {problem && <p className="journal-problem" role="alert">{problem}</p>}
    <div className="chat-history notes-page">
      {content === undefined
        ? !problem && <Empty>loading</Empty>
        : <article className="journal-entry">{entryParts(content).map((part, index) => part.kind === 'time' ? <h2 key={index}>{part.text}</h2> : <p key={index}>{part.text}</p>)}</article>}
    </div>
  </section>
}

/** A new entry for a journal that can only be added to: a page to type on, kept on the device until it is saved under the time. */
function DraftPage({ domain, vault, settings, onBack, onSaved }: { domain: Domain; vault: JournalStore; settings: AppSettings; onBack: () => void; onSaved: () => void }) {
  const [draft, setDraftValue] = useState(() => loadDraft(domain))
  const draftRef = useRef(draft)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState<string>()
  const setDraft = useCallback((value: string) => {
    draftRef.current = value
    setDraftValue(value)
    saveDraft(value, domain)
  }, [domain])
  const tidying = useTidy({ domain, settings, read: () => draftRef.current, show: setDraft, onProblem: setProblem })
  useEffect(() => (saving || tidying.working ? holdUpdates() : undefined), [saving, tidying.working])

  async function save() {
    const words = draftRef.current.trim()
    if (!words || saving) return
    setSaving(true)
    setProblem(undefined)
    const now = new Date()
    try {
      await vault.appendNote(journalPath(now.toLocaleDateString('en-CA')), entryBlock(words, now))
      tidying.settle(undefined)
      setDraft('')
      onSaved()
    } catch {
      setProblem("couldn't save · your words are still here")
    } finally {
      setSaving(false)
    }
  }

  return <section className="chat notes" aria-label="new entry">
    <header className="view-head">
      <button className="icon-button" type="button" aria-label="back" onClick={onBack}><Icon name="back" /></button>
      <h1>{dayLabel(today())}</h1>
      <button className="pill" type="button" aria-pressed="true" disabled={!draft.trim() || saving || tidying.working} onClick={() => { void save() }}>save</button>
      <Menu items={tidyTools.map((tool) => ({ label: tool.label, onSelect: () => { void tidying.run(tool.id) }, disabled: !draft.trim() || tidying.working || tidying.before !== undefined }))} />
    </header>
    <TidyBar working={tidying.working} offered={tidying.before !== undefined} onKeep={() => tidying.settle(undefined)} onUndo={() => { if (tidying.before !== undefined) setDraft(tidying.before); tidying.settle(undefined) }} />
    {problem && <p className="journal-problem" role="alert">{problem}</p>}
    <textarea className="notes-draft" aria-label="entry" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} />
  </section>
}

/**
 * Notes: the vault's notes folder, with the journal as a folder inside it and a folder for each year in that.
 * Where the store can only be read and added to (the work journal), the screen is the journal alone.
 * The ai is only ever called from a note's menu, and a note reaches the chat only when it is added by hand.
 */
export function NotesView({ domain, vault, settings, onSettings, onChat }: {
  domain: Domain
  /** Where the notes are kept: the notes vault, or for work the journal in the vault on the work pc. */
  vault?: JournalStore
  settings: AppSettings
  onSettings: () => void
  /** Open the chat with this note attached to the next message. */
  onChat: (attachment: Attachment) => void
}) {
  const editable = Boolean(vault?.writeNote)
  const root = editable ? notesFolder : journalFolder
  const name = domain === 'personal' ? 'notes' : 'journal'
  const [notes, setNotes] = useState<VaultNote[]>()
  const [folder, setFolder] = useState(root)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<{ path: string; newEntry?: boolean } | 'draft'>()
  const [naming, setNaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [problem, setProblem] = useState<string>()

  const load = useCallback(() => {
    if (!vault) return
    vault.listNotes().then(setNotes).catch(() => { setNotes((current) => current ?? []); setProblem(`couldn't load the ${name}`) })
  }, [name, vault])
  useEffect(() => {
    // Notes made on the pc or by the ai since this was last open are picked up.
    ;(vault as { invalidate?: () => void } | undefined)?.invalidate?.()
    load()
  }, [load, vault])

  const listing = useMemo(() => listFolder(notes ?? [], folder), [notes, folder])
  const found = useMemo(() => (query.trim() ? findNotes(notes ?? [], root, query) : undefined), [notes, query, root])

  if (!vault) return <section className="chat notes" aria-label={name}>
    <header className="view-head"><h1>{name}</h1></header>
    <Empty>no notes · <button className="link" type="button" onClick={onSettings}>set them up in settings</button></Empty>
  </section>

  const close = () => { setOpen(undefined); load() }
  if (open === 'draft') return <DraftPage domain={domain} vault={vault} settings={settings} onBack={close} onSaved={close} />
  if (open && editable) return <NotePage key={`${open.path} ${open.newEntry ? 'new' : ''}`} path={open.path} newEntry={open.newEntry} domain={domain} vault={vault as EditableStore} settings={settings} onBack={close} onChat={onChat} onSaved={load} />
  if (open) return <EntryPage key={open.path} path={open.path} vault={vault} onBack={close} onChat={onChat} />

  function addNote(event: FormEvent) {
    event.preventDefault()
    const path = newNotePath(notes ?? [], inJournal(folder) ? root : folder, newName)
    if (!path) return
    setNaming(false)
    setNewName('')
    setOpen({ path })
  }

  return <section className="chat notes" aria-label={name}>
    <header className="view-head">
      {folder !== root && <button className="icon-button" type="button" aria-label="back" onClick={() => setFolder(folder.slice(0, folder.lastIndexOf('/')))}><Icon name="back" /></button>}
      <h1>{folder === root ? name : folderName(folder)}</h1>
      {editable && !inJournal(folder) && <button className="pill" type="button" aria-pressed={naming} onClick={() => setNaming(!naming)}>new note</button>}
      <button className="pill" type="button" onClick={() => setOpen(editable ? { path: journalPath(today()), newEntry: true } : 'draft')}>{inJournal(folder) ? 'new entry' : 'new journal entry'}</button>
    </header>
    <div className="chat-history">
      {naming && <form className="add-line" onSubmit={addNote}><input autoFocus aria-label="note name" placeholder="note name" value={newName} onChange={(event) => setNewName(event.target.value)} /><button className="primary" type="submit" disabled={!newName.trim()}>add</button></form>}
      <input className="notes-search" type="search" aria-label="search" placeholder="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      {problem && <p className="journal-problem" role="alert">{problem}</p>}
      {!notes
        ? <Empty>loading</Empty>
        : found
          ? found.length
            ? <ul className="history-list" aria-label="found">{found.map((note) => <li key={note.path}><button className="history-main" type="button" onClick={() => setOpen({ path: note.path })}><span className="history-title">{note.title}</span>{note.folder && <small>{note.folder.replace(/\//g, ' · ')}</small>}</button></li>)}</ul>
            : <Empty>nothing found</Empty>
          : listing.folders.length || listing.notes.length
            ? <ul className="history-list" aria-label={folderName(folder)}>
              {listing.folders.map((item) => <li key={item.path}><button className="history-main notes-folder" type="button" onClick={() => setFolder(item.path)}><span className="history-title">{item.name}</span><small>{item.count}</small></button></li>)}
              {listing.notes.map((note) => <li key={note.path}><button className="history-main" type="button" onClick={() => setOpen({ path: note.path })}><span className="history-title">{note.title}</span></button></li>)}
            </ul>
            : <Empty>{inJournal(folder) ? 'no entries yet' : 'no notes yet'}</Empty>}
    </div>
  </section>
}
