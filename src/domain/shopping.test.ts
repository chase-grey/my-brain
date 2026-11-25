import { describe, expect, it } from 'vitest'
import { task } from './fixtures'
import { currentStore, shopsFromHome, storeOptions, visibleStoreItems } from './shopping'

describe('shopping lists', () => {
  it('keeps checked grocery staples visible so they can be unchecked later', () => {
    const milk = task({ id: 'milk', storeType: 'grocery', completed: true })
    expect(visibleStoreItems([milk], 'grocery')).toEqual([milk])
  })

  it.each(['online', 'hardware', 'thrift', 'marketplace', 'other'] as const)('removes bought %s items from the active list', (storeType) => {
    const item = task({ id: storeType, storeType, completed: true })
    expect(visibleStoreItems([item], storeType)).toEqual([])
  })

  it('shops online and marketplace from home, and drives to the rest', () => {
    expect(storeOptions.filter((store) => shopsFromHome(store.value)).map((store) => store.value)).toEqual(['online', 'marketplace'])
  })

  it('reads an item saved under a store\'s old name as the store it is now', () => {
    expect(currentStore('amazon')).toBe('online')
    expect(currentStore('general')).toBe('other')
    expect(currentStore('grocery')).toBe('grocery')
    expect(currentStore(undefined)).toBeUndefined()
    expect(storeOptions.map((store) => store.value)).not.toContain('amazon')
  })
})
