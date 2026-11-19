import { getSchema, mergeAttributes, Node, nodeInputRule, type AnyExtension, type MarkdownToken } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import Image from '@tiptap/extension-image'

const wikilinkSource = /^(!?)\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]/

function wikilinkText(attrs: { target?: string; alias?: string | null }): string {
  return attrs.alias || attrs.target || ''
}

/** `[[Note]]`, `[[Note|shown]]`, and the `![[embed]]` form, kept as one node so the serializer never escapes or rewrites them. */
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    // renderHTML writes these as data attributes; left to render themselves they would land on the anchor as target= and alias=
    return { target: { default: '', rendered: false }, alias: { default: null, rendered: false }, embed: { default: false, rendered: false } }
  },

  parseHTML() {
    return [{ tag: 'a[data-wikilink]', getAttrs: (element) => ({ target: element.getAttribute('data-wikilink'), alias: element.getAttribute('data-alias'), embed: element.hasAttribute('data-embed') }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const { target, alias, embed } = node.attrs as { target: string; alias: string | null; embed: boolean }
    return ['a', mergeAttributes(HTMLAttributes, { 'data-wikilink': target, ...(alias ? { 'data-alias': alias } : {}), ...(embed ? { 'data-embed': '' } : {}), class: 'note-link' }), wikilinkText({ target, alias })]
  },

  renderText({ node }) {
    return wikilinkText(node.attrs)
  },

  markdownTokenName: 'wikilink',
  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start: (src: string) => {
      const at = src.indexOf('[[')
      return at > 0 && src[at - 1] === '!' ? at - 1 : at
    },
    tokenize: (src: string) => {
      const match = wikilinkSource.exec(src)
      if (!match) return undefined
      return { type: 'wikilink', raw: match[0], embed: match[1] === '!', target: match[2], alias: match[3] ?? null }
    },
  },
  parseMarkdown: (token: MarkdownToken) => ({ type: 'wikilink', attrs: { target: token.target as string, alias: (token.alias as string | null) ?? null, embed: Boolean(token.embed) } }),
  renderMarkdown: (node) => {
    const { target, alias, embed } = (node.attrs ?? {}) as { target?: string; alias?: string | null; embed?: boolean }
    return `${embed ? '!' : ''}[[${target ?? ''}${alias ? `|${alias}` : ''}]]`
  },

  addInputRules() {
    return [nodeInputRule({
      find: /\[\[([^\]\n|]+)(?:\|([^\]\n]+))?\]\]$/,
      type: this.type,
      getAttributes: (match) => ({ target: match[1], alias: match[2] ?? null }),
    })]
  },
})

type InlineToken = { type: string; text?: string; raw?: string; href?: string; tokens?: InlineToken[] }
type TableCell = { text: string; tokens?: InlineToken[] }
type TableToken = { type: 'table'; header: TableCell[]; rows: TableCell[][]; align: (string | null)[] }

function appendInline(parent: HTMLElement, tokens: InlineToken[] | undefined, fallback: string): void {
  if (!tokens) {
    parent.append(fallback)
    return
  }
  for (const token of tokens) {
    const tag = { strong: 'strong', em: 'em', del: 's', codespan: 'code', link: 'span' }[token.type]
    if (!tag) {
      parent.append(token.type === 'wikilink' ? wikilinkText(token as { target?: string; alias?: string }) : token.type === 'br' ? ' ' : token.text ?? token.raw ?? '')
      continue
    }
    const element = document.createElement(tag)
    if (token.type === 'link') element.className = 'note-link'
    if (token.type === 'codespan') element.textContent = token.text ?? ''
    else appendInline(element, token.tokens, token.text ?? '')
    parent.append(element)
  }
}

function renderTable(token: TableToken): HTMLElement {
  const table = document.createElement('table')
  const row = (cells: TableCell[], tag: 'th' | 'td') => {
    const tr = document.createElement('tr')
    cells.forEach((cell, column) => {
      const element = document.createElement(tag)
      const align = token.align[column]
      if (align) element.style.textAlign = align
      appendInline(element, cell.tokens, cell.text)
      tr.append(element)
    })
    return tr
  }
  table.createTHead().append(row(token.header, 'th'))
  const body = table.createTBody()
  for (const cells of token.rows) body.append(row(cells, 'td'))
  return table
}

/**
 * A block the editor does not model: a table, raw HTML, a link definition, or anything that failed to parse.
 * It holds the source bytes and writes them back untouched. Tables render; everything else shows its source as plain text.
 */
export const SourceBlock = Node.create({
  name: 'sourceBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return { source: { default: '', rendered: false }, kind: { default: 'text', rendered: false } }
  },

  parseHTML() {
    return [{ tag: 'pre[data-source-block]', preserveWhitespace: 'full', getAttrs: (element) => ({ source: element.textContent ?? '', kind: element.getAttribute('data-source-block') || 'text' }) }]
  },

  renderHTML({ node }) {
    return ['pre', { 'data-source-block': node.attrs.kind as string, class: 'note-source' }, node.attrs.source as string]
  },

  renderMarkdown: (node) => (node.attrs?.source as string | undefined) ?? '',

  addNodeView() {
    return ({ node }) => {
      const { source, kind } = node.attrs as { source: string; kind: string }
      const table = kind === 'table' ? noteMarkdown.instance.lexer(source).find((token) => token.type === 'table') as TableToken | undefined : undefined
      const dom = document.createElement(table ? 'div' : 'pre')
      dom.className = table ? 'note-table' : 'note-source'
      dom.contentEditable = 'false'
      if (table) dom.append(renderTable(table))
      else dom.textContent = source
      return { dom }
    }
  },
})

export const noteExtensions: AnyExtension[] = [
  StarterKit.configure({
    // markdown has no underline, and the vault must stay plain markdown
    underline: false,
    link: { openOnClick: false, autolink: true, HTMLAttributes: { class: 'note-link', rel: null, target: null } },
  }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ inline: true }),
  Wikilink,
  SourceBlock,
]

/** Parses and serializes markdown with the editor's own extensions; needs no DOM and no editor instance. */
export const noteMarkdown = new MarkdownManager({ extensions: noteExtensions })

export const noteSchema = getSchema(noteExtensions)
