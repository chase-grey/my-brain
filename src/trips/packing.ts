// A packing list is a markdown checklist under section headings. The same shape serves the
// defaults (30 Trips/packing/<type>.md) and a trip's own copy (30 Trips/<trip>/packing.md), so
// Obsidian, the app, and the companion all edit one format.

export type PackingLine = { kind: 'item'; text: string; done: boolean } | { kind: 'text'; raw: string }
/** `heading` is the raw markdown line; empty for items that come before any heading. */
export type PackingSection = { heading: string; title: string; lines: PackingLine[] }
/** `head` is everything before the first heading or item: frontmatter and any intro text. */
export type PackingList = { head: string[]; sections: PackingSection[] }
export type PackingItem = { section: string; text: string; done: boolean }

const headingPattern = /^(#{1,6})\s+(.*?)\s*$/
const itemPattern = /^\s*[-*+]\s+\[([ xX])\]\s+(.*?)\s*$/
/** A trailing count does not make a different item: "socks ×7" and "socks" are the same thing. */
const quantityPattern = /\s*(?:[×x]\s*\d+|\(\d+\))$/i

export function itemKey(text: string): string {
  return text.trim().replace(quantityPattern, '').replace(/\s+/g, ' ').toLowerCase()
}

function sectionKey(title: string): string {
  return title.trim().toLowerCase()
}

export function parsePacking(markdown: string): PackingList {
  const lines = markdown.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  const head: string[] = []
  const sections: PackingSection[] = []
  let frontmatter = lines[0] === '---'
  for (const [index, line] of lines.entries()) {
    if (frontmatter) {
      head.push(line)
      if (index > 0 && line === '---') frontmatter = false
      continue
    }
    const heading = headingPattern.exec(line)
    if (heading) {
      sections.push({ heading: line, title: heading[2], lines: [] })
      continue
    }
    const item = itemPattern.exec(line)
    if (item) {
      if (!sections.length) sections.push({ heading: '', title: '', lines: [] })
      sections[sections.length - 1].lines.push({ kind: 'item', text: item[2], done: item[1] !== ' ' })
      continue
    }
    if (sections.length) sections[sections.length - 1].lines.push({ kind: 'text', raw: line })
    else head.push(line)
  }
  return { head, sections }
}

export function serializePacking(list: PackingList): string {
  const lines = [...list.head]
  for (const section of list.sections) {
    if (section.heading) lines.push(section.heading)
    for (const line of section.lines) lines.push(line.kind === 'item' ? `- [${line.done ? 'x' : ' '}] ${line.text}` : line.raw)
  }
  return `${lines.join('\n')}\n`
}

export function packingItems(list: PackingList): PackingItem[] {
  return list.sections.flatMap((section) => section.lines.flatMap((line) => line.kind === 'item' ? [{ section: section.title, text: line.text, done: line.done }] : []))
}

export function packingProgress(list: PackingList): { done: number; total: number } {
  const items = packingItems(list)
  return { done: items.filter((item) => item.done).length, total: items.length }
}

export function hasItem(list: PackingList, text: string): boolean {
  const key = itemKey(text)
  return packingItems(list).some((item) => itemKey(item.text) === key)
}

/** Apply `change` to the matching item. Hands back the same list when nothing matched or nothing changed. */
function mapItem(list: PackingList, text: string, change: (item: PackingLine & { kind: 'item' }) => PackingLine | undefined): PackingList {
  const key = itemKey(text)
  let changed = false
  const sections = list.sections.map((section) => {
    const lines: PackingLine[] = []
    for (const line of section.lines) {
      if (line.kind !== 'item' || itemKey(line.text) !== key) { lines.push(line); continue }
      const next = change(line)
      if (next !== line) changed = true
      if (next) lines.push(next)
    }
    return { ...section, lines }
  })
  return changed ? { ...list, sections } : list
}

function insertItem(section: PackingSection, line: PackingLine): PackingSection {
  // After the last item, so blank lines that close the section stay at its end.
  let at = section.lines.length
  while (at > 0 && section.lines[at - 1].kind === 'text') at -= 1
  return { ...section, lines: [...section.lines.slice(0, at), line, ...section.lines.slice(at)] }
}

function endsBlank(lines: PackingLine[]): boolean {
  const last = lines[lines.length - 1]
  return Boolean(last && last.kind === 'text' && last.raw.trim() === '')
}

/** The section an item lands in when none is named: "other" once the list has headings, the bare list before that. */
function defaultSection(list: PackingList): string {
  return list.sections.some((section) => section.heading) ? 'other' : ''
}

/** Add an item, creating its section when missing. An item already on the list (in any section) is left alone. */
export function addItem(list: PackingList, text: string, section?: string, done = false): PackingList {
  const clean = text.trim()
  if (!clean || hasItem(list, clean)) return list
  const title = section?.trim() || defaultSection(list)
  const line: PackingLine = { kind: 'item', text: clean, done }
  const at = list.sections.findIndex((existing) => sectionKey(existing.title) === sectionKey(title))
  if (at >= 0) return { ...list, sections: list.sections.map((existing, index) => index === at ? insertItem(existing, line) : existing) }
  const sections = [...list.sections]
  const previous = sections[sections.length - 1]
  if (previous && !endsBlank(previous.lines)) sections[sections.length - 1] = { ...previous, lines: [...previous.lines, { kind: 'text', raw: '' }] }
  else if (!previous && list.head.length && list.head[list.head.length - 1].trim() !== '') return addItem({ ...list, head: [...list.head, ''] }, text, section, done)
  sections.push({ heading: title ? `## ${title}` : '', title, lines: [line] })
  return { ...list, sections }
}

export function removeItem(list: PackingList, text: string): PackingList {
  return mapItem(list, text, () => undefined)
}

export function setItemDone(list: PackingList, text: string, done: boolean): PackingList {
  return mapItem(list, text, (item) => item.done === done ? item : { ...item, done })
}

export function renameItem(list: PackingList, text: string, to: string): PackingList {
  const clean = to.trim()
  if (!clean) return list
  if (itemKey(clean) !== itemKey(text) && hasItem(list, clean)) return removeItem(list, text)
  return mapItem(list, text, (item) => item.text === clean ? item : { ...item, text: clean })
}

/** Add an empty section. Hands back the same list when it is already there. */
export function addSection(list: PackingList, title: string): PackingList {
  const clean = title.trim()
  if (!clean || list.sections.some((section) => sectionKey(section.title) === sectionKey(clean))) return list
  const sections = [...list.sections]
  const previous = sections[sections.length - 1]
  if (previous && !endsBlank(previous.lines)) sections[sections.length - 1] = { ...previous, lines: [...previous.lines, { kind: 'text', raw: '' }] }
  const head = !previous && list.head.length && list.head[list.head.length - 1].trim() !== '' ? [...list.head, ''] : list.head
  sections.push({ heading: `## ${clean}`, title: clean, lines: [] })
  return { head, sections }
}

/** Drop a section and everything in it. */
export function removeSection(list: PackingList, title: string): PackingList {
  const sections = list.sections.filter((section) => sectionKey(section.title) !== sectionKey(title))
  return sections.length === list.sections.length ? list : { ...list, sections }
}

/** Stack several default lists into one fresh, unchecked list: sections in first-seen order, each item once. */
export function combineLists(lists: PackingList[], head: string[] = []): PackingList {
  let combined: PackingList = { head, sections: [] }
  for (const list of lists) for (const item of packingItems(list)) combined = addItem(combined, item.text, item.section)
  return combined
}

/**
 * Three-way merge that never asks: an item added on either side stays, an item removed on either
 * side goes, and a check mark changed on one side wins over the side that left it alone.
 * The result keeps the remote's layout, with local additions placed in their sections.
 */
export function mergePacking(base: PackingList, local: PackingList, remote: PackingList): PackingList {
  const index = (list: PackingList) => new Map(packingItems(list).map((item) => [itemKey(item.text), item]))
  const inBase = index(base)
  const inLocal = index(local)
  const inRemote = index(remote)
  const sections = remote.sections.map((section) => ({
    ...section,
    lines: section.lines.flatMap((line): PackingLine[] => {
      if (line.kind !== 'item') return [line]
      const key = itemKey(line.text)
      const before = inBase.get(key)
      const mine = inLocal.get(key)
      if (!mine) return before ? [] : [line]
      if (!before) return [{ ...line, done: line.done || mine.done }]
      return [{ ...line, done: mine.done !== before.done ? mine.done : line.done }]
    }),
  }))
  let merged: PackingList = { head: remote.head, sections }
  for (const item of packingItems(local)) {
    const key = itemKey(item.text)
    if (!inRemote.has(key) && !inBase.has(key)) merged = addItem(merged, item.text, item.section, item.done)
  }
  return merged
}

export function mergePackingText(base: string | undefined, local: string, remote: string): string {
  return serializePacking(mergePacking(parsePacking(base ?? ''), parsePacking(local), parsePacking(remote)))
}
