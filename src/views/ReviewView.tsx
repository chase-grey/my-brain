import { useState } from 'react'
import type { Period } from '../review/period'
import { reviewTitle, type Question, type Review } from '../review/review'
import { Card, Empty } from '../ui'

function QuestionRow({ question, onAnswer }: { question: Question; onAnswer: (answer: string) => Promise<void> }) {
  const [text, setText] = useState(question.answer ?? '')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState<string>()
  const changed = text.trim() !== (question.answer ?? '')

  async function save() {
    setSaving(true)
    setFailed(undefined)
    try {
      await onAnswer(text)
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'could not save')
    } finally {
      setSaving(false)
    }
  }

  return <li className="review-question">
    <p>{question.text}</p>
    <textarea aria-label={`answer: ${question.text}`} rows={3} value={text} onChange={(event) => setText(event.target.value)} />
    {failed && <small className="is-loud">{failed}</small>}
    {changed && <button className="primary small" type="button" disabled={saving} onClick={() => void save()}>save</button>}
  </li>
}

export function ReviewView({ period, review, writing, error, onRetry, onAnswer, onClose }: {
  period: Period
  review: Review
  /** The counted half is on screen and the written half is on its way. */
  writing: boolean
  error?: string
  onRetry: () => void
  onAnswer: (index: number, answer: string) => Promise<void>
  onClose: () => void
}) {
  const unit = period.kind
  return <div className="review" role="dialog" aria-modal="true" aria-label={reviewTitle(period)}>
    <div className="review-body">
      <header className="view-head"><h1>{reviewTitle(period)}</h1></header>

      <ul className="review-stats">
        {review.stats.map((stat) => <li key={stat.label}><strong>{stat.value}</strong><small>{stat.label}</small></li>)}
      </ul>

      {writing && <Empty>writing…</Empty>}
      {error && <Empty>{error} · <button className="link" type="button" onClick={onRetry}>try again</button></Empty>}

      {review.written && <>
        <Card title="earned">
          {review.earned.length
            ? <ul className="review-list is-earned">{review.earned.map((line) => <li key={line}>{line}</li>)}</ul>
            : <Empty>nothing this {unit}</Empty>}
        </Card>
        {review.truths.length > 0 && <Card title="hard truths">
          <ul className="review-list">{review.truths.map((line) => <li key={line}>{line}</li>)}</ul>
        </Card>}
        {review.questions.length > 0 && <Card title="questions">
          <ul className="review-list">{review.questions.map((question, index) => <QuestionRow key={question.text} question={question} onAnswer={(answer) => onAnswer(index, answer)} />)}</ul>
        </Card>}
      </>}

      {review.next.length > 0 && <Card title="next up">
        <ul className="review-list">{review.next.map((line) => <li key={line}>{line}</li>)}</ul>
      </Card>}

      <button className="primary review-done" type="button" onClick={onClose}>done</button>
    </div>
  </div>
}
