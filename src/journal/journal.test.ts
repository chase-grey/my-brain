import { expect, it } from 'vitest'
import { userContent } from '../companion/attachments'
import { draftStorageKey, entryBlock, entryParts, journalAttachment, journalDays, journalPath, loadDraft, saveDraft } from './journal'

it('keeps one file per day in the journal folder and lists the days newest first', () => {
  expect(journalPath('2026-11-25')).toBe('journal/2026-11-25.md')
  const notes = [{ path: 'journal/2026-11-03.md', sha: 'a' }, { path: 'notes/journal.md', sha: 'b' }, { path: 'journal/2026-11-25.md', sha: 'c' }, { path: 'journal/readme.md', sha: 'd' }, { path: 'reviews/journal/2026-11.md', sha: 'e' }]
  expect(journalDays(notes)).toEqual(['2026-11-25', '2026-11-03'])
})

it('adds an entry under its time, words untouched', () => {
  expect(entryBlock('  so today I was thinking, about the garden\n\nand the fence ', new Date(2026, 10, 25, 15, 4))).toBe('## 3:04 pm\n\nso today I was thinking, about the garden\n\nand the fence\n')
})

it('shows a day as times and paragraphs with no markdown marks', () => {
  expect(entryParts('---\ntags: x\n---\n## 8:10 am\n\nslept badly\nstill went out\n\n## 3:04 pm\nthe garden')).toEqual([
    { kind: 'time', text: '8:10 am' },
    { kind: 'words', text: 'slept badly\nstill went out' },
    { kind: 'time', text: '3:04 pm' },
    { kind: 'words', text: 'the garden' },
  ])
  expect(entryParts('')).toEqual([])
})

it('goes to the chat as a text attachment the model reads in full', () => {
  const attachment = journalAttachment('2026-11-25', '## 3:04 pm\n\nthe garden\n')
  expect(attachment).toMatchObject({ kind: 'text', data: '## 3:04 pm\n\nthe garden\n' })
  expect(attachment.name).toMatch(/^journal .*25/)
  const content = userContent('what stands out?', [attachment])
  expect(JSON.stringify(content)).toContain('the garden')
})

it('keeps unsaved words on the device and forgets them once saved', () => {
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  expect(loadDraft(store)).toBe('')
  saveDraft('half a thought', store)
  expect(loadDraft(store)).toBe('half a thought')
  saveDraft('', store)
  expect(data.has(draftStorageKey)).toBe(false)
})
