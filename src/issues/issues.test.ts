import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { describeAction } from '../companion/actions'
import { buildSystemPrompt } from '../companion/companionPrompt'
import { companionTools, executeTool, type CompanionActions, type PlanSummary } from '../companion/companionTools'
import { syncedFields } from '../settingsSync'
import { GitHubIssues, issueBodyLimit, mayReportIssues, issueProgress, issuesWaiting, shownIssues, type IssueStore, type TrackedIssue } from './issues'

const actions = {} as CompanionActions
const summary: PlanSummary = { today: '2026-11-25', openCount: 0, dueToday: [], overdue: [], thisWeek: [], suggested: [], goals: [], projects: [] }
const now = new Date(2026, 10, 25, 15)

function issue(over: Partial<TrackedIssue>): TrackedIssue {
  return { app: 'my-brain', number: 1, title: 'x', url: 'https://github.com/chase-grey/my-brain/issues/1', state: 'open', labels: ['from-app', 'auto-fix'], closedAt: '', ...over }
}

type Call = { method: string; url: string; body?: Record<string, unknown> }

function fakeGitHub(answer: (call: Call) => { status?: number; json?: unknown } = () => ({})) {
  const calls: Call[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { method: init?.method ?? 'GET', url: String(input).replace('https://api.github.com', ''), ...(init?.body ? { body: JSON.parse(String(init.body)) as Record<string, unknown> } : {}) }
    calls.push(call)
    const { status = 200, json = {} } = answer(call)
    return new Response(status === 204 ? null : JSON.stringify(json), { status })
  }) as typeof fetch
  return { calls, issues: new GitHubIssues('token', fetcher) }
}

