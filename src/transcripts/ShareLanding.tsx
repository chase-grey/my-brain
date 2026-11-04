import { useEffect, useState } from 'react'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured } from '../companion/githubVault'
import { loadSettings } from '../settings'
import { fileTranscript, openSharedCache, readSharedEntries } from './shareInbox'

type Filed = { path: string; url: string }
type State =
  | { kind: 'working' }
  | { kind: 'empty' }
  | { kind: 'unconfigured' }
  | { kind: 'done'; filed: Filed[] }
  | { kind: 'error'; message: string; filed: Filed[] }

// Lands here from the service worker's share-target redirect. Always files into HomeBase:
// personal owns notes, and work recordings leave Mark's app through send transcript instead.
export default function ShareLanding({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: 'working' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const settings = loadSettings('personal')
      const config = { repo: normalizeRepo(settings.githubRepo), token: settings.githubToken.replace(/\s+/g, ''), branch: normalizeBranch(settings.vaultBranch) }
      const cache = await openSharedCache()
      const entries = cache ? await readSharedEntries(cache) : []
      if (cancelled) return
      if (!entries.length) { setState({ kind: 'empty' }); return }
      if (!vaultConfigured(config)) { setState({ kind: 'unconfigured' }); return }

      const vault = new GitHubVault(config)
      const today = new Date().toISOString().slice(0, 10)
      const filed: Filed[] = []
      for (const entry of entries) {
        try {
          const path = await fileTranscript(vault, entry, today)
          await cache?.delete(entry.key)
          filed.push({ path, url: `https://github.com/${config.repo}/blob/${encodeURIComponent(config.branch)}/${path.split('/').map(encodeURIComponent).join('/')}` })
        } catch (error) {
          if (!cancelled) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error), filed })
          return
        }
      }
      if (!cancelled) setState({ kind: 'done', filed })
    })()
    return () => { cancelled = true }
  }, [attempt])

  return <section className="card share-landing" aria-live="polite">
    {state.kind === 'working' && <p>filing transcript…</p>}
    {state.kind === 'empty' && <p>nothing was shared</p>}
    {state.kind === 'unconfigured' && <p>needs the github repo and token in personal settings. the transcript is kept until then.</p>}
    {(state.kind === 'done' || state.kind === 'error') && state.filed.map((item) => <p key={item.path}>filed {item.path} <a href={item.url} target="_blank" rel="noreferrer">open</a></p>)}
    {state.kind === 'error' && <p>{state.message} <button type="button" onClick={() => setAttempt((n) => n + 1)}>try again</button></p>}
    {state.kind !== 'working' && <p><button type="button" onClick={onClose}>done</button></p>}
  </section>
}
