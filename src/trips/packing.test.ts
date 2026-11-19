import { describe, expect, it } from 'vitest'
import { addItem, addSection, combineLists, itemKey, mergePackingText, packingItems, packingProgress, parsePacking, removeItem, removeSection, renameItem, serializePacking, setItemDone } from './packing'

const beach = `---
type: packing-default
---

## clothes
- [ ] swimsuit
- [x] sandals

## toiletries
- [ ] sunscreen
`

describe('packing lists', () => {
  it('round-trips a list byte for byte, frontmatter and blank lines included', () => {
    expect(serializePacking(parsePacking(beach))).toBe(beach)
  })

  it('keeps notes written between items and reads other bullet styles', () => {
    const list = parsePacking('intro\n\n# gear\n* [X] tent\nstakes are in the garage\n+ [ ] stove\n')
    expect(packingItems(list)).toEqual([{ section: 'gear', text: 'tent', done: true }, { section: 'gear', text: 'stove', done: false }])
    expect(serializePacking(list)).toBe('intro\n\n# gear\n- [x] tent\nstakes are in the garage\n- [ ] stove\n')
  })

  it('counts what is packed', () => {
    expect(packingProgress(parsePacking(beach))).toEqual({ done: 1, total: 3 })
  })

  it('treats a count as part of the same item', () => {
    expect(itemKey('Socks ×7')).toBe(itemKey('socks'))
    expect(itemKey('socks x3')).toBe('socks')
    expect(itemKey('socks (4)')).toBe('socks')
    expect(itemKey('box')).toBe('box')
  })

  it('adds an item at the end of its section, before the blank line that closes it', () => {
    const next = addItem(parsePacking(beach), 'hat', 'Clothes')
    expect(serializePacking(next)).toContain('- [x] sandals\n- [ ] hat\n\n## toiletries')
  })

  it('creates the section when it is missing and files unsectioned items under other', () => {
    const list = parsePacking(beach)
    expect(serializePacking(addItem(list, 'passport', 'documents'))).toMatch(/- \[ \] sunscreen\n\n## documents\n- \[ \] passport\n$/)
    expect(packingItems(addItem(list, 'book')).at(-1)).toEqual({ section: 'other', text: 'book', done: false })
  })

  it('keeps a list without headings flat', () => {
    const list = addItem(addItem({ head: [], sections: [] }, 'keys'), 'wallet')
    expect(serializePacking(list)).toBe('- [ ] keys\n- [ ] wallet\n')
  })

  it('does not add an item that is already on the list', () => {
    const list = parsePacking(beach)
    expect(addItem(list, 'Swimsuit ×2', 'toiletries')).toBe(list)
  })

  it('checks, renames, and removes by item text, and reports a miss by handing the list back', () => {
    const list = parsePacking(beach)
    expect(packingProgress(setItemDone(list, 'SWIMSUIT', true)).done).toBe(2)
    expect(packingItems(renameItem(list, 'swimsuit', 'swimsuit ×2'))[0].text).toBe('swimsuit ×2')
    expect(packingItems(removeItem(list, 'sandals')).map((item) => item.text)).toEqual(['swimsuit', 'sunscreen'])
    expect(removeItem(list, 'umbrella')).toBe(list)
    expect(setItemDone(list, 'sandals', true)).toBe(list)
  })

  it('adds and removes sections', () => {
    const list = addSection(parsePacking(beach), 'documents')
    expect(serializePacking(list)).toMatch(/\n\n## documents\n$/)
    expect(addSection(list, 'Documents')).toBe(list)
    expect(removeSection(list, 'clothes').sections.map((section) => section.title)).toEqual(['toiletries', 'documents'])
  })

  it('stacks default lists into one unchecked list with each item once', () => {
    const always = parsePacking('## clothes\n- [ ] socks\n- [ ] swimsuit\n\n## documents\n- [x] id\n')
    const combined = combineLists([always, parsePacking(beach)], ['---', 'type: packing', '---', ''])
    expect(serializePacking(combined)).toBe('---\ntype: packing\n---\n\n## clothes\n- [ ] socks\n- [ ] swimsuit\n- [ ] sandals\n\n## documents\n- [ ] id\n\n## toiletries\n- [ ] sunscreen\n')
  })
})

describe('merging two edits of one list', () => {
  const base = '## clothes\n- [ ] socks\n- [ ] hat\n- [ ] coat\n'

  it('keeps additions from both sides', () => {
    const merged = mergePackingText(base, '## clothes\n- [ ] socks\n- [ ] hat\n- [ ] coat\n- [ ] gloves\n', '## clothes\n- [ ] socks\n- [ ] hat\n- [ ] coat\n\n## gear\n- [ ] tent\n')
    expect(merged).toBe('## clothes\n- [ ] socks\n- [ ] hat\n- [ ] coat\n- [ ] gloves\n\n## gear\n- [ ] tent\n')
  })

  it('drops an item removed on either side', () => {
    const merged = mergePackingText(base, '## clothes\n- [ ] socks\n- [ ] coat\n', '## clothes\n- [ ] socks\n- [ ] hat\n')
    expect(merged).toBe('## clothes\n- [ ] socks\n')
  })

  it('lets the side that changed a check mark win', () => {
    const merged = mergePackingText(base, '## clothes\n- [x] socks\n- [ ] hat\n- [ ] coat\n', '## clothes\n- [ ] socks\n- [x] hat\n- [ ] coat\n')
    expect(merged).toBe('## clothes\n- [x] socks\n- [x] hat\n- [ ] coat\n')
  })

  it('unchecks when this side unchecked and the other left it alone', () => {
    expect(mergePackingText('- [x] socks\n', '- [ ] socks\n', '- [x] socks\n- [ ] hat\n')).toBe('- [ ] socks\n- [ ] hat\n')
  })

  it('keeps everything when there is no common starting point', () => {
    expect(mergePackingText(undefined, '- [x] socks\n- [ ] hat\n', '- [ ] socks\n- [ ] coat\n')).toBe('- [x] socks\n- [ ] coat\n- [ ] hat\n')
  })
})
