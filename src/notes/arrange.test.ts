import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GitHubVault, type VaultNote } from '../companion/githubVault'
import { arrange, arrangePath, arrangementText, datesAtOnce, dragged, followDelete, followMove, keepArrangement, keepEmptied, loadArrangement, noArrangement, parseArrangement, readEdited, syncArrangement, tidied, toggleFavorite, withGroup, withOrder, withoutGroup, type Arrangement } from './arrange'
import { NotesList } from './NotesList'

// AGENTS.md, "arranging notes".

const note = (path: string, sha = path): VaultNote => ({ path, sha })
const notes = [
  note('notes/journal/2026/2026-11-25.md'),
  note('notes/journal/2025/2025-12-30.md'),
  note('notes/gifts.md'),
  note('notes/books.md'),
  note('notes/cabin.md'),
  note('notes/recipes/chili.md'),
  note('notes/recipes/bread.md'),
  note('notes/house/paint.md'),
]
const edited = {
  'notes/gifts.md': '2026-11-20T10:00:00Z',
  'notes/books.md': '2026-11-23T10:00:00Z',
  'notes/recipes/chili.md': '2026-11-10T10:00:00Z',
  'notes/recipes/bread.md': '2026-11-22T10:00:00Z',
  'notes/house/paint.md': '2026-08-10T10:00:00Z',
}
const names = (list: { path: string }[]) => list.map((item) => item.path.slice('notes/'.length))

function memory(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const kept = new Map<string, string>()
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => { kept.set(key, value) }, removeItem: (key) => { kept.delete(key) } }
}

describe('the order of the list', () => {
  it('reads notes last edited first, and a note with no date known by name under the rest', () => {
    expect(names(arrange(notes, 'notes', noArrangement, edited).notes)).toEqual(['books.md', 'gifts.md', 'cabin.md'])
  })

  it('puts what was written here and is not in the vault yet on top', () => {
    expect(names(arrange([...notes, { path: 'notes/new.md', sha: '' }], 'notes', noArrangement, edited, ['notes/gifts.md']).notes).slice(0, 2).sort()).toEqual(['gifts.md', 'new.md'])
  })

  it('takes a date the vault gave with its list over one asked for', () => {
    const dated = notes.map((item) => item.path === 'notes/cabin.md' ? { ...item, edited: '2026-11-24T10:00:00Z' } : item)
    expect(names(arrange(dated, 'notes', noArrangement, edited).notes)[0]).toBe('cabin.md')
  })

  it('reads groups last edited first until one is dragged, the journal by its newest day', () => {
    expect(names(arrange(notes, 'notes', noArrangement, edited).groups)).toEqual(['journal', 'recipes', 'house'])
  })

  it('keeps groups in the order they were dragged to, with a group newer than that order above them', () => {
    const placed = withOrder(noArrangement, 'notes', ['house', 'journal'])
    expect(names(arrange(notes, 'notes', placed, edited).groups)).toEqual(['recipes', 'house', 'journal'])
  })

  it('leaves the journal as it was: years and days newest first', () => {
    expect(names(arrange(notes, 'notes/journal', withOrder(noArrangement, 'notes/journal', ['2025', '2026']), edited).groups)).toEqual(['journal/2026', 'journal/2025'])
  })
})

