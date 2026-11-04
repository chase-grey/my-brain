// The service worker answers the share-target POST by putting each shared text into this cache
// and redirecting to #share. The app drains it here. Entries stay until the note is written, so
// a missing vault config or a failed push loses nothing.
import { GitHubError, type VaultStore } from '../companion/githubVault'
import { type SharedTranscript, parseTranscript, transcriptNote, transcriptPath } from './transcriptNote'

export const shareCacheName = 'my-brain-share'
export const shareTitleHeader = 'x-share-title'

export type ShareEntry = SharedTranscript & { key: string }

type CacheLike = Pick<Cache, 'keys' | 'match' | 'delete'>

export async function readSharedEntries(cache: CacheLike): Promise<ShareEntry[]> {
  const requests = await cache.keys()
  const entries: ShareEntry[] = []
  for (const request of requests) {
    const response = await cache.match(request)
    if (!response) continue
    const text = await response.text()
    if (!text.trim()) { await cache.delete(request); continue }
    entries.push({ key: request.url, text, title: decodeTitle(response.headers.get(shareTitleHeader)) })
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key))
}

// The worker percent-encodes the title so it survives as a header value.
function decodeTitle(value: string | null): string | undefined {
  if (!value) return undefined
  try { return decodeURIComponent(value) || undefined } catch { return value }
}

export async function fileTranscript(vault: VaultStore, shared: SharedTranscript, today: string): Promise<string> {
  const parsed = parseTranscript(shared, today)
  let suffix = 1
  let path = transcriptPath(parsed)
  while (await exists(vault, path)) path = transcriptPath(parsed, ++suffix)
  await vault.writeNote(path, transcriptNote(parsed))
  return path
}

async function exists(vault: VaultStore, path: string): Promise<boolean> {
  try {
    await vault.readNote(path)
    return true
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404) return false
    throw error
  }
}

export function openSharedCache(): Promise<CacheLike> | undefined {
  if (typeof caches === 'undefined') return undefined
  return caches.open(shareCacheName)
}
