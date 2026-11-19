import { describe, expect, it } from 'vitest'
import { convertLinks, crc32, exportFileName, exportVault, zip, type ExportFile } from './exportNotes'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const file = (path: string, text: string): ExportFile => ({ path, bytes: encoder.encode(text) })
const text = (files: ExportFile[], path: string) => decoder.decode(files.find((item) => item.path === path)!.bytes)

// Reads a stored zip back through its central directory, the way unzip tools do.
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const out = new Map<string, string>()
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const size = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const local = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    const localName = view.getUint16(local + 26, true)
    const data = bytes.subarray(local + 30 + localName, local + 30 + localName + size)
    expect(crc32(data)).toBe(view.getUint32(at + 16, true))
    out.set(name, decoder.decode(data))
    at += 46 + nameLength
  }
  return out
}

describe('zip', () => {
  it('matches the standard crc32', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips paths and contents, including non-ascii names', () => {
    const files = [file('notes/café.md', '# hi\n'), file('journal/2026-11-13.md', 'today ✓\n'), file('empty.md', '')]
    const read = unzip(zip(files))
    expect([...read.keys()]).toEqual(['notes/café.md', 'journal/2026-11-13.md', 'empty.md'])
    expect(read.get('journal/2026-11-13.md')).toBe('today ✓\n')
  })
})

describe('convertLinks', () => {
  const vault = [
    file('20 Projects/Garden.md', 'see [[Watering]] and [[Watering|the schedule]]\n'),
    file('20 Projects/Garden/Watering.md', 'back to [[Garden#Beds and rows]]\n'),
    file('notes/Ideas.md', '[[Garden]] · [[Missing note]] · ![[photo.png]] · [[#Top]]\n'),
    file('attachments/photo.png', 'png'),
  ]
  const out = convertLinks(vault)

  it('rewrites wikilinks to relative markdown links', () => {
    expect(text(out, '20 Projects/Garden.md')).toBe('see [Watering](Garden/Watering.md) and [the schedule](Garden/Watering.md)\n')
    expect(text(out, '20 Projects/Garden/Watering.md')).toBe('back to [Garden > Beds and rows](../Garden.md#beds-and-rows)\n')
  })

  it('handles cross-folder links, embeds, missing notes, and same-note headings', () => {
    expect(text(out, 'notes/Ideas.md')).toBe('[Garden](../20%20Projects/Garden.md) · Missing note · ![photo.png](../attachments/photo.png) · [Top](#top)\n')
  })

  it('leaves non-markdown files alone', () => {
    expect(out[3]).toBe(vault[3])
  })
})

describe('exportVault', () => {
  it('downloads every file in the tree into one zip and reports progress', async () => {
    const blobs: Record<string, string> = { a: btoa('one\n'), b: btoa('[[One]]\n') }
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/git/trees/')) return Response.json({ tree: [{ path: 'One.md', type: 'blob', sha: 'a' }, { path: 'dir', type: 'tree', sha: 'x' }, { path: 'dir/Two.md', type: 'blob', sha: 'b' }] })
      const sha = url.split('/').pop()!
      return Response.json({ content: blobs[sha], encoding: 'base64' })
    }) as typeof fetch
    const progress: string[] = []
    const blob = await exportVault({ repo: 'me/vault', token: 't', branch: 'main' }, { standardLinks: true, onProgress: (done, total) => progress.push(`${done}/${total}`) }, fetcher)
    const read = unzip(new Uint8Array(await blob.arrayBuffer()))
    expect(read.get('One.md')).toBe('one\n')
    expect(read.get('dir/Two.md')).toBe('[One](../One.md)\n')
    expect(progress.at(-1)).toBe('2/2')
  })

  it('names the file after the repo and the day', () => {
    expect(exportFileName('me/HomeBase', new Date(2026, 10, 13))).toBe('HomeBase-2026-11-13.zip')
  })
})
