import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitHubIssues, issuesWaiting, type IssueStore, type TrackedIssue } from './issues'

/** How often an open app looks for an issue that has started waiting on the user. */
export const issueCheckMs = 30 * 60 * 1000

function cleanToken(token: string): string {
  return token.replace(/\s+/g, '')
}

/** The filed issues for settings: read when the card opens and again after anything is done to one. */
export function useIssues(token: string): { store?: IssueStore; issues?: TrackedIssue[]; error?: string; reload(): Promise<void> } {
  const clean = cleanToken(token)
  const store = useMemo(() => clean ? new GitHubIssues(clean) : undefined, [clean])
  const [issues, setIssues] = useState<TrackedIssue[]>()
  const [error, setError] = useState<string>()

  const reload = useCallback(async () => {
    if (!store) return
    try {
      setIssues(await store.list())
      setError(undefined)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'could not read the issues')
    }
  }, [store])

  useEffect(() => {
    setIssues(undefined)
    setError(undefined)
    if (!store) return
    // A token is pasted, but one typed by hand should not be tried a letter at a time.
    const timer = setTimeout(() => void reload(), 600)
    return () => clearTimeout(timer)
  }, [store, reload])

  return { store, issues, error, reload }
}

/** How many filed issues wait on an answer or a merge, for the dot on settings. Quiet when it cannot tell. */
export function useIssuesWaiting(token: string): number {
  const clean = cleanToken(token)
  const [waiting, setWaiting] = useState(0)

  useEffect(() => {
    setWaiting(0)
    if (!clean) return
    let stopped = false
    const check = () => {
      if (document.hidden) return
      new GitHubIssues(clean).list().then((issues) => { if (!stopped) setWaiting(issuesWaiting(issues)) }).catch(() => undefined)
    }
    check()
    const timer = setInterval(check, issueCheckMs)
    return () => { stopped = true; clearInterval(timer) }
  }, [clean])

  return waiting
}
