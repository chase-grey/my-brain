// Shapes written by bridge/work-dashboard.ps1 (snapshot) and stored in the vault (config).
// Ids are strings everywhere: FS DLGs look like Y206683 and employee ids are varchar in vibes.

export type Person = { id: string; name: string; level: number; teamLeadId?: string | null; teamLeadName?: string | null; role?: string | null; team?: string | null }

export type DesignReview = {
  designId: string | number; name: string; reviewerId: string; leadId: string | null; leadName: string | null; status: string
  required: number; perspective: string | null; inReviewBy: string | null; approvalBy: string | null; submittedOn: string | null
  lastUpdate: string | null; lastComment: string | null; activeReviewers: number | null; totalReviewers: number | null; requiredReviewers: number | null
  product: string | null
}

export type Design = {
  id: string | number; name: string; status: string; leadId: string | null; leadName: string | null; creatorId: string | null
  createdOn: string | null; submittedOn: string | null; inReviewBy: string | null; approvalBy: string | null; lastUpdate: string | null; lastComment: string | null
  totalReviewers: number | null; activeReviewers: number | null; product: string | null
  pendingReviewers: number; pendingRequired: number; waitingForChanges: number
}

export type Dlg = {
  id: string; name: string; statusId: number; status: string; type: string | null
  developerId: string | null; responsibleId: string | null; responsibleName: string | null; responsibleRole: string | null
  pqa1Id: string | null; pqa2Id: string | null; qa1Id: string | null; qa2Id: string | null; writerId: string | null
  devCompDeadline: string | null; pqa1Deadline: string | null; qa1Deadline: string | null; pqa2Deadline: string | null; qa2Deadline: string | null; currentDue: string | null
  daysInStatus: number | null; workDaysInStatus: number | null; lastBatonPass: string | null; batonPassesInStatus: number | null; underDevSince: string | null
  isSu: number; brokenWatchout: number; highPriOpenComments: number | null; version: string | null; releaseVersion: string | null; productId: number | null
  paused: number | null; action: string | null; prjIds: string | null
}

export type Prj = {
  id: string | number; name: string; status: string; active: number; type: string | null
  onTrack: string | null; onTrackSetOn: string | null; onTrackComment: string | null; onTrackOverdue: number | boolean | null; qaConfidence: string | null
  targetVersion: string | null; targetReleaseNum: number | null; committedVersion: string | null; commitLevel: string | null
  ownerId: string | null; qaOwnerId: string | null
  plannedStart: string | null; plannedDevComp: string | null; plannedQa1: string | null; plannedReadiness: string | null; readinessOn: string | null; dueOn: string | null
  estimatedHours: number | null; remainingHours: number | null; loggedHours: number | null; openImportantIssues: number | null; product: string | null
  pointPeople: string | null; onBacklog: number
}

export type Qan = {
  id: string | number; name: string; status: string; priorityId: number; priority: string; type: string | null
  fixerId: string | null; ownerId: string | null; authorId: string | null; workDaysInStatus: number | null; version: number | string | null
  product: string | null; functionalArea: string | null; enteredOn: string | null; escalatedOn: string | null; affectsReleased: string | null
}

export type QanSummary = { product: string; priorityId: number; priority: string; openCount: number; escalated: number; stale: number }

export type Slg = {
  id: string | number; title: string; customer: string | null; status: string; priority: string | null; type: string | null
  assignedId: string | null; batonId: string | null; lastEpicPost: string | null; lastCustomerPost: string | null; createdOn: string | null
}

export type Outage = { employeeId: string; employeeName: string; type: string; startOn: string; endOn: string; isOoo: boolean | number; approved: boolean | number }

export type Activity = { employeeId: string; dlgId: string | null; prjId: string | null; qanId: string | null; slgId: string | null; hours: number; lastOn: string | null; descriptions: string[] }

export type WorkSnapshot = {
  capturedAt: string
  source: { server: string; database: string; schema: string; note?: string }
  me: Person
  team: Person[]
  designReviews: DesignReview[]
  designs: Design[]
  dlgs: Dlg[]
  prjs: Prj[]
  qans: Qan[]
  qanSummary: QanSummary[]
  slgs: Slg[]
  outages: Outage[]
  activity: Activity[]
  errors: string[]
  durationMs?: number
}

export type IgnoreKind = 'dlg' | 'design' | 'prj' | 'qan' | 'slg' | 'person'
export type Ignore = { kind: IgnoreKind; id: string | number; note?: string; addedOn?: string; until?: string }

export type WorkFilters = {
  teamActivityDays: number
  teamBatonDays: number
  pqaNearDays: number
  designOptionalStaleDays: number
  designOverdueGraceDays: number
  /** Required reviews further out than this stay hidden until they get close. */
  reviewHorizonDays: number
  /** Optional reviews are hidden unless this is on. */
  optionalReviews: boolean
  prjVersionsAhead: number
  qanPriorityIds: number[]
  /** Important product QANs only surface once they have sat this long. */
  qanStaleWorkdays: number
}

export type OutageWindow = { start: string; end: string }

export type WorkConfig = {
  version: number
  me?: string | null
  products: string[]
  filters: WorkFilters
  ignores: Ignore[]
  outage?: OutageWindow | null
}

export const defaultFilters: WorkFilters = {
  teamActivityDays: 14,
  teamBatonDays: 21,
  pqaNearDays: 7,
  designOptionalStaleDays: 21,
  designOverdueGraceDays: 14,
  reviewHorizonDays: 21,
  optionalReviews: false,
  prjVersionsAhead: 1,
  qanPriorityIds: [1, 2, 4],
  qanStaleWorkdays: 30,
}

export const defaultWorkConfig: WorkConfig = { version: 1, products: ['SmartTools'], filters: defaultFilters, ignores: [], outage: null }

export function trackUrl(kind: 'DLG' | 'XDS' | 'PRJ' | 'ZQN' | 'SLG', id: string | number): string {
  return `https://emc2summary.epic.com/GetSummaryReport.ashx/track/${kind}/${id}`
}
