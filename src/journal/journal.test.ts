import { expect, it } from 'vitest'
import { userContent } from '../companion/attachments'
import { WorkJournal } from './workJournal'
import { dayLabel, draftStorageKey, entryBlock, entryParts, journalAttachment, journalDay, journalDays, journalPath, loadDraft, saveDraft, withNewEntry } from './journal'
import { journalDate } from '../review/digest'

it('keeps one file per day, in a folder for its year inside the notes journal, and lists the days newest first', () => {
  expect(journalPath('2026-11-25')).toBe('notes/journal/2026/2026-11-25.md')
  expect(journalPath('2022-06-24')).toBe('notes/journal/2022/2022-06-24.md')
  const notes = [
    { path: 'notes/journal/2026/2026-11-03.md', sha: 'a' }, { path: 'notes/journal.md', sha: 'b' }, { path: 'notes/journal/2026/2026-11-25.md', sha: 'c' },
    { path: 'notes/journal/2025/2025-12-31.md', sha: 'd' }, { path: 'notes/journal/readme.md', sha: 'e' }, { path: 'reviews/journal/2026-11.md', sha: 'f' },
    // not where the journal lives: the old flat folder, and a day filed under the wrong year
    { path: 'journal/2026-11-20.md', sha: 'g' }, { path: 'notes/journal/2025/2026-01-01.md', sha: 'h' },
  ]
  expect(journalDays(notes)).toEqual(['2026-11-25', '2026-11-03', '2025-12-31'])
  // the reviews and the mind slice find entries by the same rule
  expect(journalDate).toBe(journalDay)
})

it('names every entry with the year it is from', () => {
  expect(dayLabel('2026-11-25')).toMatch(/25/)
  expect(dayLabel('2026-11-25')).toMatch(/2026/)
  expect(dayLabel('2022-06-24')).toMatch(/2022/)
})

it('starts a new entry at the end of the day under the time, with nothing else in the file changed', () => {
  const at = new Date(2026, 10, 25, 15, 4)
  expect(withNewEntry('', at)).toBe('## 3:04 pm\n')
  expect(withNewEntry('## 8:10 am\n\nslept badly\n', at)).toBe('## 8:10 am\n\nslept badly\n\n## 3:04 pm\n')
  expect(withNewEntry('## 8:10 am\n\nslept badly\n', at, ' the garden ')).toBe('## 8:10 am\n\nslept badly\n\n## 3:04 pm\n\nthe garden\n')
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
  expect(attachment.name).toMatch(/^journal .*25.*2026/)
  const content = userContent('what stands out?', [attachment])
  expect(JSON.stringify(content)).toContain('the garden')
})

it('keeps unsaved words on the device and forgets them once saved', () => {
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  expect(loadDraft('personal', store)).toBe('')
  saveDraft('half a thought', 'personal', store)
  expect(loadDraft('personal', store)).toBe('half a thought')
  saveDraft('', 'personal', store)
  expect(data.has(draftStorageKey('personal'))).toBe(false)
})

it('keeps work and personal unsaved words apart', () => {
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  saveDraft('the release is slipping', 'work', store)
  expect(loadDraft('personal', store)).toBe('')
  expect(loadDraft('work', store)).toBe('the release is slipping')
  expect(draftStorageKey('personal')).toBe('my-brain.personal.journal.draft.v1')
})

it('keeps the work journal on the work pc: the bridge and nowhere else', async () => {
  const calls: { url: string; method: string; body?: string }[] = []
  const files = new Map([['2026-11-24', '## 9:15 am\n\nstandup ran long\n']])
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
    const day = /\/journal\/(.+)$/.exec(url)?.[1]
    if (!day) return new Response(JSON.stringify({ days: [...files.keys()] }))
    if (init?.method === 'POST') {
      files.set(day, (files.get(day) ?? '') + (JSON.parse(init.body as string) as { text: string }).text)
      return new Response(JSON.stringify({ day }))
    }
    return files.has(day) ? new Response(JSON.stringify({ content: files.get(day) })) : new Response('{}', { status: 404 })
  }) as typeof fetch
  const journal = new WorkJournal('http://127.0.0.1:47321', fetcher)
  expect(journalDays(await journal.listNotes())).toEqual(['2026-11-24'])
  expect((await journal.readNote(journalPath('2026-11-24'))).content).toContain('standup ran long')
  await journal.appendNote(journalPath('2026-11-25'), entryBlock('the design review', new Date(2026, 10, 25, 9, 0)))
  expect(files.get('2026-11-25')).toBe('## 9:00 am\n\nthe design review\n')
  await expect(journal.readNote(journalPath('2026-11-01'))).rejects.toThrow()
  await expect(journal.readNote('notes/ideas.md')).rejects.toThrow()
  expect(calls.every((call) => call.url.startsWith('http://127.0.0.1:47321/journal'))).toBe(true)
})
