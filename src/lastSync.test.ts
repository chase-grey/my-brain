import { expect, it } from 'vitest'
import { syncedLabel } from './lastSync'

const at = (text: string) => new Date(text).getTime()

it('says the time alone for a sync today', () => {
  expect(syncedLabel(at('2026-11-25T14:14:00'), at('2026-11-25T18:00:00'))).toMatch(/^synced 2:14\s?pm$/)
})

it('names the day for a sync on any other day', () => {
  expect(syncedLabel(at('2026-11-24T09:05:00'), at('2026-11-25T18:00:00'))).toMatch(/^synced nov 24, 9:05\s?am$/)
})
