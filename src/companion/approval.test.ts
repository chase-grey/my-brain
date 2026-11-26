import { describe, expect, it, vi } from 'vitest'
import { describeAction } from './actions'
import { BridgeCompanionClient } from './bridgeCompanion'
import { createAnthropicCompanion, createBridgeCompanion } from './companion'
import type { AnthropicClient, MessagesResponse } from './anthropicClient'
import { buildSystemPrompt } from './companionPrompt'
import { companionTools, executeTool } from './companionTools'
import { fakeActions } from './companionTools.test'
import { takeProposals } from './proposals'

const reply = (content: MessagesResponse['content'], stop_reason = 'end_turn'): MessagesResponse => ({ id: 'm', content, stop_reason })
const later = () => {
  const day = new Date()
  day.setDate(day.getDate() + 10)
  return `${day.toLocaleDateString('en-CA')}T13:00`
}
const summary = { today: '2026-11-25', openCount: 0, dueToday: [], overdue: [], thisWeek: [], suggested: [], goals: [], projects: [] }

// The chat's card rule: a change to a project's steps, to what is on today for a project, or to a calendar
// waits on a card. These are the inputs the model would send for each.
const gated: Record<string, Record<string, unknown>> = {
  hold_in_calendar: { id: 'g1' },
  block_time: { title: 'frame the porch', start: later(), minutes: 180, project_id: 'p1' },
  set_project_steps: { project_id: 'p1', steps: [{ title: 'pick tile', minutes: 60 }, { title: 'pour footings' }] },
  plan_project_session: { project_id: 'p1', step_ids: ['s1'] },
}

describe('what the chat may write only with approval', () => {
  it('offers the step and calendar tools', () => {
    const names = companionTools({ hasVault: false, hasCalendar: true }).map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining(['list_project_steps', ...Object.keys(gated)]))
    expect(companionTools({ hasVault: false }).map((tool) => tool.name)).not.toContain('block_time')
  })

  it.each(Object.entries(gated))('%s waits on a card that says what it will do', async (name, input) => {
    const description = await describeAction(name, input, { actions: fakeActions() })
    expect(description?.weight).toBe('heavy')
    expect(description?.fields?.length).toBeGreaterThan(0)
  })

  it('reads a project\'s steps without a card', async () => {
    expect(await describeAction('list_project_steps', { project_id: 'p1' }, { actions: fakeActions() })).toBeUndefined()
  })

  it('shows every step and when a block is, in plain words', async () => {
    const steps = await describeAction('set_project_steps', gated.set_project_steps, { actions: fakeActions() })
    expect(steps).toMatchObject({ title: 'set the steps of "home build"', fields: [{ label: '1', value: 'pick tile · 1h' }, { label: '2', value: 'pour footings' }] })
    const session = await describeAction('plan_project_session', gated.plan_project_session, { actions: fakeActions() })
    expect(session).toMatchObject({ title: 'work on "home build" today', fields: [{ label: '1', value: 'pick tile · 1h' }, { label: 'in all', value: '1h' }] })
    const block = await describeAction('block_time', gated.block_time, { actions: fakeActions(), domain: 'work' })
    expect(block?.fields).toEqual(expect.arrayContaining([{ label: 'how long', value: '3h' }, { label: 'project', value: 'home build' }, { label: 'calendar', value: 'work' }]))
    expect(block?.fields?.[0].value).toMatch(/1pm–4pm$/)
  })

  it('writes nothing until the card is approved, and nothing at all when it is dismissed', async () => {
    const actions = fakeActions()
    const client = { createMessage: vi.fn() } as unknown as AnthropicClient
    vi.mocked(client.createMessage)
      .mockResolvedValueOnce(reply([{ type: 'tool_use', id: 'b1', name: 'block_time', input: gated.block_time }, { type: 'tool_use', id: 's1', name: 'set_project_steps', input: gated.set_project_steps }], 'tool_use'))
      .mockResolvedValueOnce(reply([{ type: 'text', text: 'blocked' }]))
    const companion = createAnthropicCompanion({ client, model: 'claude-sonnet-5-5', history: () => [], systemPrompt: () => 'sys', actions: () => actions, hasCalendar: () => true })
    const first = await companion.send('block saturday afternoon for the porch')
    expect(first.actions.map((action) => [action.tool, action.status])).toEqual([['block_time', 'pending'], ['set_project_steps', 'pending']])
    expect(actions.blockTime).not.toHaveBeenCalled()
    expect(actions.setProjectSteps).not.toHaveBeenCalled()
    const dismissed = await first.pending!.decide('s1', false)
    expect(dismissed.action.status).toBe('dismissed')
    const approved = await first.pending!.decide('b1', true)
    expect(approved.action.status).toBe('done')
    expect(approved.undo).toBeDefined()
    expect(actions.blockTime).toHaveBeenCalledWith(expect.objectContaining({ title: 'frame the porch', minutes: 180, projectId: 'p1' }))
    expect(actions.setProjectSteps).not.toHaveBeenCalled()
    await approved.undo!()
    expect(actions.unblockTime).toHaveBeenCalledWith('b1')
  })

  it('refuses a block the form would refuse, and one with no calendar to write to', async () => {
    const actions = fakeActions()
    expect(await executeTool('block_time', { title: 'x', start: '2020-01-01T10:00', minutes: 60 }, { actions })).toEqual({ ok: false, error: 'that time has already passed' })
    expect(await executeTool('block_time', { title: 'x', start: 'saturday', minutes: 60 }, { actions })).toEqual({ ok: false, error: 'start must be YYYY-MM-DDTHH:MM' })
    expect(await executeTool('block_time', gated.block_time, { actions: { ...actions, blockTime: undefined } })).toEqual({ ok: false, error: 'the calendar is not connected' })
    expect(actions.blockTime).not.toHaveBeenCalled()
  })

  it('changes steps and puts them on today through the app, each with a way back', async () => {
    const actions = fakeActions()
    const set = await executeTool('set_project_steps', gated.set_project_steps, { actions })
    expect(set.ok && set.undo).toBeTruthy()
    expect(actions.setProjectSteps).toHaveBeenCalledWith('p1', [{ title: 'pick tile', estimateMin: 60 }, { title: 'pour footings' }])
    const planned = await executeTool('plan_project_session', gated.plan_project_session, { actions })
    expect(planned.ok && planned.undo).toBeTruthy()
    expect(await executeTool('plan_project_session', { project_id: 'p1', step_ids: ['nope'] }, { actions })).toEqual({ ok: false, error: 'none of those steps are open on that project' })
    expect(await executeTool('set_project_steps', { project_id: 'other', steps: [] }, { actions })).toEqual({ ok: false, error: 'no project with that id' })
  })
})

