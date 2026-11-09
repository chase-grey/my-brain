import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react'
import { AssistantMessage, HistoryList, UserMessage, toMessage } from './ChatView'
import type { CompanionTurn } from './companionStore'

function Thread({ turns }: { turns: CompanionTurn[] }) {
  const runtime = useExternalStoreRuntime({ messages: turns, convertMessage: toMessage, isRunning: false, onNew: async () => {}, onRespondToToolApproval: () => {} })
  return <AssistantRuntimeProvider runtime={runtime}>
    <ThreadPrimitive.Root><ThreadPrimitive.Viewport><ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} /></ThreadPrimitive.Viewport></ThreadPrimitive.Root>
  </AssistantRuntimeProvider>
}

const base = { id: 'a1', tool: 'delete_task', weight: 'heavy' as const, title: 'delete task "call plumber"', done: 'deleted task "call plumber"', fields: [{ label: 'task', value: 'call plumber' }] }

it('renders a waiting heavy action as a card with approve and dismiss', () => {
  const html = renderToStaticMarkup(<Thread turns={[{ role: 'assistant', text: 'removing it', at: '2026-11-04T10:00:00.000Z', actions: [{ ...base, status: 'pending' }] }]} />)
  expect(html).toContain('removing it')
  expect(html).toContain('class="action-card"')
  expect(html).toContain('delete task &quot;call plumber&quot;')
  expect(html).toContain('<dt>task</dt><dd>call plumber</dd>')
  expect(html).toContain('>approve</button>')
  expect(html).toContain('>dismiss</button>')
})

it('renders settled actions as receipt lines and skips the empty text part', () => {
  const html = renderToStaticMarkup(<Thread turns={[{ role: 'assistant', text: '', at: '2026-11-04T10:00:00.000Z', actions: [
    { ...base, id: 'a2', status: 'done' },
    { ...base, id: 'a3', weight: 'light', tool: 'create_task', title: 'add task "milk"', done: 'added task "milk"', status: 'undone' },
    { ...base, id: 'a4', status: 'dismissed' },
    { ...base, id: 'a5', status: 'failed', error: 'no task with that id' },
  ] }]} />)
  expect(html).not.toContain('class="md"')
  expect(html).toContain('action-receipt is-ok')
  expect(html).toContain('deleted task &quot;call plumber&quot;')
  expect(html).toContain('undone · added task &quot;milk&quot;')
  expect(html).toContain('dismissed · delete task &quot;call plumber&quot;')
  expect(html).toContain('couldn&#x27;t delete task &quot;call plumber&quot;')
  expect(html).toContain('no task with that id')
  expect(html).not.toContain('>undo</button>')
})

it('lists past conversations by their first message with a delete button each', () => {
  const items = [
    { version: 1 as const, id: 'a', turns: [{ role: 'user' as const, text: '  what is on   today ', at: '2026-11-05T09:00:00.000Z' }, { role: 'assistant' as const, text: 'two meetings', at: '2026-11-05T09:00:05.000Z' }] },
    { version: 1 as const, id: 'b', turns: [{ role: 'user' as const, text: 'plan my week', at: '2026-11-01T09:00:00.000Z' }] },
  ]
  const html = renderToStaticMarkup(<HistoryList items={items} currentId="b" onOpen={() => {}} onDelete={() => {}} onDeleteAll={() => {}} />)
  expect(html).toContain('what is on today')
  expect(html).toContain('2 messages')
  expect(html).toContain('1 message<')
  expect(html).toContain('aria-label="delete plan my week"')
  expect(html).toContain('class="is-current"')
  expect(html).toContain('>delete all</button>')
  expect(renderToStaticMarkup(<HistoryList items={[]} onOpen={() => {}} onDelete={() => {}} onDeleteAll={() => {}} />)).toContain('no past conversations')
})
