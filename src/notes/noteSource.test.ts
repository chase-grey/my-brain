import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { noteExtensions } from './noteExtensions'
import { loadNote } from './noteSource'

// Written the way Obsidian, the companion, and a Notion export write: nothing here matches the editor's own style.
const daily = `---
tags: [daily]
created: 2026-11-04
---
# 2026-11-04
## Top priorities
* [ ] call the plumber
* [x] renew passport
    * [ ] photos first

Some *italic*, __bold__, a_snake_case word, ==highlight==, #tag, and [[20 Projects/House|the house]].
Second line of the same paragraph with <br> in it.


Three blank lines above. See [docs](https://example.com "title") and ![[diagram.png]].

| when | what |
|:-----|-----:|
| 9am  | **standup** |

1) first
2) second

> quoted
> twice

\`\`\`js
const x  =  1
\`\`\`

***

<details><summary>raw</summary>html</details>

Setext heading
--------------

[ref]: https://example.com
`

const fixtures: Record<string, string> = {
  daily,
  'windows line endings': daily.replace(/\n/g, '\r\n'),
  'no trailing newline': '# title\n\njust a line',
  'frontmatter only': '---\ntitle: empty\n---\n',
  empty: '',
  'only blank lines': '\n\n',
  'tabs and loose lists': '- one\n\n- two\n\n\t- nested with a tab\n\n+ plus list\n',
  'html and math': '<div align="center">\n\nstill html\n\n</div>\n\n$$\nx^2\n$$\n',
  'heading right above text': '## heading\ntext directly under\n- list directly under\n',
}

function edit(source: string, change: (editor: Editor) => void): string {
  const note = loadNote(source)
  const editor = new Editor({ element: null, extensions: noteExtensions, content: note.doc })
  change(editor)
  const saved = note.save(editor.getJSON())
  editor.destroy()
  return saved
}

/** Position of the first occurrence of `text` in the editor document. */
function find(editor: Editor, text: string): number {
  let found = -1
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) found = pos + node.text.indexOf(text)
    return found < 0
  })
  if (found < 0) throw new Error(`"${text}" is not in the document`)
  return found
}

// plain strings would be parsed as html, which needs a dom
const text = (value: string) => ({ type: 'text', text: value })

function changedLines(before: string, after: string): string[] {
  const kept = new Set(before.split('\n'))
  return after.split('\n').filter((line) => !kept.has(line))
}

describe('a note saved with no edit', () => {
  for (const [name, source] of Object.entries(fixtures)) {
    it(`comes back identical: ${name}`, () => {
      expect(edit(source, () => {})).toBe(source)
    })
  }

  it('comes back identical when the editor only adds its empty trailing paragraph', () => {
    const note = loadNote('# title\n\n---\n')
    expect(note.save({ type: 'doc', content: [...note.doc.content!, { type: 'paragraph' }] })).toBe('# title\n\n---\n')
  })
})

