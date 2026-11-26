import { useSyncExternalStore } from 'react'
import { besideThisApp } from './site'

/**
 * The first-run tour and what the welcome asks before it (AGENTS.md, "welcome and the tour").
 *
 * The welcome asks what the app will be used for. The answers pick which steps of the tour a person
 * gets and which of the sibling apps they are offered. The tour is a card that floats over the app,
 * one idea a step, each saying why the thing it lights matters rather than how to press it. It is
 * workout-tracker's tour (src/lib/tour.ts there): the steps are data, the rules are pure, and what
 * has been seen is a list of ids, so a step added later reaches someone mid-tour.
 */

/** What the welcome offers to use the app for, in the order it shows them. */
export const uses = ['tasks', 'goals', 'notes', 'trips', 'email', 'workouts'] as const
export type Use = typeof uses[number]

/** One of the other apps, offered to someone who picked what it does. */
export type AppOffer = { id: 'mail' | 'tracker'; name: string; url: string }

export const mailAppUrl = 'https://chase-grey.github.io/my-mail/'
export const trackerAppUrl = 'https://chase-grey.github.io/workout-tracker/'

/** The apps to offer for these picks. Email is my mail's and workouts are workout tracker's; nothing picked offers neither. */
export function appOffers(picked: readonly Use[], link: (url: string) => string = besideThisApp): AppOffer[] {
  return [
    ...(picked.includes('email') ? [{ id: 'mail' as const, name: 'my mail', url: link(mailAppUrl) }] : []),
    ...(picked.includes('workouts') ? [{ id: 'tracker' as const, name: 'workout tracker', url: link(trackerAppUrl) }] : []),
  ]
}

/** The screens a step can open behind its card. */
export type TourView = 'today' | 'tasks' | 'progress' | 'chat' | 'notes' | 'trips' | 'goals' | 'settings'

export type TourStep = {
  id: string
  /** The screen that is open behind the card while this step is up. */
  view: TourView
  /** What the step lights: a screen's own button, or the new task button. A screen kept under … lights the … instead. */
  target: TourView | 'new'
  title: string
  body: string
  /** Shown only to someone who picked this, or who picked nothing at all. */
  needs?: Use
  /** Only for someone with ai on. */
  needsAi?: boolean
}

/** In the order they are shown: today and what it is short for, then along the bar, then what sits behind …. */
export const tourSteps: readonly TourStep[] = [
  { id: 'today', view: 'today', target: 'today', title: 'today', body: 'what is due, and what there is time for. it stays short on purpose, so the day never starts as a wall of everything.' },
  { id: 'new', view: 'today', target: 'new', title: 'new task', needs: 'tasks', body: 'put a thing down the moment you think of it. it waits under new to sort, so nothing has to be decided right then.' },
  { id: 'tasks', view: 'tasks', target: 'tasks', title: 'tasks', needs: 'tasks', body: 'everything still to do, by when it is due. today can stay short because the rest is kept here.' },
  { id: 'progress', view: 'progress', target: 'progress', title: 'progress', body: 'eight areas of your life on one wheel. a full week can hide what has gone quiet; the wheel shows it.' },
  { id: 'chat', view: 'chat', target: 'chat', title: 'chat', needsAi: true, body: 'it sees your tasks, goals and calendar, and can change them for you. ask it to plan your week.' },
  { id: 'notes', view: 'notes', target: 'notes', title: 'notes', needs: 'notes', body: 'notes, and a journal with a page for each day. they save themselves, and your words are only tidied when you ask.' },
  { id: 'trips', view: 'trips', target: 'trips', title: 'trips', needs: 'trips', body: 'a packing list for each trip, started from your usual one, so nothing is remembered at the door.' },
  { id: 'goals', view: 'goals', target: 'goals', title: 'goals', needs: 'goals', body: 'what you are working toward. a goal you can see is one that gets time.' },
  { id: 'settings', view: 'settings', target: 'settings', title: 'settings', body: 'your accounts, the color of the app, and this tour again whenever you want it.' },
]

/** What a device remembers: the welcome's picks, the steps already shown, and whether the tour is over. */
export type Guide = { uses: Use[]; seen: string[]; done: boolean }

/** A device that never went through the welcome's questions: no picks, and no tour unless asked for. */
export const noGuide: Guide = { uses: [], seen: [], done: true }

/** The steps this person gets. Someone who picked nothing is shown everything. */
export function stepsFor(guide: Pick<Guide, 'uses'>, aiOn: boolean, steps: readonly TourStep[] = tourSteps): TourStep[] {
  return steps.filter((step) => (!step.needs || guide.uses.length === 0 || guide.uses.includes(step.needs)) && (!step.needsAi || aiOn))
}