describe('reporting an issue from chat', () => {
  it('is offered only when there is an issue token', () => {
    expect(companionTools({ hasVault: false }).map((tool) => tool.name)).not.toContain('report_issue')
    expect(companionTools({ hasVault: false, hasIssues: true }).map((tool) => tool.name)).toContain('report_issue')
  })

  it('is only ever for the owner, in the personal space', () => {
    expect(mayReportIssues({ domain: 'personal', owner: true, token: 'token' })).toBe(true)
    // Someone else's device, even holding a token that came over in a setup link.
    expect(mayReportIssues({ domain: 'personal', owner: false, token: 'token' })).toBe(false)
    expect(mayReportIssues({ domain: 'work', owner: true, token: 'token' })).toBe(false)
    expect(mayReportIssues({ domain: 'personal', owner: true, token: '' })).toBe(false)
  })

  it('waits for approval on a card that shows every word that will be public', async () => {
    const description = await describeAction('report_issue', { app: 'my-mail', title: 'archive leaves the thread open', body: 'after archive the thread stays on screen.\nit should go back to the inbox.' }, { actions })
    expect(description).toEqual({
      weight: 'heavy',
      title: 'file issue "archive leaves the thread open"',
      done: 'filed issue "archive leaves the thread open"',
      fields: [{ label: 'app', value: 'my mail' }, { label: 'issue', value: 'after archive the thread stays on screen.\nit should go back to the inbox.' }, { label: 'seen by', value: 'anyone on github' }],
    })
  })

  it('files exactly what was approved, for either app, and nothing else', async () => {
    const file = vi.fn(async () => ({ number: 12, url: 'https://github.com/chase-grey/my-mail/issues/12' }))
    const issues = { file } as unknown as IssueStore
    const outcome = await executeTool('report_issue', { app: 'my-mail', title: 'archive leaves the thread open', body: 'it should go back to the inbox' }, { actions, issues })
    expect(outcome.ok).toBe(true)
    expect(file).toHaveBeenCalledWith('my-mail', 'archive leaves the thread open', 'it should go back to the inbox')
    expect(outcome.ok && outcome.content).toContain('"number":12')

    expect(await executeTool('report_issue', { app: 'workout-tracker', title: 'squat log loses the weight', body: 'the weight goes back to zero' }, { actions, issues })).toMatchObject({ ok: true })
    expect(file).toHaveBeenLastCalledWith('workout-tracker', 'squat log loses the weight', 'the weight goes back to zero')
    expect(await executeTool('report_issue', { app: 'my-notes', title: 'x', body: 'y' }, { actions, issues })).toEqual({ ok: false, error: 'app must be one of my-brain, my-mail, workout-tracker' })
    // A report too long to file whole is refused, so what goes up is never a cut version of what was approved.
    expect((await executeTool('report_issue', { app: 'my-brain', title: 'x', body: 'y'.repeat(issueBodyLimit + 1) }, { actions, issues })).ok).toBe(false)
    expect(await executeTool('report_issue', { app: 'my-brain', title: 'x', body: 'y' }, { actions })).toEqual({ ok: false, error: 'report issues is off' })
    expect(file).toHaveBeenCalledTimes(2)
  })

  it('offers workout tracker as a third app, named plainly on the card', async () => {
    const tool = companionTools({ hasVault: false, hasIssues: true }).find((item) => item.name === 'report_issue')
    expect(JSON.stringify(tool?.input_schema)).toContain('"workout-tracker"')
    const description = await describeAction('report_issue', { app: 'workout-tracker', title: 'timer stops', body: 'the rest timer stops when the screen locks' }, { actions })
    expect(description?.weight).toBe('heavy')
    expect(description?.fields).toContainEqual({ label: 'app', value: 'workout tracker' })
    expect(description?.fields).toContainEqual({ label: 'seen by', value: 'anyone on github' })
    expect(buildSystemPrompt({ domain: 'personal', summary, vaultAvailable: false, issuesAvailable: true })).toContain('workout-tracker')
  })

  it('tells the model about it only with a token, and to keep personal things out', () => {
    const withIssues = buildSystemPrompt({ domain: 'personal', summary, vaultAvailable: false, issuesAvailable: true })
    expect(withIssues).toContain('report_issue')
    expect(withIssues).toContain('public')
    expect(buildSystemPrompt({ domain: 'personal', summary, vaultAvailable: false })).not.toContain('report_issue')
    expect(buildSystemPrompt({ domain: 'work', summary, vaultAvailable: false })).not.toContain('report_issue')
  })

  it('leaves report issues on for the open chat: only its switch changes it, never a filed report', () => {
    const chat = readFileSync(join(process.cwd(), 'src', 'companion', 'ChatView.tsx'), 'utf8')
    expect(chat).toContain('const [reporting, setReporting] = useState(false)')
    // The one other mention is the switch itself.
    expect(chat.match(/setReporting\(/g)).toHaveLength(1)
    expect(chat).toContain('onChange={(event) => setReporting(event.target.checked)}')
  })

  it('carries the issue token to the other devices with the other keys', () => {
    expect(syncedFields).toContain('issueToken')
  })
})

describe('github issues', () => {
  it('files to the app\'s repo with the labels the fixer looks for, then locks the thread', async () => {
    const { calls, issues } = fakeGitHub((call) => call.url.endsWith('/issues') ? { status: 201, json: { number: 7, html_url: 'https://github.com/chase-grey/my-mail/issues/7' } } : { status: 204 })
    expect(await issues.file('my-mail', '  search   misses drafts ', 'drafts never show up in search')).toEqual({ number: 7, url: 'https://github.com/chase-grey/my-mail/issues/7' })
    expect(calls).toEqual([
      { method: 'POST', url: '/repos/chase-grey/my-mail/issues', body: { title: 'search misses drafts', body: 'drafts never show up in search', labels: ['from-app', 'auto-fix'] } },
      { method: 'PUT', url: '/repos/chase-grey/my-mail/issues/7/lock', body: { lock_reason: 'off-topic' } },
    ])
  })

  it('counts the report as filed when only the lock fails', async () => {
    const { issues } = fakeGitHub((call) => call.url.endsWith('/lock') ? { status: 403 } : { status: 201, json: { number: 7, html_url: 'u' } })
    expect((await issues.file('my-brain', 'x', 'y')).number).toBe(7)
  })

  it('says in plain words when the token is refused or cannot reach the repo', async () => {
    await expect(fakeGitHub(() => ({ status: 401 })).issues.file('my-brain', 'x', 'y')).rejects.toThrow('github rejected the issue token')
    await expect(fakeGitHub(() => ({ status: 404 })).issues.list()).rejects.toThrow('the issue token cannot reach chase-grey/my-brain')
  })

  it('files a workout tracker issue to its own repo', async () => {
    const { calls, issues } = fakeGitHub((call) => call.url.endsWith('/issues') ? { status: 201, json: { number: 9, html_url: 'https://github.com/chase-grey/workout-tracker/issues/9' } } : { status: 204 })
    expect((await issues.file('workout-tracker', 'timer stops', 'the rest timer stops')).number).toBe(9)
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(['POST /repos/chase-grey/workout-tracker/issues', 'PUT /repos/chase-grey/workout-tracker/issues/9/lock'])
  })

  it('still lists the other repos when the token cannot reach one of them', async () => {
    const { issues } = fakeGitHub((call) => call.url.includes('workout-tracker') ? { status: 404 } : { json: call.url.includes('my-mail') ? [] : [
      { number: 3, title: 'wheel clips', html_url: 'u3', state: 'open', closed_at: null, labels: [] },
    ] })
    expect((await issues.list()).map((item) => item.number)).toEqual([3])
  })

  it('lists what the app filed in every repo, without the pull requests', async () => {
    const { calls, issues } = fakeGitHub((call) => ({ json: call.url.includes('my-mail') || call.url.includes('workout-tracker') ? [] : [
      { number: 3, title: 'wheel clips', html_url: 'u3', state: 'open', closed_at: null, labels: [{ name: 'from-app' }, { name: 'needs-input' }] },
      { number: 4, title: 'a fix', html_url: 'u4', state: 'open', closed_at: null, labels: [], pull_request: {} },
    ] }))
    expect(await issues.list()).toEqual([{ app: 'my-brain', number: 3, title: 'wheel clips', url: 'u3', state: 'open', labels: ['from-app', 'needs-input'], closedAt: '' }])
    expect(calls.map((call) => call.url)).toEqual(['/repos/chase-grey/my-brain/issues?labels=from-app&state=all&per_page=50&sort=created&direction=desc', '/repos/chase-grey/my-mail/issues?labels=from-app&state=all&per_page=50&sort=created&direction=desc', '/repos/chase-grey/workout-tracker/issues?labels=from-app&state=all&per_page=50&sort=created&direction=desc'])
  })

  it('reads the fixer\'s question off the newest comment and hands the issue back with the answer', async () => {
    const { calls, issues } = fakeGitHub((call) => call.method === 'GET' ? { json: [{ body: 'old' }, { body: '**Auto-fix needs a bit more to go on:**\n\nwhich screen?' }] } : {})
    expect(await issues.question({ app: 'my-brain', number: 3 })).toBe('which screen?')
    await issues.answer({ app: 'my-brain', number: 3 }, ' the progress screen ')
    expect(calls.slice(1)).toEqual([
      { method: 'POST', url: '/repos/chase-grey/my-brain/issues/3/comments', body: { body: '**Answer from the app:**\n\nthe progress screen' } },
      { method: 'DELETE', url: '/repos/chase-grey/my-brain/issues/3/labels/needs-input' },
      { method: 'POST', url: '/repos/chase-grey/my-brain/issues/3/labels', body: { labels: ['auto-fix'] } },
    ])
  })
})

describe('where an issue stands', () => {
  it('reads the fixer\'s labels, and what waits on the user first', () => {
    expect(issueProgress(issue({}), now)).toBe('open')
    expect(issueProgress(issue({ labels: ['autofix-running'] }), now)).toBe('working')
    expect(issueProgress(issue({ labels: ['autofix-running', 'needs-input'] }), now)).toBe('asks')
    expect(issueProgress(issue({ labels: ['autofix-review'] }), now)).toBe('review')
    expect(issueProgress(issue({ labels: ['autofix-failed'] }), now)).toBe('stalled')
    expect(issueProgress(issue({ state: 'closed', closedAt: new Date(2026, 10, 25, 9).toISOString() }), now)).toBe('completed')
    expect(issueProgress(issue({ state: 'closed', closedAt: new Date(2026, 10, 24, 23).toISOString() }), now)).toBe('closed')
  })

  it('shows what is open and what was fixed today, and lets older closed issues go', () => {
    const list = [
      issue({ number: 1, state: 'closed', closedAt: new Date(2026, 10, 20).toISOString() }),
      issue({ number: 2 }),
      issue({ number: 3, state: 'closed', closedAt: new Date(2026, 10, 25, 9).toISOString() }),
      issue({ number: 4, labels: ['autofix-review'] }),
      issue({ number: 5, labels: ['needs-input'] }),
    ]
    expect(shownIssues(list, now).map((item) => item.number)).toEqual([5, 4, 2, 3])
    expect(issuesWaiting(list, now)).toBe(2)
    // Sixty closed reports from past weeks leave nothing on the screen.
    expect(shownIssues(Array.from({ length: 60 }, (_, index) => issue({ number: index, state: 'closed', closedAt: new Date(2026, 10, 1).toISOString() })), now)).toEqual([])
  })
})
