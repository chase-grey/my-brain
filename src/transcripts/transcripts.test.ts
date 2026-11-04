import { describe, expect, it } from 'vitest'
import { GitHubError, type VaultStore } from '../companion/githubVault'
import { fileTranscript, readSharedEntries } from './shareInbox'
import { parseTranscript, safeTitle, transcriptNote, transcriptPath } from './transcriptNote'

const markdownExport = [
  '# Roadmap sync',
  '',
  '- Date: Nov 4, 2026, 2:15 PM',
  '- Duration: 41:12',
  '- Speakers: 3',
  '',
  '[00:00] Chase: Let us start with the migration.',
  '[00:07] Speaker 2: Sure.',
  '',
].join('\n')

describe('parseTranscript', () => {
  it('reads the header of the markdown export and keeps the lines', () => {
    const parsed = parseTranscript({ text: markdownExport }, '2026-12-31')
    expect(parsed).toEqual({
      title: 'Roadmap sync',
      date: '2026-11-04',
      duration: '41:12',
      speakers: 3,
      body: '[00:00] Chase: Let us start with the migration.\n[00:07] Speaker 2: Sure.',
    })
  })

  it('falls back to the share title and today for a plain text export', () => {
    const parsed = parseTranscript({ text: '[00:00] Speaker 1: hello\r\n[00:03] Speaker 2: hi\r\n', title: 'Coffee chat' }, '2026-11-04')
    expect(parsed.title).toBe('Coffee chat')
    expect(parsed.date).toBe('2026-11-04')
    expect(parsed.duration).toBeUndefined()
    expect(parsed.body).toBe('[00:00] Speaker 1: hello\n[00:03] Speaker 2: hi')
  })

  it('names an untitled share recording', () => {
    expect(parseTranscript({ text: 'words' }, '2026-11-04').title).toBe('recording')
  })
})

describe('transcriptPath and transcriptNote', () => {
  it('builds the dated path under 40 Transcripts and numbers duplicates', () => {
    const parsed = parseTranscript({ text: markdownExport }, '2026-11-04')
    expect(transcriptPath(parsed)).toBe('40 Transcripts/2026-11-04 Roadmap sync.md')
    expect(transcriptPath(parsed, 2)).toBe('40 Transcripts/2026-11-04 Roadmap sync 2.md')
  })

  it('strips characters OneDrive and Windows refuse', () => {
    expect(safeTitle('1:1 with Sam? <draft>')).toBe('1_1 with Sam_ _draft_')
    expect(safeTitle('   ')).toBe('recording')
    expect(safeTitle('con')).toBe('_con')
  })

  it('writes frontmatter, the heading, and the body', () => {
    const parsed = parseTranscript({ text: markdownExport }, '2026-11-04')
    expect(transcriptNote(parsed)).toBe([
      '---',
      'date: 2026-11-04',
      'duration: "41:12"',
      'speakers: 3',
      'source: transcribe',
      '---',
      '# Roadmap sync',
      '',
      '[00:00] Chase: Let us start with the migration.',
      '[00:07] Speaker 2: Sure.',
      '',
    ].join('\n'))
  })
})

function fakeVault(existing: Set<string>): VaultStore & { written: Record<string, string> } {
  const written: Record<string, string> = {}
  return {
    written,
    listNotes: async () => [],
    readNote: async (path) => {
      if (existing.has(path) || path in written) return { content: '', sha: 'x' }
      throw new GitHubError(404, '')
    },
    writeNote: async (path, content) => { written[path] = content; return { sha: 'y' } },
    appendNote: async () => ({ sha: 'z' }),
    deleteNote: async () => undefined,
  }
}

describe('fileTranscript', () => {
  it('writes the note and skips past taken names', async () => {
    const vault = fakeVault(new Set(['40 Transcripts/2026-11-04 Roadmap sync.md']))
    const path = await fileTranscript(vault, { text: markdownExport }, '2026-11-04')
    expect(path).toBe('40 Transcripts/2026-11-04 Roadmap sync 2.md')
    expect(vault.written[path]).toContain('# Roadmap sync')
  })

  it('surfaces other github errors', async () => {
    const vault = fakeVault(new Set())
    vault.readNote = async () => { throw new GitHubError(401, '') }
    await expect(fileTranscript(vault, { text: markdownExport }, '2026-11-04')).rejects.toThrow('github rejected the token')
  })
})

describe('readSharedEntries', () => {
  it('returns shared texts with decoded titles and drops empty ones', async () => {
    const deleted: string[] = []
    const store = new Map<string, Response>([
      ['https://app/share/2-0', new Response('second', { headers: { 'x-share-title': encodeURIComponent('Two & three') } })],
      ['https://app/share/1-0', new Response('first')],
      ['https://app/share/0-0', new Response('   ')],
    ])
    const cache = {
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      match: async (request: RequestInfo | URL) => store.get(typeof request === 'string' ? request : (request as Request).url),
      delete: async (request: RequestInfo | URL) => { deleted.push((request as Request).url); return true },
    }
    const entries = await readSharedEntries(cache)
    expect(entries.map((entry) => [entry.text, entry.title])).toEqual([['first', undefined], ['second', 'Two & three']])
    expect(deleted).toEqual(['https://app/share/0-0'])
  })
})
