import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Task } from './domain/types'
import { leaveMs, TaskRow } from './ui'
import { DoneTodayCard } from './views/TodayView'

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8')
const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, taskId: id, domain: 'personal', title: id, completed: true, estimateMin: 30, originalEstimateMin: 30, priority: 3, energy: 'shallow', pinned: false, carries: 0, ...extra })

describe('done today', () => {
  it('is not drawn until something is done', () => {
    expect(renderToStaticMarkup(<DoneTodayCard tasks={[]} onToggle={() => {}} onOpen={() => {}} />)).toBe('')
  })

  it('lists what was done, each with a check that takes it back', () => {
    const html = renderToStaticMarkup(<DoneTodayCard tasks={[task('call mom'), task('take out bins')]} onToggle={() => {}} onOpen={() => {}} />)
    expect(html).toContain('done today')
    expect(html).toContain('aria-label="undo call mom"')
    expect(html).toContain('aria-label="undo take out bins"')
    expect(html).toMatch(/class="count is-loud">2</)
  })

  it('sits at the bottom of today, and a task ticked off leaves the list above for it', () => {
    const today = readFileSync(new URL('./views/TodayView.tsx', import.meta.url), 'utf8')
    expect(today.indexOf('<DoneTodayCard')).toBeGreaterThan(today.indexOf('new to sort</summary>'))
    expect(today).toContain('open.map((task) => <TaskRow')
    expect(today).toContain('<Done label="all done today" />')
  })
})

describe('motion', () => {
  it('draws a row as it was until it is ticked', () => {
    const html = renderToStaticMarkup(<TaskRow task={task('call mom', { completed: false })} done={false} onToggle={() => {}} />)
    expect(html).toContain('class="row"')
    expect(html).not.toContain('is-ticked')
  })

  it('keeps a ticked row for as long as its animation runs', () => {
    const [, length, delay] = css.match(/\.row\.is-leaving \{ animation: row-out (\d+)ms (\d+)ms/) ?? []
    expect(Number(length) + Number(delay)).toBe(leaveMs)
  })

  it('moves nothing for someone who asked for less motion', () => {
    const outside = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, '')
    for (const name of ['rise-in', 'tick-pop', 'tick-sparks', 'row-out', 'row-in', 'count-pop', 'mark-pop', 'tab-pop', 'bar-in', 'menu-in', 'sheet-up']) {
      expect(outside, name).not.toMatch(new RegExp(`animation(-name)?: ${name}\b`))
    }
  })

  it('never stops animations to measure the card screens, which would start every one of them again', () => {
    expect(css).not.toMatch(/is-measuring \*/)
  })

  it('leaves no card holding an animation’s last frame, so a menu in it opens over the next card', () => {
    expect(css).not.toMatch(/.card[^{]*{[^}]*animation:[^;}]*(both|forwards)/)
  })
})
