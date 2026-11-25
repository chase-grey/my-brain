import { useEffect, useState } from 'react'
import { issueAppNames, issueProgress, shownIssues, type IssueStore, type TrackedIssue } from '../issues/issues'
import { useIssues } from '../issues/useIssues'
import type { AppSettings } from '../settings'
import { Card, Field } from '../ui'

/** The issues chat has filed about the apps and where the fixer is with each. A question from the fixer is answered here. */
export function IssuesCard({ settings, onSettings }: { settings: AppSettings; onSettings: React.Dispatch<React.SetStateAction<AppSettings>> }) {
  const { store, issues, error, reload } = useIssues(settings.issueToken)
  const shown = shownIssues(issues ?? [])

  return <Card title="issues">
    <Field label="issue token"><input type="password" autoComplete="off" value={settings.issueToken} onChange={(event) => onSettings((current) => ({ ...current, issueToken: event.target.value }))} /></Field>
    {error && <p className="note is-error" role="alert">{error}</p>}
    {store && shown.length > 0 && <div className="rows">
      {shown.map((issue) => <IssueRow key={`${issue.app}#${issue.number}`} issue={issue} store={store} onChanged={reload} />)}
    </div>}
  </Card>
}

function IssueRow({ issue, store, onChanged }: { issue: TrackedIssue; store: IssueStore; onChanged: () => Promise<void> }) {
  const progress = issueProgress(issue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // Working, review and completed move on their own; the rest stay until the fixer gets to them, so they can be let go by hand.
  const canClose = progress === 'open' || progress === 'stalled' || progress === 'asks'

  async function run(change: () => Promise<void>) {
    setBusy(true)
    setError(undefined)
    try {
      await change()
      await onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'that did not work')
    } finally {
      setBusy(false)
    }
  }

  return <>
    <div className="row">
      <a className="row-main" href={issue.url} target="_blank" rel="noreferrer">
        <span className="row-title">{issue.title}</span>
        <span className="row-meta">{issueAppNames[issue.app]} #{issue.number} · {progress}</span>
      </a>
      {canClose && <button className="link" type="button" disabled={busy} onClick={() => void run(() => store.close(issue))}>close</button>}
    </div>
    {progress === 'asks' && <IssueQuestion issue={issue} store={store} busy={busy} onAnswer={(text) => run(() => store.answer(issue, text))} />}
    {error && <p className="note is-error" role="alert">{error}</p>}
  </>
}

function IssueQuestion({ issue, store, busy, onAnswer }: { issue: TrackedIssue; store: IssueStore; busy: boolean; onAnswer: (text: string) => Promise<void> }) {
  const [question, setQuestion] = useState<string>()
  const [answer, setAnswer] = useState('')

  useEffect(() => {
    let stopped = false
    store.question(issue).then((text) => { if (!stopped) setQuestion(text) }).catch(() => { if (!stopped) setQuestion('') })
    return () => { stopped = true }
  }, [store, issue.app, issue.number])

  return <form className="stack" onSubmit={(event) => { event.preventDefault(); void onAnswer(answer) }}>
    {question && <p className="issue-question">{question}</p>}
    <Field label="answer"><textarea value={answer} onChange={(event) => setAnswer(event.target.value)} /></Field>
    <div className="actions"><button className="primary" disabled={busy || !answer.trim()} type="submit">send</button></div>
  </form>
}
