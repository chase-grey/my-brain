import { useEffect, useState } from 'react'
import type { VaultStore } from '../companion/githubVault'
import { journalDays } from './journal'

// The days with a journal entry, for the mind slice and its challenges. Only the file names are looked at; an entry is never opened.
// The list is kept on the device so the slice and the reviews can count without the vault.

const key = 'my-brain.personal.journal-days.v1'

export function cachedJournalDays(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function useJournalDays(vault?: Pick<VaultStore, 'listNotes'>): string[] {
  const [days, setDays] = useState(cachedJournalDays)
  useEffect(() => {
    if (!vault) return
    let live = true
    vault.listNotes().then((notes) => {
      const next = journalDays(notes)
      try {
        localStorage.setItem(key, JSON.stringify(next))
      } catch {
        // The count on screen is still right.
      }
      if (live) setDays((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }).catch(() => undefined)
    return () => { live = false }
  }, [vault])
  return days
}
