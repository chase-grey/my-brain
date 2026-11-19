import { describe, expect, it } from 'vitest'
import { fakeStorage, fakeVault } from './fakeVault'
import { PackingSync, tripCacheKey } from './packingSync'

const path = '30 Trips/2027-02 Tulum/packing.md'
const list = '## clothes\n- [ ] socks\n- [ ] hat\n'

describe('packing sync', () => {
  it('keeps a refreshed note on the device for the next open', async () => {
    const storage = fakeStorage()
    const vault = fakeVault({ [path]: list })
    await new PackingSync(vault, storage).refresh(path)
    vault.offline = true
    expect(new PackingSync(vault, storage).cached(path)).toBe(list)
  })

  it('saves an edit on the device while offline and pushes it once the vault is back', async () => {
    const storage = fakeStorage()
    const vault = fakeVault({ [path]: list })
    const sync = new PackingSync(vault, storage)
    await sync.refresh(path)
    vault.offline = true
    sync.save(path, list.replace('[ ] socks', '[x] socks'))
    await expect(sync.flush()).rejects.toThrow()
    expect(sync.pending()).toEqual([path])
    expect(JSON.parse(storage.values[tripCacheKey]).notes[path].dirty).toBe(true)

    vault.offline = false
    const reopened = new PackingSync(vault, storage)
    await reopened.flush()
    expect(vault.notes[path]).toBe('## clothes\n- [x] socks\n- [ ] hat\n')
    expect(reopened.pending()).toEqual([])
  })

  it('merges an unsent edit with a change made on the other side instead of overwriting it', async () => {
    const vault = fakeVault({ [path]: list })
    const sync = new PackingSync(vault, fakeStorage())
    await sync.refresh(path)
    sync.save(path, list.replace('[ ] socks', '[x] socks'))
    vault.notes[path] = `${list}- [ ] rain jacket\n`
    await sync.flush()
    expect(vault.notes[path]).toBe('## clothes\n- [x] socks\n- [ ] hat\n- [ ] rain jacket\n')
    expect(sync.cached(path)).toBe(vault.notes[path])
  })

  it('folds a remote change into unsent edits on refresh and keeps them waiting', async () => {
    const vault = fakeVault({ [path]: list })
    const sync = new PackingSync(vault, fakeStorage())
    await sync.refresh(path)
    sync.save(path, `${list}- [ ] gloves\n`)
    vault.notes[path] = list.replace('- [ ] hat\n', '')
    expect(await sync.refresh(path)).toBe('## clothes\n- [ ] socks\n- [ ] gloves\n')
    expect(sync.pending()).toEqual([path])
  })

  it('creates a note that does not exist yet and writes nothing when nothing changed', async () => {
    const vault = fakeVault()
    const sync = new PackingSync(vault, fakeStorage())
    expect(await sync.refresh('30 Trips/packing/ski.md')).toBeUndefined()
    sync.save('30 Trips/packing/ski.md', '- [ ] goggles\n')
    await sync.flush()
    await sync.flush()
    expect(vault.notes['30 Trips/packing/ski.md']).toBe('- [ ] goggles\n')
    expect(vault.writes).toEqual(['30 Trips/packing/ski.md'])
  })

  it('keeps an edit made while a push was in flight', async () => {
    const vault = fakeVault({ [path]: list })
    const sync = new PackingSync(vault, fakeStorage())
    await sync.refresh(path)
    sync.save(path, list.replace('[ ] socks', '[x] socks'))
    const write = vault.writeNote
    vault.writeNote = async (to, content) => {
      vault.writeNote = write
      sync.save(path, '## clothes\n- [x] socks\n- [x] hat\n')
      return write(to, content)
    }
    await sync.flush()
    expect(vault.notes[path]).toBe('## clothes\n- [x] socks\n- [ ] hat\n')
    expect(sync.pending()).toEqual([path])
    await sync.flush()
    expect(vault.notes[path]).toBe('## clothes\n- [x] socks\n- [x] hat\n')
    expect(sync.pending()).toEqual([])
  })

  it('works without storage and forgets a note on request', async () => {
    const sync = new PackingSync(fakeVault({ [path]: list }))
    await sync.refresh(path)
    sync.forget(path)
    expect(sync.cached(path)).toBeUndefined()
  })
})
