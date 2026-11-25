import { describe, expect, it, vi } from 'vitest'
import { describeAction } from './actions'
import { buildSystemPrompt } from './companionPrompt'
import { companionTools, executeTool, type CompanionActions, type PlanSummary } from './companionTools'
import { smsLink } from './textDraft'

const actions = { recordMoney: vi.fn(() => ({ saved: ['netWorth'], undo: vi.fn() })) } as unknown as CompanionActions
const summary: PlanSummary = { today: '2026-11-25', openCount: 0, dueToday: [], overdue: [], thisWeek: [], suggested: [], availableMin: 0, goals: [], projects: [] }

describe('text drafts', () => {
  it('hands the draft to the messaging app and never sends it', async () => {
    expect(companionTools({ hasVault: false }).map((tool) => tool.name)).toContain('draft_text')
    const outcome = await executeTool('draft_text', { body: 'running late, be there by 7', to: 'sam' }, { actions })
    expect(outcome).toMatchObject({ ok: true })
    expect(outcome.ok && outcome.content).toContain('has not been sent')
    expect(await describeAction('draft_text', { body: 'running late, be there by 7', to: 'sam' }, { actions })).toEqual({
      weight: 'light', title: 'draft a text', done: 'text for sam', fields: [{ label: 'to', value: 'sam' }, { label: 'text', value: 'running late, be there by 7' }],
    })
  })

  it('puts the words in an sms link, with the number only when one was given', () => {
    expect(smsLink('be there by 7 & bringing food', 'sam')).toBe('sms:?body=be%20there%20by%207%20%26%20bringing%20food')
    expect(smsLink('hi', '(555) 010-0199')).toBe('sms:5550100199?body=hi')
    expect(smsLink('hi')).toBe('sms:?body=hi')
  })

  it('tells the model to draft only when asked, in the user\'s own voice, in the personal space only', () => {
    const personal = buildSystemPrompt({ domain: 'personal', summary, vaultAvailable: false })
    expect(personal).toContain('draft one only when the user asks for it')
    expect(personal).toContain('the way this user writes')
    expect(personal).toContain('never say it was sent')
    expect(buildSystemPrompt({ domain: 'work', summary, vaultAvailable: false })).not.toContain('draft_text')
  })
})

describe('money in chat', () => {
  it('saves the numbers a screenshot showed and hands back the way to take them out', async () => {
    const outcome = await executeTool('record_money', { netWorth: 312000, homeRemaining: -241000, accounts: [{ name: 'checking', balance: 4200 }, { name: 5 }] }, { actions })
    expect(outcome).toMatchObject({ ok: true })
    expect(actions.recordMoney).toHaveBeenCalledWith({ netWorth: 312000, homeRemaining: 241000 }, [{ name: 'checking', balance: 4200 }])
    expect(outcome.ok && outcome.undo).toBeTypeOf('function')
    expect(await executeTool('record_money', {}, { actions })).toEqual({ ok: false, error: 'no numbers to save' })
  })

  it('puts the money lines in the personal prompt', () => {
    const prompt = buildSystemPrompt({ domain: 'personal', summary: { ...summary, money: ['- net worth: $400,000 (as of 2026-11-20)'] }, vaultAvailable: false })
    expect(prompt).toContain('- net worth: $400,000 (as of 2026-11-20)')
    expect(buildSystemPrompt({ domain: 'work', summary: { ...summary, money: ['- net worth: $400,000'] }, vaultAvailable: false })).not.toContain('net worth')
  })
})
