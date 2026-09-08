import { describe, expect, it } from 'vitest'
import { buildFitPlans } from './fitPicker'
import type { Project, Task } from './types'

const project: Project = { id: 'p', domain: 'personal', title: 'bike', status: 'active', rhythm: 'burst', drive: 'intrinsic', minBlockMin: 120, mode: 'tools' }
const task: Task = { id: 't', taskId: 't', projectId: 'p', domain: 'personal', title: 'brakes', completed: false, estimateMin: 90, originalEstimateMin: 90, priority: 2, planDate: '2026-09-01', energy: 'deep', place: ['home'], needs: ['tools'], pinned: false, carries: 0 }
const base = { domain: 'personal' as const, today: '2026-09-03', weeklyCapacityMin: 300, energy: 'deep' as const, place: 'home' as const, availableNeeds: ['tools'] as const }

describe('fit picker', () => {
  it('uses only the selected space and its project metadata', () => {
    const foreignProject = { ...project, domain: 'work' as const, minBlockMin: 1 }
    const foreignTask = { ...task, id: 'work', domain: 'work' as const }
    expect(buildFitPlans([task, foreignTask], [project, foreignProject], { ...base, availableMin: 90 })).toEqual([])
    expect(buildFitPlans([task, foreignTask], [project, foreignProject], { ...base, availableMin: 120 }).every((plan) => plan.tasks.every((item) => item.domain === 'personal'))).toBe(true)
  })

  it('hard-filters burst work below its minimum block', () => {
    expect(buildFitPlans([task], [project], { ...base, availableMin: 90 })).toEqual([])
    expect(buildFitPlans([task], [project], { ...base, availableMin: 120 })[0].tasks).toContain(task)
  })

  it('offers mode-grouped and mixed shapes without filtering other modes', () => {
    const other = { ...task, id: 'x', taskId: 'x', projectId: undefined, mode: 'phone', estimateMin: 20 }
    const plans = buildFitPlans([task, other], [project], { ...base, availableMin: 120, currentMode: 'tools' })
    expect(plans.some((plan) => plan.mode === 'tools')).toBe(true)
    expect(plans.some((plan) => plan.kind === 'mixed')).toBe(true)
  })
})
