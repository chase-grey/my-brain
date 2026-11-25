import { beforeEach, expect, it, vi } from 'vitest'
import type { VaultStore } from '../companion/githubVault'
import { folderPath, keepUnsaved, loadOps, loadUnsaved, movedPath, noteFolders, renamedPath, withPending } from './notes'
import { MemoryMirror, moveNote, OfflineVault, openNotes, removeNote, syncNotes, unreachable, waitingCount } from './offline'

// A made-up vault that can be cut off, the way a plane cuts it off: every call fails without an answer.
function fakeVault(start: Record<string, string>) {
  const files = new Map(Object.entries(start))
  const calls: string[] = []
  const state = { down: false }
  const reach = (call: string) => {
    if (state.down) throw new TypeError('failed to fetch')
    calls.push(call)
  }
  const remote: VaultStore = {
    async listNotes() { reach('list'); return [...files.keys()].map((path) => ({ path, sha: `${path}:${files.get(path)!.length}` })) },
    async readNote(path) {
      reach(`read ${path}`)
      if (!files.has(path)) throw Object.assign(new Error('missing'), { status: 404 })
      return { content: files.get(path)!, sha: `${path}:${files.get(path)!.length}` }
    },
    async writeNote(path, content) { reach(`write ${path}`); files.set(path, content); return { sha: `${path}:${content.length}` } },
    async appendNote(path, text) { reach(`append ${path}`); files.set(path, (files.get(path) ?? '') + text); return { sha: path } },
    async deleteNote(path) { reach(`delete ${path}`); files.delete(path) },
  }
  return { files, calls, state, remote, vault: new OfflineVault(remote, new MemoryMirror(), 200, 200) }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } })
  openNotes.clear()
})

it('keeps a copy of every note under notes on the device, and nothing from outside it', async () => {
  const { vault } = fakeVault({ 'notes/songs.md': 'la', 'notes/journal/2026/2026-11-25.md': 'day', 'memory/MEMORY.md': 'private' })
  await vault.listNotes()
  await settle()
  expect([...(vault.mirror as MemoryMirror).files.keys()].sort()).toEqual(['notes/journal/2026/2026-11-25.md', 'notes/songs.md'])
})

it('lists and opens notes with no connection, from the copy on the device', async () => {
  const { vault, state } = fakeVault({ 'notes/songs.md': 'la', 'notes/plants.md': 'fern' })
  await vault.listNotes()
  await settle()
  state.down = true
  expect((await vault.listNotes()).map((note) => note.path)).toEqual(['notes/songs.md', 'notes/plants.md'])
  expect((await vault.readNote('notes/plants.md')).content).toBe('fern')
  expect(vault.offline).toBe(true)
  state.down = false
  await vault.listNotes()
  expect(vault.offline).toBe(false)
})

it('with no connection, a note that was never in the vault reads as new and one not yet copied says so', async () => {
  const { vault, state } = fakeVault({ 'notes/songs.md': 'la' })
  await vault.listNotes()
  await settle()
  ;(vault.mirror as MemoryMirror).files.delete('notes/songs.md')
  state.down = true
  await expect(vault.readNote('notes/new.md')).rejects.toMatchObject({ status: 404 })
  const error = await vault.readNote('notes/songs.md').catch((caught: unknown) => caught)
  expect(unreachable(error)).toBe(true)
})

it('does not fall back to the device when the vault answers no', async () => {
  const { vault, remote } = fakeVault({ 'notes/songs.md': 'la' })
  await vault.listNotes()
  await settle()
  remote.readNote = async () => { throw Object.assign(new Error('rejected'), { status: 401 }) }
  await expect(vault.readNote('notes/songs.md')).rejects.toMatchObject({ status: 401 })
})

it('does not wait on a vault that never answers once the note is on the device', async () => {
  const { vault, remote } = fakeVault({ 'notes/songs.md': 'la' })
  await vault.listNotes()
  await settle()
  remote.readNote = () => new Promise(() => {})
  expect((await vault.readNote('notes/songs.md')).content).toBe('la')
})

