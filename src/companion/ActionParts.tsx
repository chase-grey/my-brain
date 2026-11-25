import { createContext, useContext, useState } from 'react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import { Icon } from '../navIcons'
import type { CompanionAction } from './actions'
import { smsLink } from './textDraft'

// What the chat can do about an action after the fact. Undo closures live for the session only,
// so a receipt offers undo only while one is still held for it.
export type ActionHandlers = { canUndo(id: string): boolean; undo(id: string): Promise<void> }
export const ActionHandlersContext = createContext<ActionHandlers>({ canUndo: () => false, undo: async () => {} })

function Fields({ fields }: { fields?: CompanionAction['fields'] }) {
  if (!fields?.length) return null
  return <dl className="action-fields">
    {fields.map((field) => <div className="action-field" key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
  </dl>
}

// A heavy action waiting on the user: title, what it touches, approve and dismiss. Approve is the one filled button.
function ApprovalCard({ action, respond, busy }: { action: CompanionAction; respond: (approved: boolean) => void; busy: boolean }) {
  return <div className="action-card" role="group" aria-label={action.title}>
    <div className="action-card-title">{action.title}</div>
    <Fields fields={action.fields} />
    <div className="action-card-foot">
      <button className="primary small" type="button" disabled={busy} onClick={() => respond(true)}>approve</button>
      <button className="secondary small" type="button" disabled={busy} onClick={() => respond(false)}>dismiss</button>
    </div>
  </div>
}

// One quiet line for anything that already happened: a mark, what happened, and the way back at the right.
function Receipt({ action }: { action: CompanionAction }) {
  const handlers = useContext(ActionHandlersContext)
  const [undoing, setUndoing] = useState(false)
  const tone = action.status === 'done' ? 'ok' : action.status === 'failed' ? 'failed' : 'muted'
  const text = action.status === 'done' ? action.done
    : action.status === 'undone' ? `undone · ${action.done}`
    : action.status === 'dismissed' ? `dismissed · ${action.title}`
    : action.status === 'expired' ? `not done · ${action.title}`
    : action.status === 'failed' ? `couldn't ${action.title}`
    : action.title
  const canUndo = action.status === 'done' && handlers.canUndo(action.id)
  async function undo() {
    setUndoing(true)
    try {
      await handlers.undo(action.id)
    } finally {
      setUndoing(false)
    }
  }
  return <div className={`action-receipt is-${tone}`}>
    <span className="action-receipt-mark" aria-hidden="true">{tone === 'ok' ? <Icon name="check" size={16} /> : tone === 'failed' ? '!' : '–'}</span>
    <span className="action-receipt-text">{text}{action.status === 'failed' && action.error ? <small> · {action.error}</small> : null}</span>
    {canUndo && <button className="link" type="button" disabled={undoing} onClick={() => void undo()}>undo</button>}
  </div>
}

// A drafted text: the words, and the way into the messaging app with them filled in. Sending happens there.
function TextDraft({ action }: { action: CompanionAction }) {
  const field = (label: string) => action.fields?.find((item) => item.label === label)?.value ?? ''
  const body = field('text')
  return <div className="action-card text-draft" role="group" aria-label={action.done}>
    <div className="action-card-title">{action.done}</div>
    <p className="text-draft-body">{body}</p>
    <div className="action-card-foot"><a className="primary small" href={smsLink(body, field('to'))}>open in messages</a></div>
  </div>
}

/** Renders one tool-call part of an assistant message. The action record rides in the part's artifact. */
export function ActionPart(props: ToolCallMessagePartProps) {
  const action = props.artifact as CompanionAction | undefined
  const [busy, setBusy] = useState(false)
  if (!action) return null
  if (action.status === 'pending' || action.status === 'running') {
    const respond = (approved: boolean) => {
      setBusy(true)
      void props.respondToApproval({ approved }).catch(() => setBusy(false))
    }
    return <ApprovalCard action={action} respond={respond} busy={busy || action.status === 'running'} />
  }
  if (action.tool === 'draft_text' && action.status === 'done') return <TextDraft action={action} />
  return <Receipt action={action} />
}
