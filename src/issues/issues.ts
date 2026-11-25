/**
 * Reports filed from the chat as GitHub issues. The fixer on the work pc (scripts/autofix.mjs in each app's repo)
 * picks up the ones this account filed and answers each with a pull request.
 *
 * The app talks to GitHub itself, with a token of its own kept in settings: issues only, on these repos only. It is
 * not the vault token, which can write files; a token that could write to these repos would deploy whatever it pushed.
 */
export const issueApps = ['my-brain', 'my-mail'] as const
export type IssueApp = typeof issueApps[number]

export const issueRepos: Record<IssueApp, string> = { 'my-brain': 'chase-grey/my-brain', 'my-mail': 'chase-grey/my-mail' }
export const issueAppNames: Record<IssueApp, string> = { 'my-brain': 'my brain', 'my-mail': 'my mail' }

/** The labels scripts/autofix.mjs reads and sets. */
export const appLabel = 'from-app'
export const fixLabel = 'auto-fix'
const workingLabel = 'autofix-running'
const asksLabel = 'needs-input'
const reviewLabel = 'autofix-review'
const stalledLabel = 'autofix-failed'

export const issueTitleLimit = 120
export const issueBodyLimit = 4000

export type TrackedIssue = {
  app: IssueApp
  number: number
  title: string
  url: string
  state: 'open' | 'closed'
  labels: string[]
  /** ISO close time, or '' while open. */
  closedAt: string
}

/** How far along an issue is: asks and review wait on the user, completed is a fix that landed today. */
export type IssueProgress = 'asks' | 'review' | 'working' | 'open' | 'stalled' | 'completed' | 'closed'

const progressOrder: IssueProgress[] = ['asks', 'review', 'working', 'open', 'stalled', 'completed', 'closed']

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function issueProgress(issue: TrackedIssue, now: Date = new Date()): IssueProgress {
  if (issue.state === 'closed') {
    const closed = issue.closedAt ? new Date(issue.closedAt) : undefined
    return closed && !Number.isNaN(closed.getTime()) && sameLocalDay(closed, now) ? 'completed' : 'closed'
  }
  // The fixer swaps labels one call at a time, so an issue caught between two reads as the one that waits on the user.
  if (issue.labels.includes(asksLabel)) return 'asks'
  if (issue.labels.includes(reviewLabel)) return 'review'
  if (issue.labels.includes(workingLabel)) return 'working'
  if (issue.labels.includes(stalledLabel)) return 'stalled'
  return 'open'
}

/** What settings lists: everything still open and what was fixed today, the ones waiting on the user first. Older closed issues are left to GitHub. */
export function shownIssues(issues: TrackedIssue[], now: Date = new Date()): TrackedIssue[] {
  const rank = (issue: TrackedIssue) => progressOrder.indexOf(issueProgress(issue, now))
  return issues.filter((issue) => issueProgress(issue, now) !== 'closed').sort((a, b) => rank(a) - rank(b))
}

/** How many issues cannot move until the user does something: an answer, or a merge. */
export function issuesWaiting(issues: TrackedIssue[], now: Date = new Date()): number {
  return issues.filter((issue) => ['asks', 'review'].includes(issueProgress(issue, now))).length
}

export function isIssueApp(value: unknown): value is IssueApp {
  return issueApps.includes(value as IssueApp)
}

export class IssueError extends Error {}

type GitHubIssue = { number: number; title: string; html_url: string; state: string; closed_at: string | null; labels: ({ name?: string } | string)[]; pull_request?: unknown }
type GitHubComment = { body: string | null }

function describeStatus(status: number, repo: string): string {
  if (status === 401 || status === 403) return 'github rejected the issue token'
  if (status === 404) return `the issue token cannot reach ${repo}`
  return `github returned ${status}`
}

export interface IssueStore {
  file(app: IssueApp, title: string, body: string): Promise<{ number: number; url: string }>
  list(): Promise<TrackedIssue[]>
  question(issue: Pick<TrackedIssue, 'app' | 'number'>): Promise<string>
  answer(issue: Pick<TrackedIssue, 'app' | 'number'>, text: string): Promise<void>
  close(issue: Pick<TrackedIssue, 'app' | 'number'>): Promise<void>
}

export class GitHubIssues implements IssueStore {
  constructor(
    private readonly token: string,
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
    private readonly baseUrl = 'https://api.github.com',
  ) {}

  async file(app: IssueApp, title: string, body: string): Promise<{ number: number; url: string }> {
    const cleanTitle = title.trim().replace(/\s+/g, ' ').slice(0, issueTitleLimit)
    if (!cleanTitle) throw new IssueError('title is required')
    const issue = await this.request<GitHubIssue>(app, 'POST', '/issues', { title: cleanTitle, body: body.trim().slice(0, issueBodyLimit) || '(no description)', labels: [appLabel, fixLabel] })
    // Locked, only this account can comment, and the thread is what the fixer hands its model. A lock that fails
    // is not a failed report: the fixer drops every comment that is not this account's in any case.
    await this.request(app, 'PUT', `/issues/${issue.number}/lock`, { lock_reason: 'off-topic' }).catch(() => undefined)
    return { number: issue.number, url: issue.html_url }
  }

  async list(): Promise<TrackedIssue[]> {
    const perApp = await Promise.all(issueApps.map(async (app) => {
      const issues = await this.request<GitHubIssue[]>(app, 'GET', `/issues?labels=${appLabel}&state=all&per_page=50&sort=created&direction=desc`)
      // The list endpoint mixes pull requests in with issues.
      return issues.filter((issue) => !issue.pull_request).map((issue): TrackedIssue => ({
        app,
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        state: issue.state === 'closed' ? 'closed' : 'open',
        labels: issue.labels.map((label) => typeof label === 'string' ? label : label.name ?? ''),
        closedAt: issue.closed_at ?? '',
      }))
    }))
    return perApp.flat()
  }

  /** What the fixer asked: the newest comment, without the bold line it leads with for anyone reading on GitHub. */
  async question({ app, number }: Pick<TrackedIssue, 'app' | 'number'>): Promise<string> {
    const comments = await this.request<GitHubComment[]>(app, 'GET', `/issues/${number}/comments?per_page=100`)
    return (comments[comments.length - 1]?.body ?? '').replace(/^\s*\*\*.*\*\*\s*\n+/, '').trim()
  }

  /** The answer goes on the thread and the issue goes back to the fixer, which reads the whole thread on its next pass. */
  async answer({ app, number }: Pick<TrackedIssue, 'app' | 'number'>, text: string): Promise<void> {
    const answer = text.trim()
    if (!answer) throw new IssueError('write an answer first')
    await this.request(app, 'POST', `/issues/${number}/comments`, { body: `**Answer from the app:**\n\n${answer.slice(0, issueBodyLimit)}` })
    await this.request(app, 'DELETE', `/issues/${number}/labels/${asksLabel}`).catch(() => undefined)
    await this.request(app, 'POST', `/issues/${number}/labels`, { labels: [fixLabel] })
  }

  async close({ app, number }: Pick<TrackedIssue, 'app' | 'number'>): Promise<void> {
    await this.request(app, 'PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'not_planned' })
  }

  private async request<T>(app: IssueApp, method: string, path: string, body?: unknown): Promise<T> {
    const repo = issueRepos[app]
    const response = await this.fetcher(`${this.baseUrl}/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new IssueError(describeStatus(response.status, repo))
    return (response.status === 204 ? undefined : await response.json()) as T
  }
}
