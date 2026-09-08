import type { Delegation, Task } from './types'

export function nudgeDelegation(delegation: Delegation, today: string): { delegation: Delegation; draft: string } {
  return {
    delegation: { ...delegation, checkBackOn: today },
    draft: `checking in on ${delegation.title}`,
  }
}

export function takeBackDelegation(delegation: Delegation, estimateMin: number): Task {
  const id = crypto.randomUUID()
  return {
    id, taskId: id, domain: delegation.domain, title: delegation.title,
    completed: false, estimateMin, originalEstimateMin: estimateMin, priority: 2, planDate: delegation.checkBackOn,
    energy: 'shallow', pinned: false, carries: 0, kind: 'execution',
  }
}
