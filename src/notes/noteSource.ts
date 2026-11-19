import type { JSONContent } from '@tiptap/core'
import { noteMarkdown, noteSchema } from './noteExtensions'

/**
 * Block patching (docs/notes.md, editor fidelity).
 *
 * No markdown editor writes arbitrary markdown back byte for byte, so the editor never gets the chance to.
 * Loading splits the note into top-level blocks and remembers each block's source bytes beside the editor
 * nodes it became. Saving compares the editor's nodes with those: a block whose nodes are untouched is
 * written back from its original bytes, and only edited or new blocks are serialized.
 */

type Block = {
  /** the block's exact source, without the blank lines around it */
  source: string
  /** JSON of each editor node this block became, as ProseMirror writes it */
  keys: string[]
  /** node type at each end of the block, for deciding whether an edited block can reuse the original spacing */
  first: string
  last: string
}

export type LoadedNote = {
  /** the editor document for this note */
  doc: JSONContent
  /** the note's markdown for the editor's current document */
  save(doc: JSONContent): string
}

const frontmatterPattern = /^---[ \t]*\n(?:[\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/
// blocks the editor has no node for; they stay as their source
const sourceKinds: Record<string, string> = { table: 'table', html: 'html', def: 'text' }

function sourceBlock(source: string, kind: string): JSONContent {
  return { type: 'sourceBlock', attrs: { source, kind } }
}

/** Editor nodes for one block's source, or a source block when the editor cannot hold it. */
function toNodes(tokenType: string, source: string): JSONContent[] {
  const kind = sourceKinds[tokenType]
  if (kind) return [sourceBlock(source, kind)]
  try {
    const parsed = noteMarkdown.parse(source).content ?? []
    // an image alone on a line comes back as a bare inline node
    const content = parsed.map((node) => (node.type && noteSchema.nodes[node.type]?.isInline ? { type: 'paragraph', content: [node] } : node))
    if (!content.length) return [sourceBlock(source, 'text')]
    const doc = noteSchema.nodeFromJSON({ type: 'doc', content })
    doc.check()
    return (doc.toJSON() as JSONContent).content ?? []
  } catch {
    return [sourceBlock(source, 'text')]
  }
}

function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === 'paragraph' && !node.content?.length
}

/** For each index of `a`, the index in `b` it pairs with in a longest common subsequence, or -1. */
function align(a: string[], b: string[]): number[] {
  const pairs = Array.from(a, () => -1)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) {
    pairs[start] = start
    start += 1
  }
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
    pairs[endA] = endB
  }
  const rows = endA - start
  const columns = endB - start
  if (!rows || !columns) return pairs
  const width = columns + 1
  const lengths = new Uint32Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      lengths[i * width + j] = a[start + i] === b[start + j]
        ? lengths[(i + 1) * width + j + 1] + 1
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < rows && j < columns) {
    if (a[start + i] === b[start + j]) {
      pairs[start + i] = start + j
      i += 1
      j += 1
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) i += 1
    else j += 1
  }
  return pairs
}

const blankLine = /\n[ \t]*\n/

