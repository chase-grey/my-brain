/** Past this, an unsorted task or a flagged email is history, not something newly waiting on me. The mail app uses the same number. */
export const oldAfterDays = 30

export function isOld(at: string | undefined, now: string, days = oldAfterDays): boolean {
  if (!at) return false
  return new Date(at).getTime() < new Date(now).getTime() - days * 86_400_000
}

export function oldCutoff(now: string, days = oldAfterDays): string {
  return new Date(new Date(now).getTime() - days * 86_400_000).toISOString()
}