it('what is written with no connection waits on the device and goes up when the vault is back', async () => {
  const { vault, state, files } = fakeVault({ 'notes/songs.md': 'la\n' })
  await vault.listNotes()
  await settle()
  state.down = true
  keepUnsaved('notes/songs.md', { content: 'la\nla la\n', base: 'la\n' })
  keepUnsaved('notes/journal/2026/2026-11-25.md', { content: '## 3:04 pm\n\nthe garden\n', base: '' })
  expect(await syncNotes(vault)).toMatchObject({ waiting: 2, offline: true, sent: 0 })
  expect(files.get('notes/songs.md')).toBe('la\n')
  state.down = false
  expect(await syncNotes(vault)).toMatchObject({ waiting: 0, offline: false, sent: 2 })
  expect(files.get('notes/songs.md')).toBe('la\nla la\n')
  expect(files.get('notes/journal/2026/2026-11-25.md')).toBe('## 3:04 pm\n\nthe garden\n')
  expect(loadUnsaved()).toEqual({})
})

it('what was written offline is merged with what changed in the vault meanwhile, both kept', async () => {
  const { vault, files } = fakeVault({ 'notes/songs.md': 'top\nfrom the pc\n' })
  keepUnsaved('notes/songs.md', { content: 'top\nfrom the phone\n', base: 'top\n' })
  await syncNotes(vault)
  expect(files.get('notes/songs.md')).toContain('from the phone')
  expect(files.get('notes/songs.md')).toContain('from the pc')
})

it('a sync leaves the note that is open on screen alone', async () => {
  const { vault, files } = fakeVault({ 'notes/songs.md': 'la\n' })
  keepUnsaved('notes/songs.md', { content: 'la\nla la\n', base: 'la\n' })
  openNotes.add('notes/songs.md')
  await syncNotes(vault)
  expect(files.get('notes/songs.md')).toBe('la\n')
  expect(waitingCount()).toBe(0)
})

it('renames a note in the vault, content unchanged', async () => {
  const { vault, files } = fakeVault({ 'notes/songs.md': 'la\n', 'notes/plants.md': 'fern' })
  await vault.listNotes()
  await settle()
  await moveNote(vault, 'notes/songs.md', 'notes/music/songs to learn.md')
  expect(await syncNotes(vault)).toMatchObject({ waiting: 0, sent: 1 })
  expect([...files.keys()].sort()).toEqual(['notes/music/songs to learn.md', 'notes/plants.md'])
  expect(files.get('notes/music/songs to learn.md')).toBe('la\n')
})

it('a rename made with no connection shows here at once, opens from the device, takes its unsaved words along, and reaches the vault later', async () => {
  const { vault, state, files } = fakeVault({ 'notes/songs.md': 'la\n' })
  const listed = await vault.listNotes()
  await settle()
  state.down = true
  keepUnsaved('notes/songs.md', { content: 'la\nla la\n', base: 'la\n' })
  await moveNote(vault, 'notes/songs.md', 'notes/tunes.md')
  expect((await syncNotes(vault)).waiting).toBe(2)
  expect(withPending(listed, Object.keys(loadUnsaved()), loadOps()).map((note) => note.path)).toEqual(['notes/tunes.md'])
  expect((await vault.listNotes()).map((note) => note.path)).toEqual(['notes/tunes.md'])
  expect((await vault.readNote('notes/tunes.md')).content).toBe('la\n')
  expect(loadUnsaved()).toEqual({ 'notes/tunes.md': { content: 'la\nla la\n', base: 'la\n' } })
  state.down = false
  // Until the move has gone up the vault has no such file; the note still opens.
  expect((await vault.readNote('notes/tunes.md')).content).toBe('la\n')
  expect(await syncNotes(vault)).toMatchObject({ waiting: 0, sent: 2 })
  expect([...files.entries()]).toEqual([['notes/tunes.md', 'la\nla la\n']])
})