export function loadNote(source: string): LoadedNote {
  const eol = source.includes('\r\n') ? '\r\n' : '\n'
  const text = source.replace(/\r\n/g, '\n')
  const frontmatter = frontmatterPattern.exec(text)?.[0] ?? ''
  const body = text.slice(frontmatter.length)

  // gaps[i] is the whitespace before block i; the last entry is what follows the final block
  const blocks: Block[] = []
  const gaps: string[] = ['']
  const content: JSONContent[] = []
  const addBlock = (tokenType: string, blockSource: string) => {
    const nodes = toNodes(tokenType, blockSource)
    content.push(...nodes)
    blocks.push({ source: blockSource, keys: nodes.map((node) => JSON.stringify(node)), first: nodes[0].type ?? '', last: nodes[nodes.length - 1].type ?? '' })
    gaps.push('')
  }

  const tokens = noteMarkdown.instance.lexer(body)
  if (tokens.map((token) => token.raw).join('') !== body) {
    // the lexer did not account for every byte, so nothing can be patched safely: hold the body whole
    if (body.trim()) addBlock('html', body)
    else gaps[0] = body
  } else {
    for (const token of tokens) {
      const raw: string = token.raw
      const lead = token.type === 'space' ? raw : /^\n*/.exec(raw)?.[0] ?? ''
      const rest = raw.slice(lead.length)
      const trail = /\n*$/.exec(rest)?.[0] ?? ''
      gaps[gaps.length - 1] += lead
      if (rest.length > trail.length) {
        addBlock(token.type, rest.slice(0, rest.length - trail.length))
        gaps[gaps.length - 1] += trail
      }
    }
  }

  const originalKeys = blocks.flatMap((block) => block.keys)
  const firstKeyOf: number[] = []
  blocks.reduce((at, block, index) => {
    firstKeyOf[index] = at
    return at + block.keys.length
  }, 0)

  function save(doc: JSONContent): string {
    const current = (doc.content ?? []).filter((node) => !isEmptyParagraph(node))
    const currentKeys = current.map((node) => JSON.stringify(node))
    const pairs = align(originalKeys, currentKeys)

    // a block is kept when every node it became is still there, together and in order
    const keptAt = new Map<number, number>()
    blocks.forEach((block, index) => {
      const at = pairs[firstKeyOf[index]]
      if (at >= 0 && block.keys.every((_, offset) => pairs[firstKeyOf[index] + offset] === at + offset)) keptAt.set(at, index)
    })
    if (keptAt.size === blocks.length && current.length === originalKeys.length) return source

    // block is the original block written back as it was, or -1 for text the editor serialized
    type Piece = { block: number; text: string; first: string; last: string }
    const pieces: Piece[] = []
    let run: JSONContent[] = []
    const flushRun = () => {
      if (!run.length) return
      const serialized = noteMarkdown.serialize({ type: 'doc', content: run }).replace(/^\n+|\n+$/g, '')
      if (serialized) pieces.push({ block: -1, text: serialized, first: run[0].type ?? '', last: run[run.length - 1].type ?? '' })
      run = []
    }
    for (let at = 0; at < current.length; at += 1) {
      const block = keptAt.get(at)
      if (block === undefined) {
        run.push(current[at])
        continue
      }
      flushRun()
      pieces.push({ block, text: blocks[block].source, first: blocks[block].first, last: blocks[block].last })
      at += blocks[block].keys.length - 1
    }
    flushRun()
    if (!pieces.length) return frontmatter.replace(/\n/g, eol)

    const kept = new Set(keptAt.values())
    // an original gap is reused beside rewritten text only when it cannot change how the neighbours parse
    const gapOr = (gap: string, sameKind: boolean) => (sameKind || blankLine.test(gap) ? gap : '\n\n')
    let lastKept = -1
    let out = blocks.length ? gaps[0] : frontmatter && !frontmatter.endsWith('\n') ? '\n' : ''
    pieces.forEach((piece, index) => {
      const before = pieces[index - 1]
      if (before) {
        if (piece.block >= 0 && before.block >= 0) {
          out += piece.block === before.block + 1 ? gaps[piece.block] : gapOr(gaps[piece.block], false)
        } else if (piece.block >= 0) {
          // after rewritten text: reuse the gap when that text stands in for the block that used to be here
          const replaced = piece.block > 0 && !kept.has(piece.block - 1) && piece.block - 1 > lastKept
          out += replaced ? gapOr(gaps[piece.block], before.last === blocks[piece.block - 1].last) : '\n\n'
        } else {
          const next = lastKept + 1
          const replaced = next < blocks.length && !kept.has(next)
          out += replaced ? gapOr(gaps[next], piece.first === blocks[next].first) : '\n\n'
        }
      }
      out += piece.text
      if (piece.block >= 0) lastKept = piece.block
    })
    out += blocks.length ? gaps[blocks.length] : '\n'

    return (frontmatter + out).replace(/\n/g, eol)
  }

  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, save }
}
