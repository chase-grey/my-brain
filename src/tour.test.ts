import { describe, expect, it } from 'vitest'
import { advance, appOffers, cardPlace, currentStep, litBox, noGuide, parseGuide, restart, skip, stepPosition, stepsFor, tourSteps, type Guide } from './tour'

const fresh = (uses: Guide['uses'] = []): Guide => ({ uses, seen: [], done: false })
const ids = (guide: Guide, aiOn = true) => stepsFor(guide, aiOn).map((step) => step.id)

describe('what the welcome picks lead to', () => {
  it('offers my mail for email and workout tracker for workouts, and nothing otherwise', () => {
    const same = (url: string) => url
    expect(appOffers([], same)).toEqual([])
    expect(appOffers(['tasks', 'goals', 'notes', 'trips'], same)).toEqual([])
    expect(appOffers(['email'], same).map((offer) => offer.name)).toEqual(['my mail'])
    expect(appOffers(['workouts', 'email'], same).map((offer) => offer.name)).toEqual(['my mail', 'workout tracker'])
  })

  it('links to the copy served beside this one', () => {
    expect(appOffers(['email'], (url) => url.replace('https://chase-grey.github.io', 'http://localhost:5270'))[0].url).toBe('http://localhost:5270/my-mail/')
  })

  it('shows someone who picked nothing every step', () => {
    expect(ids(fresh())).toEqual(tourSteps.map((step) => step.id))
  })

  it('leaves out the steps for what was not picked', () => {
    expect(ids(fresh(['tasks']))).toEqual(['today', 'new', 'progress', 'chat', 'settings'])
    expect(ids(fresh(['notes', 'trips']))).toEqual(['today', 'progress', 'chat', 'notes', 'trips', 'settings'])
    // The other apps have no screen here to be shown.
    expect(ids(fresh(['email', 'workouts']))).toEqual(['today', 'progress', 'chat', 'settings'])
  })

  it('shows the chat only with ai on', () => {
    expect(ids(fresh(), false)).not.toContain('chat')
  })
})

describe('the tour', () => {
  it('reads as the rest of the app does: lowercase, and never how to press something', () => {
    for (const step of tourSteps) {
      expect(step.title).toBe(step.title.toLowerCase())
      expect(step.body).toBe(step.body.toLowerCase())
      expect(step.body).not.toMatch(/\b(tap|click|press|swipe)\b/)
    }
  })

  it('shows each step once, in order, and ends after the last', () => {
    const steps = stepsFor(fresh(['tasks']), false)
    let guide = fresh(['tasks'])
    const shown: string[] = []
    for (let step = currentStep(steps, guide); step; step = currentStep(steps, guide)) {
      shown.push(step.id)
      guide = advance(steps, guide, step.id)
    }
    expect(shown).toEqual(['today', 'new', 'progress', 'settings'])
    expect(guide.done).toBe(true)
  })

  it('counts where a step falls', () => {
    const steps = stepsFor(fresh(['tasks']), false)
    expect(stepPosition(steps, steps[1])).toEqual({ index: 2, total: 4 })
  })

  it('stays over once skipped, and keeps the picks when started again', () => {
    const skipped = skip({ uses: ['notes'], seen: ['today'], done: false })
    expect(currentStep(stepsFor(skipped, true), skipped)).toBeUndefined()
    expect(restart(skipped)).toEqual({ uses: ['notes'], seen: [], done: false })
  })

  it('reaches someone mid-tour with a step added later', () => {
    const guide: Guide = { uses: [], seen: ['today', 'progress'], done: false }
    expect(currentStep(stepsFor(guide, true), guide)?.id).toBe('new')
  })

  it('is not shown on a device that never went through the welcome', () => {
    expect(parseGuide(null)).toEqual(noGuide)
    expect(currentStep(stepsFor(noGuide, true), noGuide)).toBeUndefined()
    expect(parseGuide('not json')).toEqual(noGuide)
    expect(parseGuide('{"uses":["notes","spying"],"seen":["today",4],"done":false}')).toEqual({ uses: ['notes'], seen: ['today'], done: false })
  })
})

describe('where the tour draws', () => {
  const phone = { width: 390, height: 844, top: 0 }
  const card = { width: 352, height: 180 }

  it('lights only what is on screen', () => {
    expect(litBox({ top: 800, left: 10, width: 80, height: 60 }, phone, 6)).toEqual({ top: 794, left: 4, width: 92, height: 50 })
    expect(litBox({ top: 900, left: 10, width: 80, height: 60 }, phone, 6)).toBeUndefined()
    expect(litBox({ top: 0, left: 0, width: 0, height: 0 }, phone, 6)).toBeUndefined()
  })

  it('puts the card under what is lit, over it when there is no room under, and across it when there is neither', () => {
    expect(cardPlace({ top: 10, left: 340, width: 44, height: 44 }, card, phone, 12).top).toBe(66)
    expect(cardPlace({ top: 780, left: 10, width: 90, height: 56 }, card, phone, 12).top).toBe(780 - 12 - 180)
    expect(cardPlace({ top: 20, left: 0, width: 390, height: 800 }, card, phone, 12).top).toBe(844 - 180 - 12)
  })

  it('keeps the card inside the window and beside what is lit', () => {
    expect(cardPlace({ top: 780, left: 10, width: 90, height: 56 }, card, phone, 12).left).toBe(12)
    expect(cardPlace({ top: 780, left: 300, width: 90, height: 56 }, card, phone, 12).left).toBe(390 - 352 - 12)
  })

  it('sits beside what is lit on a monitor, so the rail under it stays in view', () => {
    const desk = { width: 3438, height: 1300, top: 0 }
    expect(cardPlace({ top: 200, left: 10, width: 60, height: 48 }, card, desk, 12)).toEqual({ top: 200, left: 82 })
    // A docked chat fills the right edge: nothing fits beside it, and the card goes across its foot.
    expect(cardPlace({ top: 0, left: 2938, width: 500, height: 1300 }, card, desk, 12)).toEqual({ top: 1300 - 180 - 12, left: 3012 })
  })

  it('sits in the middle with nothing to light, and never under the status bar', () => {
    expect(cardPlace(undefined, card, phone, 12)).toEqual({ top: 332, left: 19 })
    expect(cardPlace({ top: 30, left: 0, width: 390, height: 810 }, { width: 352, height: 820 }, { ...phone, top: 40 }, 12).top).toBe(52)
  })
})