it('a note moved onto a name the vault has since taken keeps both', async () => {
  const { vault, files } = fakeVault({ 'notes/songs.md': 'mine\n', 'notes/tunes.md': 'theirs\n' })
  await moveNote(vault, 'notes/songs.md', 'notes/tunes.md')
  await syncNotes(vault)
  expect([...files.keys()]).toEqual(['notes/tunes.md'])
  expect(files.get('notes/tunes.md')).toContain('mine')
  expect(files.get('notes/tunes.md')).toContain('theirs')
})

it('deletes a note, here at once and in the vault when it can be reached, with its unsaved words', async () => {
  const { vault, state, files } = fakeVault({ 'notes/songs.md': 'la\n', 'notes/plants.md': 'fern' })
  const listed = await vault.listNotes()
  await settle()
  state.down = true
  keepUnsaved('notes/songs.md', { content: 'la la', base: 'la\n' })
  await removeNote(vault, 'notes/songs.md')
  expect(loadUnsaved()).toEqual({})
  expect(withPending(listed, [], loadOps()).map((note) => note.path)).toEqual(['notes/plants.md'])
  expect((await vault.listNotes()).map((note) => note.path)).toEqual(['notes/plants.md'])
  expect((await syncNotes(vault)).waiting).toBe(1)
  expect(files.has('notes/songs.md')).toBe(true)
  state.down = false
  expect(await syncNotes(vault)).toMatchObject({ waiting: 0, sent: 1 })
  expect([...files.keys()]).toEqual(['notes/plants.md'])
})

it('a delete or move of a note the vault no longer has is dropped, not retried forever', async () => {
  const { vault, calls } = fakeVault({ 'notes/plants.md': 'fern' })
  await removeNote(vault, 'notes/gone.md')
  await moveNote(vault, 'notes/also gone.md', 'notes/elsewhere.md')
  expect(await syncNotes(vault)).toMatchObject({ waiting: 0 })
  expect(calls.filter((call) => /^(write|delete)/.test(call))).toEqual([])
})

it('a note first written offline shows in the list before the vault has it', () => {
  expect(withPending([{ path: 'notes/songs.md', sha: 'a' }], ['notes/songs.md', 'notes/new.md'], []).map((note) => note.path)).toEqual(['notes/songs.md', 'notes/new.md'])
})

const note = (path: string) => ({ path, sha: path })
const all = ['notes/songs.md', 'notes/house/paint.md', 'notes/house/garden/beds.md', 'notes/house/.trash/old.md', 'notes/journal/2026/2026-11-25.md', '20 Projects/Garden.md'].map(note)

it('offers notes and its folders to move to, never the journal or anything outside notes', () => {
  expect(noteFolders(all)).toEqual(['notes', 'notes/house', 'notes/house/garden'])
  expect(folderPath('House / Paint Jobs')).toBe('notes/House/Paint Jobs')
  expect(folderPath('journal')).toBeUndefined()
  expect(folderPath('notes/journal/2026')).toBeUndefined()
})

it('renames within the folder, numbers a taken name, and leaves journal entries their day', () => {
  expect(renamedPath(all, 'notes/house/paint.md', 'colors')).toBe('notes/house/colors.md')
  expect(renamedPath(all, 'notes/house/paint.md', 'paint')).toBeUndefined()
  expect(renamedPath([...all, note('notes/tunes.md')], 'notes/songs.md', 'Tunes')).toBe('notes/Tunes 2.md')
  expect(renamedPath(all, 'notes/songs.md', '  /  ')).toBeUndefined()
  expect(renamedPath(all, 'notes/journal/2026/2026-11-25.md', 'today')).toBeUndefined()
})

it('moves a note to another folder under its own name, and never into or out of the journal', () => {
  expect(movedPath(all, 'notes/songs.md', 'notes/house')).toBe('notes/house/songs.md')
  expect(movedPath(all, 'notes/songs.md', 'notes')).toBeUndefined()
  expect(movedPath([...all, note('notes/paint.md')], 'notes/house/paint.md', 'notes')).toBe('notes/paint 2.md')
  expect(movedPath(all, 'notes/songs.md', 'notes/journal/2026')).toBeUndefined()
  expect(movedPath(all, 'notes/journal/2026/2026-11-25.md', 'notes')).toBeUndefined()
})
