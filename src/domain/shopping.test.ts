import { describe, expect, it } from 'vitest'
import { task } from './fixtures'
import { visibleStoreItems } from './shopping'

describe('shopping lists', () => {
  it('keeps checked grocery staples visible so they can be unchecked later', () => {
    const milk = task({ id: 'milk', storeType: 'grocery', completed: true })
    expect(visibleStoreItems([milk], 'grocery')).toEqual([milk])
  })

  it.each(['amazon', 'hardware', 'other'] as const)('removes bought %s items from the active list', (storeType) => {
    const item = task({ id: storeType, storeType, completed: true })
    expect(visibleStoreItems([item], storeType)).toEqual([])
  })
})