describe('the work chat asking for a block', () => {
  const line = `<block-time title="design review prep" start="${later()}" minutes="90" />`

  it('takes the request out of the reply and drops one that names no time', () => {
    const taken = takeProposals(`i can hold that time.\n\n${line}\n<block-time title="no time" minutes="30" />`)
    expect(taken.text).toBe('i can hold that time.')
    expect(taken.proposals).toEqual([{ tool: 'block_time', input: { title: 'design review prep', start: later(), minutes: 90 } }])
    expect(takeProposals('nothing to block')).toEqual({ text: 'nothing to block', proposals: [] })
  })

  it('shows it as a card, writes only on approval, and tells claude code what became of it with the next message', async () => {
    const actions = fakeActions()
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: `holding it.\n${line}`, sessionId: 'abc', isError: false })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'ok', sessionId: 'abc', isError: false })))
    const companion = createBridgeCompanion({ client: new BridgeCompanionClient(undefined, fetcher), sessionId: () => 'abc', systemPrompt: () => 'sys', actions: () => actions })
    const first = await companion.send('block 90 minutes for design review prep')
    expect(first.text).toBe('holding it.')
    expect(first.actions).toMatchObject([{ tool: 'block_time', weight: 'heavy', status: 'pending', title: 'block time for "design review prep"' }])
    expect(first.actions[0].fields).toEqual(expect.arrayContaining([{ label: 'calendar', value: 'work' }]))
    expect(actions.blockTime).not.toHaveBeenCalled()
    const decision = await first.pending!.decide(first.actions[0].id, true)
    expect(decision.action.status).toBe('done')
    expect(decision.reply).toBeUndefined()
    expect(actions.blockTime).toHaveBeenCalledWith(expect.objectContaining({ title: 'design review prep', minutes: 90 }))
    await expect(first.pending!.decide(first.actions[0].id, true)).rejects.toThrow('already decided')
    await companion.send('thanks')
    expect(JSON.parse((fetcher.mock.calls[1][1] as RequestInit).body as string).text).toBe('[blocked time for "design review prep"]\n\nthanks')
  })

  it('leaves the reply as words when the app has given it no way to act', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ text: `holding it.\n${line}`, sessionId: 'abc', isError: false })))
    const first = await createBridgeCompanion({ client: new BridgeCompanionClient(undefined, fetcher), sessionId: () => 'abc', systemPrompt: () => 'sys' }).send('hi')
    expect(first.actions).toEqual([])
    expect(first.pending).toBeUndefined()
  })

  it('is told how to ask only when the work calendar can be written, and personal is told about steps', () => {
    expect(buildSystemPrompt({ domain: 'work', vaultAvailable: true, summary, canBlockTime: true })).toContain('<block-time')
    expect(buildSystemPrompt({ domain: 'work', vaultAvailable: true, summary })).not.toContain('<block-time')
    const personal = buildSystemPrompt({ domain: 'personal', vaultAvailable: true, summary, canBlockTime: true })
    expect(personal).toContain('plan_project_session')
    expect(personal).toContain('block_time')
    expect(personal).toContain('anything written to the calendar wait on a card')
    expect(buildSystemPrompt({ domain: 'personal', vaultAvailable: true, summary })).not.toContain('block_time')
  })
})