describe('favorites', () => {
  it('are shown in the order they were put, not by last edited, and only while the note is there', () => {
    const starred = ['notes/cabin.md', 'notes/gone.md', 'notes/books.md'].reduce(toggleFavorite, noArrangement)
    expect(names(arrange(notes, 'notes', starred, edited).favorites)).toEqual(['cabin.md', 'books.md'])
  })

  it('a starred note stays in the list it is in', () => {
    expect(names(arrange(notes, 'notes', toggleFavorite(noArrangement, 'notes/books.md'), edited).notes)).toContain('books.md')
  })

  it('a second star takes it off', () => {
    expect(toggleFavorite(toggleFavorite(noArrangement, 'notes/books.md'), 'notes/books.md').favorites).toEqual([])
  })

  it('a card dragged to a new place lands there', () => {
    expect(dragged(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b'])
    expect(dragged(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a'])
    expect(dragged(['a', 'b'], 'x', 0)).toEqual(['a', 'b'])
  })

  it('a renamed or moved note keeps its star and its place, and a deleted one leaves', () => {
    const starred = ['notes/cabin.md', 'notes/books.md'].reduce(toggleFavorite, noArrangement)
    expect(followMove(starred, 'notes/cabin.md', 'notes/house/cabin.md').favorites).toEqual(['notes/house/cabin.md', 'notes/books.md'])
    expect(followDelete(starred, 'notes/cabin.md').favorites).toEqual(['notes/books.md'])
  })
})

describe('groups', () => {
  it('a new group shows empty, on top, until a note is put in it', () => {
    const made = withGroup(noArrangement, notes, 'notes/music')
    expect(arrange(notes, 'notes', made, edited).groups[0]).toEqual({ path: 'notes/music', name: 'music', count: 0 })
  })

  it('a group is not made twice, nor over a folder that is already there', () => {
    expect(withGroup(noArrangement, notes, 'notes/Recipes')).toBe(noArrangement)
    const made = withGroup(noArrangement, notes, 'notes/music')
    expect(withGroup(made, notes, 'notes/music')).toBe(made)
  })

  it('a group stays when its last note leaves, and goes only when it is deleted', () => {
    const after = notes.filter((item) => item.path !== 'notes/house/paint.md')
    const kept = keepEmptied(noArrangement, after, 'notes/house/paint.md')
    expect(kept.groups).toEqual(['notes/house'])
    expect(names(arrange(after, 'notes', kept, edited).groups)).toContain('house')
    expect(withoutGroup(kept, 'notes/house').groups).toEqual([])
  })

  it('a note leaving notes itself, the journal, or a group with more in it keeps nothing', () => {
    expect(keepEmptied(noArrangement, [], 'notes/books.md')).toBe(noArrangement)
    expect(keepEmptied(noArrangement, [], 'notes/journal/2026/2026-11-25.md')).toBe(noArrangement)
    expect(keepEmptied(noArrangement, notes, 'notes/recipes/chili.md')).toBe(noArrangement)
  })
})

describe('what is kept', () => {
  it('drops what points at nothing: stars on notes that are gone, groups that now hold a note, the order of folders that are gone', () => {
    const arrangement: Arrangement = { favorites: ['notes/books.md', 'notes/gone.md'], groups: ['notes/recipes', 'notes/music'], order: { notes: ['music', 'old', 'house'], 'notes/gone': ['x'] } }
    expect(tidied(arrangement, notes)).toEqual({ favorites: ['notes/books.md'], groups: ['notes/music'], order: { notes: ['music', 'house'] } })
  })

  it('reads anything that is not an arrangement as none', () => {
    expect(parseArrangement('not json')).toEqual(noArrangement)
    expect(parseArrangement('{"favorites":"x","groups":[1,"notes/a","notes/a"],"order":{"notes":["b"],"bad":3}}')).toEqual({ favorites: [], groups: ['notes/a'], order: { notes: ['b'] } })
  })

  it('sits beside the notes where the notes list does not show it', () => {
    expect(arrangePath.startsWith('notes/.')).toBe(true)
    expect(arrangePath.endsWith('.md')).toBe(false)
  })

  it('sends one changed here and not yet sent, and it stands over the vault', async () => {
    const store = memory()
    const mine = toggleFavorite(noArrangement, 'notes/books.md')
    keepArrangement(mine, true, store)
    const written: string[] = []
    const now = await syncArrangement({ readNote: async () => ({ content: arrangementText(noArrangement), sha: '' }), writeNote: async (_path, content) => { written.push(content); return { sha: '' } } }, store)
    expect(now).toEqual(mine)
    expect(written).toEqual([arrangementText(mine)])
    expect(loadArrangement(store).unsent).toBe(false)
  })

  it('takes the vault when nothing here is waiting', async () => {
    const store = memory()
    const theirs = toggleFavorite(noArrangement, 'notes/cabin.md')
    expect(await syncArrangement({ readNote: async () => ({ content: arrangementText(theirs), sha: '' }) }, store)).toEqual(theirs)
    expect(loadArrangement(store).value).toEqual(theirs)
  })

  it('keeps the one on the device when the vault cannot be reached or has none, still waiting to go', async () => {
    const store = memory()
    const mine = toggleFavorite(noArrangement, 'notes/books.md')
    keepArrangement(mine, true, store)
    expect(await syncArrangement({ readNote: async () => { throw new Error('offline') }, writeNote: async () => { throw new Error('offline') } }, store)).toEqual(mine)
    expect(loadArrangement(store).unsent).toBe(true)
    keepArrangement(mine, false, store)
    expect(await syncArrangement({ readNote: async () => { throw Object.assign(new Error('none'), { status: 404 }) } }, store)).toEqual(mine)
  })
})

describe('when a note was last edited', () => {
  it('is asked once a note, never for a journal entry, and kept only for notes still there', async () => {
    const store = memory()
    const asked: string[][] = []
    const vault = { editedDates: async (paths: string[]) => { asked.push(paths); return Object.fromEntries(paths.map((path) => [path, '2026-11-01T00:00:00Z'])) } }
    const first = await readEdited(vault, notes, store)
    expect(asked.flat().sort()).toEqual(notes.filter((item) => !item.path.includes('/journal/')).map((item) => item.path).sort())
    expect(first['notes/books.md']).toBe('2026-11-01T00:00:00Z')
    asked.length = 0
    const changed = [...notes.filter((item) => item.path !== 'notes/books.md'), note('notes/books.md', 'new sha')]
    const second = await readEdited(vault, changed, store)
    expect(asked).toEqual([['notes/books.md']])
    expect(Object.keys(second)).not.toContain('notes/books.md')
    expect(second['new sha']).toBe('2026-11-01T00:00:00Z')
  })

  it('asks about a few at a time, and keeps what it learned when the vault stops answering', async () => {
    const many = Array.from({ length: datesAtOnce + 5 }, (_, index) => note(`notes/n${index}.md`))
    let calls = 0
    const vault = { editedDates: async (paths: string[]) => { calls += 1; if (calls > 1) throw new Error('offline'); return Object.fromEntries(paths.map((path) => [path, '2026-11-01T00:00:00Z'])) } }
    expect(Object.keys(await readEdited(vault, many, memory()))).toHaveLength(datesAtOnce)
  })

  it('a vault that cannot say leaves the dates unknown', async () => {
    expect(await readEdited({}, notes, memory())).toEqual({})
  })

  it('github is asked for every date in one request, and a file beside the notes is written over with its sha', async () => {
    const calls: { url: string; body?: string; method?: string }[] = []
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body as string | undefined, method: init?.method })
      if (url.endsWith('/graphql')) return new Response(JSON.stringify({ data: { repository: { object: { n0: { nodes: [{ committedDate: '2026-11-23T10:00:00Z' }] }, n1: { nodes: [] } } } } }))
      if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: [{ path: 'notes/books.md', type: 'blob', sha: 'a' }, { path: arrangePath, type: 'blob', sha: 'b' }] }))
      return new Response(JSON.stringify({ content: { sha: 'c' } }))
    }) as typeof fetch
    const vault = new GitHubVault({ repo: 'someone/vault', token: 't', branch: 'main' }, fetcher)
    expect(await vault.editedDates(['notes/books.md', 'notes/a "quoted" name.md'])).toEqual({ 'notes/books.md': '2026-11-23T10:00:00Z' })
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].body!).query).toContain('history(first: 1, path: "notes/a \\"quoted\\" name.md")')
    expect((await vault.listNotes()).map((item) => item.path)).toEqual(['notes/books.md'])
    await vault.writeNote(arrangePath, '{}')
    expect(JSON.parse(calls.at(-1)!.body!).sha).toBe('b')
  })
})

