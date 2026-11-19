import { GitHubError, type VaultConfig } from '../companion/githubVault'

// Notes leave the app as the vault itself: every file at its own path, markdown untouched, in a zip any OS opens.
// Obsidian, Logseq, and most markdown apps open the folder as is; apps that do not read [[wikilinks]] get standard links instead.

export type ExportFile = { path: string; bytes: Uint8Array }
export type ExportOptions = { standardLinks: boolean; onProgress?: (done: number, total: number) => void }

type TreeResponse = { tree: { path: string; type: string; sha: string; size?: number }[]; truncated?: boolean }
type BlobResponse = { content: string; encoding: string }

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export async function exportVault(config: VaultConfig, options: ExportOptions, fetcher: typeof fetch = (input, init) => fetch(input, init), baseUrl = 'https://api.github.com'): Promise<Blob> {
  const request = async <T>(path: string): Promise<T> => {
    const response = await fetcher(`${baseUrl}/repos/${config.repo}${path}`, {
      headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (!response.ok) throw new GitHubError(response.status, await response.text())
    return await response.json() as T
  }

  const tree = await request<TreeResponse>(`/git/trees/${encodeURIComponent(config.branch)}?recursive=1`)
  if (tree.truncated) throw new Error('vault too large for one export; clone the repo instead')
  const entries = tree.tree.filter((item) => item.type === 'blob')
  const files: ExportFile[] = Array.from({ length: entries.length })
  let done = 0
  options.onProgress?.(0, entries.length)

  // Six at a time stays well inside GitHub's secondary rate limits and still downloads a few hundred notes in seconds.
  let next = 0
  const worker = async () => {
    while (next < entries.length) {
      const index = next++
      const entry = entries[index]
      const blob = await request<BlobResponse>(`/git/blobs/${entry.sha}`)
      files[index] = { path: entry.path, bytes: blob.encoding === 'base64' ? base64Bytes(blob.content) : encoder.encode(blob.content) }
      options.onProgress?.(++done, entries.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, entries.length) }, worker))

  const output = options.standardLinks ? convertLinks(files) : files
  return new Blob([zip(output)], { type: 'application/zip' })
}

export function exportFileName(repo: string, now = new Date()): string {
  const name = repo.split('/').pop() || 'notes'
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `${name}-${day}.zip`
}

// Phones get the share sheet so the zip can go to Drive, email, or another app; desktops get a download.
export async function saveExport(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: 'application/zip' })
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  if (coarse && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: fileName })
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// ---- links ----

const wikilink = /(!?)\[\[([^\]|#^\n]*)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g

// Resolves the way Obsidian does: an exact path first, then the shortest path whose file name matches.
export function convertLinks(files: ExportFile[]): ExportFile[] {
  const byPath = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const { path } of [...files].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))) {
    const lower = path.toLowerCase()
    byPath.set(lower, path)
    if (lower.endsWith('.md')) byPath.set(lower.slice(0, -3), path)
    const name = lower.split('/').pop()!
    if (!byName.has(name)) byName.set(name, path)
    if (name.endsWith('.md') && !byName.has(name.slice(0, -3))) byName.set(name.slice(0, -3), path)
  }
  const resolve = (target: string) => {
    const lower = target.trim().toLowerCase()
    return byPath.get(lower) ?? byName.get(lower) ?? byName.get(lower.split('/').pop()!)
  }

  return files.map((file) => {
    if (!file.path.endsWith('.md')) return file
    const text = decoder.decode(file.bytes)
    const converted = text.replace(wikilink, (whole, bang: string, target: string, heading: string | undefined, alias: string | undefined) => {
      const shown = alias?.trim() || [target.trim().split('/').pop(), heading?.slice(1)].filter(Boolean).join(' > ')
      if (!target.trim()) return heading ? `[${shown}](#${slug(heading.slice(1))})` : whole
      const found = resolve(target)
      // An unresolved link points at a note that was never written; keep its title as text rather than a broken link.
      const href = found ? relativePath(file.path, found) : `${target.trim()}.md`
      if (!found && !bang) return shown
      const anchor = heading ? `#${slug(heading.slice(1))}` : ''
      return `${bang}[${shown}](${encodePath(href)}${anchor})`
    })
    return converted === text ? file : { path: file.path, bytes: encoder.encode(converted) }
  })
}

function relativePath(from: string, to: string): string {
  const fromParts = from.split('/').slice(0, -1)
  const toParts = to.split('/')
  let shared = 0
  while (shared < fromParts.length && shared < toParts.length - 1 && fromParts[shared] === toParts[shared]) shared++
  return [...Array(fromParts.length - shared).fill('..'), ...toParts.slice(shared)].join('/')
}

function encodePath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part).replace(/%2E/g, '.')).join('/')
}

function slug(heading: string): string {
  return heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
}

// ---- zip (stored, no compression; markdown is small and this keeps the writer dependency free) ----

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function zip(files: ExportFile[], now = new Date()): Uint8Array<ArrayBuffer> {
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const name = encoder.encode(file.path)
    const crc = crc32(file.bytes)
    const size = file.bytes.length

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // file names are UTF-8
    lv.setUint16(8, 0, true)
    lv.setUint16(10, time, true)
    lv.setUint16(12, date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    locals.push(local, file.bytes)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(12, time, true)
    cv.setUint16(14, date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, size, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + size
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + centralSize + end.length)
  let at = 0
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function base64Bytes(encoded: string): Uint8Array {
  return Uint8Array.from(atob(encoded.replace(/\s/g, '')), (char) => char.charCodeAt(0))
}