/** The step to show now, or undefined when the tour is over. */
export function currentStep(steps: readonly TourStep[], guide: Guide): TourStep | undefined {
  if (guide.done) return undefined
  return steps.find((step) => !guide.seen.includes(step.id))
}

/** Where a step falls among the steps, for "2 of 5". */
export function stepPosition(steps: readonly TourStep[], step: TourStep): { index: number; total: number } {
  return { index: steps.findIndex((item) => item.id === step.id) + 1, total: steps.length }
}

/** `next`: the step is seen, and seeing the last one ends the tour. */
export function advance(steps: readonly TourStep[], guide: Guide, id: string): Guide {
  const seen = guide.seen.includes(id) ? guide.seen : [...guide.seen, id]
  const next = { ...guide, seen }
  return { ...next, done: guide.done || currentStep(steps, next) === undefined }
}

/** `skip tour`: over, and it stays over. */
export function skip(guide: Guide): Guide {
  return { ...guide, done: true }
}

/** The tour from the top, for the settings button. The picks are kept. */
export function restart(guide: Guide): Guide {
  return { ...guide, seen: [], done: false }
}

/** A box on the screen, in viewport pixels. */
export type Box = { top: number; left: number; width: number; height: number }

/** The part of `target` that is on screen, grown by `pad` so the light does not sit hard against it. Undefined when none of it is. */
export function litBox(target: Box, view: { width: number; height: number }, pad: number): Box | undefined {
  if (target.width <= 0 || target.height <= 0) return undefined
  const top = Math.max(target.top - pad, 0)
  const bottom = Math.min(target.top + target.height + pad, view.height)
  const left = Math.max(target.left - pad, 0)
  const right = Math.min(target.left + target.width + pad, view.width)
  if (bottom - top <= 0 || right - left <= 0) return undefined
  return { top, left, width: right - left, height: bottom - top }
}

/**
 * Where the tour's card goes, given what it points at: beside the lit box where the window is wide
 * enough (a monitor, where under it would cover the rest of the rail), else under it when it fits
 * there, over it when it only fits there, and otherwise against the bottom, across the box. Sideways
 * it stays as near the box as the window allows. With nothing lit it sits in the middle. `top` is the first pixel the
 * card may use, under the phone's status bar.
 */
export function cardPlace(spot: Box | undefined, card: { width: number; height: number }, view: { width: number; height: number; top: number }, gap: number): { top: number; left: number } {
  const highest = view.top + gap
  const lowest = Math.max(highest, view.height - card.height - gap)
  const farLeft = Math.max(gap, view.width - card.width - gap)
  if (!spot) return { top: Math.max(highest, (view.height - card.height) / 2), left: Math.max(gap, (view.width - card.width) / 2) }
  const beside = spot.left + spot.width + gap
  if (beside + card.width + gap <= view.width) return { top: Math.min(lowest, Math.max(highest, spot.top)), left: beside }
  const left = Math.min(farLeft, Math.max(gap, spot.left + spot.width / 2 - card.width / 2))
  const below = spot.top + spot.height + gap
  if (below <= lowest) return { top: below, left }
  const above = spot.top - gap - card.height
  if (above >= highest) return { top: above, left }
  return { top: lowest, left }
}

// ---------------------------------------------------------------------------------------------
// What the device keeps. It stays on the device: one of your own devices takes its settings from the
// account and never goes through the welcome's questions, so it has no tour to be kept from replaying.

export const guideStorageKey = 'my-brain.guide.v1'

export function parseGuide(stored: string | null): Guide {
  if (!stored) return noGuide
  try {
    const parsed = JSON.parse(stored) as Partial<Record<keyof Guide, unknown>>
    return {
      uses: Array.isArray(parsed.uses) ? uses.filter((use) => (parsed.uses as unknown[]).includes(use)) : [],
      seen: Array.isArray(parsed.seen) ? parsed.seen.filter((item): item is string => typeof item === 'string') : [],
      done: parsed.done !== false,
    }
  } catch {
    return noGuide
  }
}

let held: Guide | undefined
const listeners = new Set<() => void>()

export function loadGuide(): Guide {
  if (held) return held
  try {
    held = parseGuide(localStorage.getItem(guideStorageKey))
  } catch {
    held = noGuide
  }
  return held
}

export function saveGuide(guide: Guide): void {
  held = guide
  try {
    localStorage.setItem(guideStorageKey, JSON.stringify(guide))
  } catch {
    // The tour still runs from memory.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useGuide(): Guide {
  return useSyncExternalStore(subscribe, loadGuide, () => noGuide)
}
