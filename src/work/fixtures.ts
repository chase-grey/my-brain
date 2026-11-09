import type { Design, DesignReview, Dlg, Prj, Qan, WorkConfig, WorkSnapshot } from './types'
import { defaultWorkConfig } from './types'

// Shared test fixture: a team lead (me) with two reports, shaped like a real vibes snapshot.
export const ME = '1'
export const DAN = '2'
export const GAURESH = '3'
export const TODAY = '2026-11-05'

export function dlg(overrides: Partial<Dlg> & { id: string; name: string }): Dlg {
  return {
    statusId: 100, status: 'Under Development', type: 'Enhancement',
    developerId: DAN, responsibleId: DAN, responsibleName: 'Dan Demp', responsibleRole: 'Dev',
    pqa1Id: null, pqa2Id: null, qa1Id: null, qa2Id: null, writerId: null,
    devCompDeadline: null, pqa1Deadline: null, qa1Deadline: null, pqa2Deadline: null, qa2Deadline: null, currentDue: null,
    daysInStatus: 400, workDaysInStatus: 280, lastBatonPass: null, batonPassesInStatus: 0, underDevSince: '2025-01-10',
    isSu: 0, brokenWatchout: 0, highPriOpenComments: 0, version: 'February 2027', releaseVersion: 'Epic February 2027', productId: 1000377,
    paused: 0, action: null, prjIds: null,
    ...overrides,
  }
}

export function review(overrides: Partial<DesignReview> & { designId: string; name: string }): DesignReview {
  return {
    reviewerId: ME, leadId: '9', leadName: 'Nicholas Rose', status: 'In Review', required: 1, perspective: null,
    inReviewBy: '2026-11-01', approvalBy: '2026-11-10', submittedOn: '2026-10-20', lastUpdate: '2026-11-03', lastComment: '2026-11-03',
    activeReviewers: 2, totalReviewers: 6, requiredReviewers: 3, product: 'SmartTools',
    ...overrides,
  }
}

export function design(overrides: Partial<Design> & { id: string; name: string }): Design {
  return {
    status: 'In Review', leadId: ME, leadName: 'Chase Grey', creatorId: ME, createdOn: '2026-10-01', submittedOn: '2026-10-20', inReviewBy: '2026-11-01', approvalBy: '2026-11-12',
    lastUpdate: '2026-11-02', lastComment: '2026-11-02', totalReviewers: 5, activeReviewers: 2, product: 'SmartTools', pendingReviewers: 3, pendingRequired: 1, waitingForChanges: 0,
    ...overrides,
  }
}

export function prj(overrides: Partial<Prj> & { id: string; name: string }): Prj {
  return {
    status: 'Dev', active: 1, type: 'Standard', onTrack: 'On Track', onTrackSetOn: '2026-11-01', onTrackComment: null, onTrackOverdue: 0, qaConfidence: null,
    targetVersion: 'February 2027', targetReleaseNum: 2027.1, committedVersion: null, commitLevel: null, ownerId: ME, qaOwnerId: null,
    plannedStart: null, plannedDevComp: '2026-12-01', plannedQa1: null, plannedReadiness: null, readinessOn: null, dueOn: null,
    estimatedHours: 400, remainingHours: 120, loggedHours: 280, openImportantIssues: 0, product: 'SmartTools', pointPeople: `${ME}:Owner`, onBacklog: 1,
    ...overrides,
  }
}

export function qan(overrides: Partial<Qan> & { id: string; name: string }): Qan {
  return {
    status: 'Assigned', priorityId: 4, priority: 'Important', type: 'Bug', fixerId: null, ownerId: null, authorId: null, workDaysInStatus: 12, version: 2027.1,
    product: 'SmartTools', functionalArea: 'SmartText', enteredOn: '2026-10-01', escalatedOn: null, affectsReleased: 'Yes',
    ...overrides,
  }
}

export function snapshot(overrides: Partial<WorkSnapshot> = {}): WorkSnapshot {
  return {
    capturedAt: `${TODAY}T07:00:00.000Z`,
    source: { server: 'thor', database: 'EpicDW', schema: 'vibes' },
    me: { id: ME, name: 'Chase Grey', level: 0 },
    team: [{ id: DAN, name: 'Dan Demp', level: 1 }, { id: GAURESH, name: 'Gauresh Walia', level: 1 }],
    designReviews: [], designs: [], dlgs: [], prjs: [], qans: [], qanSummary: [], slgs: [], outages: [], activity: [], errors: [],
    ...overrides,
  }
}

export function config(overrides: Partial<WorkConfig> = {}): WorkConfig {
  return { ...defaultWorkConfig, ignores: [], ...overrides }
}