describe('the list on screen', () => {
  const arranged = arrange(notes, 'notes', toggleFavorite(noArrangement, 'notes/books.md'), edited)
  const html = renderToStaticMarkup(createElement(NotesList, { arranged, label: 'notes', canArrange: true, onOpen() {}, onFolder() {}, onFavorites() {}, onGroups() {}, onInto() {}, onFavorite() {} }))

  it('shows every title as a card that is a button', () => {
    expect(html.match(/<button class="note-card/g)).toHaveLength(arranged.favorites.length + arranged.groups.length + arranged.notes.length)
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.note-card \{[^}]*border: 1px solid var\(--border\)[^}]*background: var\(--surface\)/)
  })

  it('puts favorites first, under their own name', () => {
    expect(html.indexOf('aria-label="favorites"')).toBeLessThan(html.indexOf('aria-label="notes"'))
    expect(html).toContain('>favorites</h2>')
  })

  it('lets a note be carried onto a group, but not into the journal', () => {
    expect(html).toContain('data-drop="notes/recipes"')
    expect(html).not.toContain('data-drop="notes/journal"')
  })

  it('carries nothing where notes cannot be arranged', () => {
    const still = renderToStaticMarkup(createElement(NotesList, { arranged, label: 'journal', canArrange: false, onOpen() {}, onFolder() {}, onFavorites() {}, onGroups() {}, onInto() {}, onFavorite() {} }))
    expect(still).not.toContain('data-kind')
    expect(still).not.toContain('data-drop')
  })

  it('stars and unstars from the note itself, as notion does', () => {
    const view = readFileSync(new URL('./NotesView.tsx', import.meta.url), 'utf8')
    expect(view).toContain("favorite ? 'remove from favorites' : 'add to favorites'")
  })
})
