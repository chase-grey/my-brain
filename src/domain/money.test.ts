import { describe, expect, it } from 'vitest'
import { buildLifeRing } from './lifeRing'
import { addMoneyReading, latestFigures, money, moneyBriefing, moneyReading, moneyStanding, newMoneyGoal, numbersAge, parseMoneyRead, savingRate, standingText, type MoneyGoal, type MoneySnapshot } from './money'

const reading = (on: string, figures: Partial<MoneySnapshot>): MoneySnapshot => ({ month: on.slice(0, 7), on, ...figures })
const reach: MoneyGoal = { id: 'a', title: 'a million', kind: 'reach', figure: 'netWorth', amount: 1_000_000, by: '2030-01-01', startOn: '2026-01-01', startValue: 200_000 }
const payoff: MoneyGoal = { id: 'b', title: 'house paid off', kind: 'payoff', figure: 'homeRemaining', by: '2036-01-01', startOn: '2026-01-01', startValue: 300_000 }
const cover: MoneyGoal = { id: 'c', title: 'six months saved', kind: 'cover', figure: 'savings', months: 6, startOn: '2026-01-01' }

describe('money goals', () => {
  it('calls a reach goal on pace when the figure is on or ahead of the straight line to its date', () => {
    // Halfway through the four years the line sits at 600k.
    const ahead = moneyStanding(reach, [reading('2027-12-20', { netWorth: 640_000 })], '2028-01-01')
    expect(ahead).toMatchObject({ state: 'on pace', score: 1, current: 640_000 })
    expect(Math.round(ahead.expected! / 10_000)).toBe(60)
    expect(ahead.progress).toBeCloseTo(0.55)
  })

  it('scores a goal that is behind by the share of the expected ground it covered', () => {
    const behind = moneyStanding(reach, [reading('2027-12-20', { netWorth: 400_000 })], '2028-01-01')
    expect(behind.state).toBe('behind')
    expect(behind.score).toBeCloseTo(0.5)
  })

  it('reads a loan downward: under the line is on pace, and nothing owed is met', () => {
    expect(moneyStanding(payoff, [reading('2030-12-01', { homeRemaining: 140_000 })], '2031-01-01').state).toBe('on pace')
    expect(moneyStanding(payoff, [reading('2030-12-01', { homeRemaining: 220_000 })], '2031-01-01').state).toBe('behind')
    expect(moneyStanding(payoff, [reading('2030-12-01', { homeRemaining: 0 })], '2031-01-01')).toMatchObject({ state: 'met', score: 1 })
  })

  it('holds savings to months of spending, with no date', () => {
    expect(moneyStanding(cover, [reading('2026-11-01', { savings: 15_000, spendingMonthly: 5000 })], '2026-11-25')).toMatchObject({ state: 'short', score: 0.5, monthsCovered: 3 })
    expect(moneyStanding(cover, [reading('2026-11-01', { savings: 40_000, spendingMonthly: 5000 })], '2026-11-25')).toMatchObject({ state: 'met', score: 1 })
    expect(standingText(moneyStanding(cover, [reading('2026-11-01', { savings: 15_000 })], '2026-11-25'))).toBe('needs monthly spending')
  })

  it('lets stale numbers fall behind, because today is the yardstick', () => {
    const snapshots = [reading('2026-07-01', { netWorth: 300_000 })]
    expect(moneyStanding(reach, snapshots, '2026-07-01').state).toBe('on pace')
    expect(moneyStanding(reach, snapshots, '2027-07-01').state).toBe('behind')
  })

  it('says so when a goal has no numbers yet', () => {
    expect(moneyStanding(reach, [], '2026-11-25')).toMatchObject({ state: 'no numbers', score: 0 })
    expect(standingText(moneyStanding(reach, [], '2026-11-25'))).toBe('no numbers yet')
  })

  it('starts a goal from the latest reading, or from the first one after it was set', () => {
    const snapshots = [reading('2026-11-01', { netWorth: 250_000 })]
    expect(newMoneyGoal({ id: 'x', title: 't', kind: 'reach', figure: 'netWorth', amount: 500_000 }, snapshots, '2026-11-25')).toMatchObject({ startOn: '2026-11-25', startValue: 250_000 })
    const blank = newMoneyGoal({ id: 'y', title: 't', kind: 'reach', figure: 'investments', amount: 500_000, by: '2030-11-25' }, snapshots, '2026-11-25')
    expect(blank.startValue).toBeUndefined()
    expect(moneyStanding(blank, [reading('2026-12-01', { investments: 100_000 }), reading('2027-11-25', { investments: 150_000 })], '2027-11-25').progress).toBeCloseTo(0.125)
  })

  it('fills the slice with the average of the goals, and is absent with none', () => {
    const snapshots = [reading('2027-12-20', { netWorth: 640_000, savings: 15_000, spendingMonthly: 5000 })]
    expect(moneyReading([reach, cover], snapshots, '2028-01-01')).toMatchObject({ fill: 0.75, asOf: '2027-12-20', monthsTracked: 1 })
    expect(moneyReading([], snapshots, '2028-01-01')).toBeUndefined()
  })

  it('takes over the money slice from the 28-day target once a goal is set', () => {
    const snapshots = [reading('2027-12-20', { netWorth: 640_000 })]
    const money = moneyReading([reach], snapshots, '2028-01-01')
    expect(buildLifeRing([], [], '2028-01-01', [], undefined, { money }).find((arc) => arc.domain === 'money')).toMatchObject({ fill: 1, state: 'establishing' })
    expect(buildLifeRing([], [], '2028-01-01').find((arc) => arc.domain === 'money')).toMatchObject({ state: 'dormant' })
  })
})