describe('an edit changes only its own block', () => {
  it('bolds one word', () => {
    const saved = edit(daily, (editor) => {
      const at = find(editor, 'Three')
      editor.chain().setTextSelection({ from: at, to: at + 5 }).toggleBold().run()
    })
    expect(changedLines(daily, saved)).toEqual(['**Three** blank lines above. See [docs](https://example.com "title") and ![[diagram.png]].'])
    expect(saved.length).toBe(daily.length + 4)
  })

  it('adds a paragraph at the end', () => {
    const saved = edit(daily, (editor) => {
      editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [{ type: 'text', text: 'one more thought' }] })
    })
    expect(saved).toBe(`${daily.trimEnd()}\n\none more thought\n`)
  })

  it('adds a paragraph in the middle without disturbing the spacing around it', () => {
    const source = '## heading\ntext directly under\n\n\n\nlast\n'
    const saved = edit(source, (editor) => {
      const at = find(editor, 'text directly under')
      editor.commands.insertContentAt(at + 'text directly under'.length + 1, { type: 'paragraph', content: [{ type: 'text', text: 'new' }] })
    })
    expect(saved).toBe('## heading\ntext directly under\n\nnew\n\nlast\n')
  })

  it('checks a box, rewriting that list and nothing else', () => {
    const saved = edit(daily, (editor) => {
      editor.chain().setTextSelection(find(editor, 'call the plumber')).updateAttributes('taskItem', { checked: true }).run()
    })
    const lines = changedLines(daily, saved)
    expect(lines).toContain('- [x] call the plumber')
    expect(lines.every((line) => /^\s*- \[[ x]\] /.test(line))).toBe(true)
    expect(saved.slice(0, saved.indexOf('## Top priorities'))).toBe(daily.slice(0, daily.indexOf('## Top priorities')))
    expect(saved.slice(saved.indexOf('\nSome *italic*'))).toBe(daily.slice(daily.indexOf('\nSome *italic*')))
  })

  it('renames a heading and keeps it tight against the next line', () => {
    const saved = edit(daily, (editor) => {
      const at = find(editor, 'Top priorities')
      editor.commands.insertContentAt({ from: at, to: at + 3 }, text('Three'))
    })
    expect(saved).toBe(daily.replace('## Top priorities', '## Three priorities'))
  })

  it('deletes a block', () => {
    const saved = edit(daily, (editor) => {
      const at = find(editor, 'quoted')
      const quote = editor.state.doc.resolve(at)
      editor.commands.deleteRange({ from: quote.before(1), to: quote.after(1) })
    })
    expect(saved).toBe(daily.replace('> quoted\n> twice\n\n', ''))
  })

  it('keeps windows line endings on an edited note', () => {
    const saved = edit(fixtures['windows line endings'], (editor) => {
      const at = find(editor, 'Three')
      editor.chain().setTextSelection({ from: at, to: at + 5 }).toggleBold().run()
    })
    expect(saved).toContain('\r\n**Three** blank lines above.')
    expect(saved.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('writes into an empty note and a note that is only frontmatter', () => {
    const type = (editor: Editor) => { editor.commands.insertContent(text('hello')) }
    expect(edit('', type)).toBe('hello\n')
    expect(edit('---\ntitle: empty\n---\n', type)).toBe('---\ntitle: empty\n---\nhello\n')
  })

  it('leaves only the frontmatter when everything is deleted', () => {
    expect(edit('---\na: 1\n---\n# gone\n', (editor) => { editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] }) })).toBe('---\na: 1\n---\n')
  })
})

describe('what the editor holds', () => {
  it('never shows frontmatter', () => {
    expect(JSON.stringify(loadNote(daily).doc)).not.toContain('created: 2026-11-04')
  })

  it('keeps wikilinks as links and writes them back unescaped when their paragraph is edited', () => {
    const source = 'see [[Other Note|that one]] and ![[img.png]] today\n'
    const note = loadNote(source)
    expect(note.doc.content![0].content!.filter((node) => node.type === 'wikilink').map((node) => node.attrs)).toEqual([
      { target: 'Other Note', alias: 'that one', embed: false },
      { target: 'img.png', alias: null, embed: true },
    ])
    expect(edit(source, (editor) => { editor.commands.insertContentAt(find(editor, 'today'), text('again ')) })).toBe('see [[Other Note|that one]] and ![[img.png]] again today\n')
  })

  it('holds tables, html, and link definitions as source', () => {
    const kinds = loadNote(daily).doc.content!.filter((node) => node.type === 'sourceBlock').map((node) => node.attrs!.kind)
    expect(kinds).toEqual(['table', 'html', 'text'])
  })
})

// The real gate is every note in the vault. Notes are private and this repo is not, so they are read from disk when
// VITE_NOTES_CORPUS points at a checkout of the vault and never copied into the fixtures.
const corpus = import.meta.env.VITE_NOTES_CORPUS as string | undefined

describe.skipIf(!corpus)('every note in the vault', async () => {
  // the app's tsconfig has no node types, so the module is named indirectly and typed here
  const nodeFs = 'node:fs'
  const fs = corpus ? await import(/* @vite-ignore */ nodeFs) as { readdirSync(path: string, options: { recursive: true }): string[]; readFileSync(path: string, encoding: 'utf8'): string } : undefined
  const notes = fs ? fs.readdirSync(corpus!, { recursive: true }).filter((path) => path.endsWith('.md') && !/(^|[\\/])\./.test(path)) : []
  const read = (path: string) => fs!.readFileSync(`${corpus}/${path}`, 'utf8')

  it('comes back identical with no edit', () => {
    expect(notes.length).toBeGreaterThan(0)
    expect(notes.filter((path) => edit(read(path), () => {}) !== read(path))).toEqual([])
  })

  it('changes nothing but the end when a paragraph is added', () => {
    const changed = notes.filter((path) => {
      const source = read(path)
      const saved = edit(source, (editor) => {
        editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph', content: [text('corpus probe')] })
      })
      const body = source.replace(/\s+$/, '')
      return !(saved.startsWith(body) && saved.slice(body.length).trim() === 'corpus probe')
    })
    expect(changed).toEqual([])
  })
})
