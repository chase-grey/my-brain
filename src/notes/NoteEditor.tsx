import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import { noteExtensions } from './noteExtensions'
import { loadNote } from './noteSource'

export type NoteEditorProps = {
  /** The note's markdown. Read once: give the editor a new `key` to load another note or merged content. */
  source: string
  /** Put the cursor at the end and open the keyboard, as the journal does. */
  startAtEnd?: boolean
  /** The note's markdown after each edit. Blocks that were not edited keep their original bytes. */
  onChange: (markdown: string) => void
  onDone?: () => void
  /** A wikilink or a relative link to a `.md` file was tapped; `target` is what the link names, without `.md`. */
  onOpenNote?: (target: string) => void
}

/** The note a relative markdown link points at, or undefined for a link that leaves the vault. */
export function noteTarget(href: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href)) return undefined
  const path = href.split('#')[0]
  if (!/\.md$/i.test(path)) return undefined
  try {
    return decodeURIComponent(path).replace(/\.md$/i, '')
  } catch {
    return path.replace(/\.md$/i, '')
  }
}

export function withScheme(url: string): string {
  const trimmed = url.trim()
  return /^[a-z][a-z0-9+.-]*:|^[#/.]/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function ToolButton({ label, active, disabled, onPress, children }: { label: string; active?: boolean; disabled?: boolean; onPress: () => void; children: ReactNode }) {
  // pointerdown is cancelled so the tap never takes focus from the note and the keyboard stays open
  return <button type="button" className={active ? 'active' : ''} aria-label={label} aria-pressed={active} disabled={disabled} onPointerDown={(event) => event.preventDefault()} onClick={onPress}>{children}</button>
}

function Toolbar({ editor, onDone }: { editor: Editor; onDone?: () => void }) {
  const [linking, setLinking] = useState(false)
  const [url, setUrl] = useState('')
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      focused: current.isFocused,
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      strike: current.isActive('strike'),
      code: current.isActive('code'),
      link: current.isActive('link'),
      heading: [1, 2, 3].find((level) => current.isActive('heading', { level })) ?? 0,
      bullets: current.isActive('bulletList'),
      numbers: current.isActive('orderedList'),
      checklist: current.isActive('taskList'),
      quote: current.isActive('blockquote'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  })
  if (!state.focused && !linking) return null

  const run = () => editor.chain().focus()

  if (linking) {
    const addLink = (event: FormEvent) => {
      event.preventDefault()
      const href = withScheme(url)
      if (url.trim()) {
        if (editor.state.selection.empty) run().insertContent({ type: 'text', text: url.trim(), marks: [{ type: 'link', attrs: { href } }] }).run()
        else run().setLink({ href }).run()
      } else editor.commands.focus()
      setLinking(false)
      setUrl('')
    }
    return <form className="note-toolbar note-toolbar-link" onSubmit={addLink}>
      <input autoFocus aria-label="link address" inputMode="url" autoCapitalize="none" autoCorrect="off" placeholder="link address" value={url} onChange={(event) => setUrl(event.target.value)} />
      <button type="submit" className="note-done">add</button>
      <button type="button" onClick={() => { setLinking(false); setUrl(''); editor.commands.focus() }}>cancel</button>
    </form>
  }

  return <div className="note-toolbar" role="toolbar" aria-label="formatting">
    <ToolButton label="bold" active={state.bold} onPress={() => run().toggleBold().run()}><b>b</b></ToolButton>
    <ToolButton label="italic" active={state.italic} onPress={() => run().toggleItalic().run()}><i>i</i></ToolButton>
    <ToolButton label="strikethrough" active={state.strike} onPress={() => run().toggleStrike().run()}><s>s</s></ToolButton>
    <ToolButton label="heading" active={state.heading > 0} onPress={() => (state.heading === 3 ? run().setParagraph().run() : run().setHeading({ level: (state.heading + 1) as 1 | 2 | 3 }).run())}>h{state.heading || ''}</ToolButton>
    <ToolButton label="bullets" active={state.bullets} onPress={() => run().toggleBulletList().run()}>•</ToolButton>
    <ToolButton label="numbers" active={state.numbers} onPress={() => run().toggleOrderedList().run()}>1.</ToolButton>
    <ToolButton label="checklist" active={state.checklist} onPress={() => run().toggleTaskList().run()}>☑</ToolButton>
    <ToolButton label="quote" active={state.quote} onPress={() => run().toggleBlockquote().run()}>”</ToolButton>
    <ToolButton label="link" active={state.link} onPress={() => (state.link ? run().extendMarkRange('link').unsetLink().run() : setLinking(true))}>link</ToolButton>
    <ToolButton label="code" active={state.code} onPress={() => run().toggleCode().run()}>{'<>'}</ToolButton>
    <ToolButton label="undo" disabled={!state.canUndo} onPress={() => run().undo().run()}>↶</ToolButton>
    <ToolButton label="redo" disabled={!state.canRedo} onPress={() => run().redo().run()}>↷</ToolButton>
    <button type="button" className="note-done" onClick={() => { editor.commands.blur(); onDone?.() }}>done</button>
  </div>
}

export function NoteEditor({ source, startAtEnd, onChange, onDone, onOpenNote }: NoteEditorProps) {
  const [note] = useState(() => loadNote(source))
  // the editor is created once, so its handlers read the latest callbacks through a ref
  const callbacks = useRef({ onChange, onOpenNote })
  callbacks.current = { onChange, onOpenNote }

  const editor = useEditor({
    extensions: noteExtensions,
    content: note.doc,
    autofocus: startAtEnd ? 'end' : false,
    editorProps: {
      attributes: { class: 'note-body', 'aria-label': 'note' },
      handleClick: (_view, _pos, event) => {
        const link = (event.target as HTMLElement | null)?.closest?.('a')
        if (!link) return false
        const href = link.getAttribute('href') ?? ''
        const target = link.getAttribute('data-wikilink') ?? noteTarget(href)
        if (target) callbacks.current.onOpenNote?.(target)
        else if (href) window.open(href, '_blank', 'noopener')
        return true
      },
    },
    onUpdate: ({ editor: current }) => callbacks.current.onChange(note.save(current.getJSON())),
  })

  if (!editor) return null
  return <div className="note-editor">
    <EditorContent editor={editor} />
    <Toolbar editor={editor} onDone={onDone} />
  </div>
}