describe('money numbers', () => {
  it('keeps one reading a day and only the figures it was given', () => {
    const first = addMoneyReading([], '2026-11-25', { netWorth: 300_000 }, [{ name: 'checking', balance: 4000 }])
    const second = addMoneyReading(first, '2026-11-25', { homeRemaining: 250_000 }, [{ name: 'checking', balance: 4200 }, { name: 'brokerage', balance: 90_000 }])
    expect(second).toEqual([{ month: '2026-11', on: '2026-11-25', netWorth: 300_000, homeRemaining: 250_000, accounts: [{ name: 'checking', balance: 4200 }, { name: 'brokerage', balance: 90_000 }] }])
    expect(addMoneyReading(second, '2026-11-25', {})).toBe(second)
  })

  it('reads each figure from the newest reading that has it', () => {
    const snapshots = [reading('2026-10-01', { netWorth: 290_000, savings: 20_000 }), reading('2026-11-25', { netWorth: 300_000 })]
    expect(latestFigures(snapshots)).toEqual({ netWorth: { on: '2026-11-25', value: 300_000 }, savings: { on: '2026-10-01', value: 20_000 } })
  })

  it('treats a zero in a month saved by the old form as left blank', () => {
    const old: MoneySnapshot = { month: '2026-10', netWorth: 290_000, homeRemaining: 0, carRemaining: 0, incomeMonthly: 0, spendingMonthly: 0 }
    expect(latestFigures([old])).toEqual({ netWorth: { on: '2026-10-01', value: 290_000 } })
  })

  it('takes the numbers out of a model answer and drops anything that is not one', () => {
    const answer = 'here you go:\n{"figures": {"netWorth": 312450.12, "homeRemaining": -241000, "savings": "lots", "bogus": 5}, "accounts": [{"name": " Checking ", "balance": 4200}, {"name": "", "balance": 1}, {"balance": 2}]}'
    expect(parseMoneyRead(answer)).toEqual({ figures: { netWorth: 312450.12, homeRemaining: 241000 }, accounts: [{ name: 'Checking', balance: 4200 }] })
    expect(parseMoneyRead('i could not read that')).toBeUndefined()
  })

  it('writes amounts short enough for a row', () => {
    expect([money(950), money(4200), money(48_300), money(312_450), money(1_000_000), money(1_250_000), money(-5200)]).toEqual(['$950', '$4.2k', '$48k', '$312k', '$1m', '$1.3m', '-$5.2k'])
  })

  it('briefs the chat on the figures, the accounts and where each goal stands', () => {
    const lines = moneyBriefing([{ ...reach, startOn: '2027-12-01', by: '2030-01-01' }], [reading('2027-12-20', { netWorth: 400_000, accounts: [{ name: 'checking', balance: 4200 }] })], '2028-12-16')
    expect(lines).toEqual([
      '- net worth: $400,000 (as of 2027-12-20)',
      '- account checking: $4,200 (as of 2027-12-20)',
      '- goal "a million" (net worth of $1,000,000 by 2030-01-01): $400k of $1m · behind; should be at $600,000 today',
    ])
    expect(moneyBriefing([], [], '2028-01-01')).toEqual([])
  })
})

describe('saving rate and old numbers', () => {
  it('reads the saving rate off the newest income and spending, and says nothing with one missing', () => {
    expect(savingRate([reading('2026-10-01', { incomeMonthly: 8000 }), reading('2026-11-01', { spendingMonthly: 6000 })])).toEqual({ rate: 0.25, kept: 2000, on: '2026-11-01' })
    expect(savingRate([reading('2026-11-01', { spendingMonthly: 6000 })])).toBeUndefined()
    expect(moneyBriefing([], [reading('2026-11-01', { incomeMonthly: 8000, spendingMonthly: 6000 })], '2026-11-25').join('\n')).toContain('saving rate: 25% of income')
  })

  it('calls the numbers old once the newest are more than a month back', () => {
    expect(numbersAge([reading('2026-11-01', { netWorth: 1 })], '2026-11-25')).toBeUndefined()
    expect(numbersAge([reading('2026-10-01', { netWorth: 1 })], '2026-11-25')).toBe(55)
    expect(numbersAge([], '2026-11-25')).toBeUndefined()
  })
})
