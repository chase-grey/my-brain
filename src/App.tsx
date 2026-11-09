import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import type { CalendarBlock } from './data/calendarGraphProvider'
import type { InboxCounts } from './data/mailGraphProvider'
import { addDays, blockWindow, eventsOn, reconcileHeldGoal } from './domain/calendar'
import { configuredPersonalClientId, createPersonalGraphData, type PersonalGraphData } from './data/personalGraphData'
import { mergePersonalTasks, personalTaskMetaFile, taskMetadata } from './data/personalTaskSync'
import type { TaskProvider } from './data/taskProvider'
import { WorkBridgeProvider, outlookTaskList } from './data/workBridgeProvider'
import { mergeWorkTasks } from './data/workTaskSync'
import { demoProviderTasks, demoTaskMetadata } from './demoData'
import { buildNowPlan, isDoneToday, thisWeekCommitments, todayCommitments } from './domain/personalNow'
import { projectTasks } from './domain/taskProjection'
import { buildWeekReceipt } from './domain/receipt'
import { toggleHabitPart } from './domain/habits'
import type { Domain, Energy, Goal, Place, Priority, StoreType, Task } from './domain/types'
import { loadProductState, saveProductState, type ProductState } from './productState'
import { loadSettings, saveSettings } from './settings'
import { buildPlanSummary, companionGoal, companionTask, summarizeGoal, summarizeProject, summarizeTask, type CompanionActions, type GoalChanges } from './companion/companionTools'
import { Icon, type IconName } from './navIcons'
import { newId, today } from './format'
import { Menu } from './ui'
import { useKeyboardInset } from './useKeyboardInset'
import { pushWidget, widgetSnapshot } from './native/widget'
import { TodayView } from './views/TodayView'
import { ProgressView } from './views/ProgressView'
import { GoalsView, type GoalEdit } from './views/GoalsView'
import { StoresView } from './views/StoresView'
import { SettingsView, type ConnectionStatus } from './views/SettingsView'
import { TaskPage } from './views/TaskPage'
import { UsageView } from './views/UsageView'
import { WorkDashboardView } from './views/WorkDashboardView'

type View = 'today' | 'progress' | 'dashboard' | 'chat' | 'stores' | 'goals' | 'usage' | 'settings' | 'task'
const taskStorageKey = (domain: Domain) => `my-brain.${domain}.tasks.v1`
const dockedQuery = '(min-width: 87.5rem)'
// Work reviews a dashboard where personal reviews progress; the other tab moves under more.
const primaryViewsFor = (domain: Domain): { view: View; icon: IconName }[] => [
  { view: 'today', icon: 'today' },
  domain === 'work' ? { view: 'dashboard', icon: 'progress' } : { view: 'progress', icon: 'progress' },
  { view: 'chat', icon: 'chat' },
]
const ChatView = lazy(() => import('./companion/ChatView').then((module) => ({ default: module.ChatView })))
const ShareLanding = lazy(() => import('./transcripts/ShareLanding'))
const views: View[] = ['today', 'progress', 'dashboard', 'chat', 'stores', 'goals', 'usage', 'settings', 'task']

function parseHash(): { view: View; taskId?: string } {
  if (typeof location === 'undefined') return { view: 'today' }
  const [name, id] = location.hash.replace(/^#/, '').split('/')
  if (name === 'task') return { view: 'task', taskId: id || undefined }
  return { view: views.includes(name as View) ? name as View : 'today' }
}

const talkHash = '#chat/talk'

function hashFor(view: View, taskId?: string): string {
  return view === 'task' && taskId ? `#task/${taskId}` : `#${view}`
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function inferredPlace(now = new Date()): Place {
  const weekday = now.getDay()
  const hour = now.getHours()
  return weekday >= 1 && weekday <= 5 && hour >= 9 && hour < 17 ? 'office' : 'home'
}

function errorMessage(error: unknown): string {
  if (error instanceof InteractionRequiredAuthError) return 'reconnect microsoft to allow calendar and mail'
  return error instanceof Error ? error.message.toLowerCase() : 'sync failed'
}

function workErrorMessage(error: unknown): string {
  if (error instanceof TypeError) return 'start the work bridge with npm run bridge'
  return errorMessage(error)
}

const workResyncAfterMs = 5 * 60 * 1000

function initialTasks(domain: Domain): Task[] {
  const projection = projectTasks(demoProviderTasks, demoTaskMetadata)
  const tasks: Task[] = [
    ...projection.triaged.map((task) => ({ ...task, metadataComplete: true })),
    ...projection.untriaged.map((task) => ({
      ...task,
      taskId: task.id,
      estimateMin: 30,
      originalEstimateMin: 30,
      priority: 3 as Priority,
      energy: 'shallow' as Energy,
      pinned: false,
      carries: 0,
      metadataComplete: false,
    })),
    {
      id: 'work-email-zero', taskId: 'work-email-zero', domain: 'work', title: 'clear email', completed: false,
      estimateMin: 30, originalEstimateMin: 30, priority: 2, energy: 'shallow', place: ['office'], needs: ['computer'],
      mode: 'email', kind: 'execution', recurrence: 'weekdays-135', timeWindow: 'day', pinned: false, carries: 0, metadataComplete: true,
    },
  ]
  return tasks.filter((task) => task.domain === domain)
}

function loadTasks(domain: Domain): Task[] {
  try {
    const stored = localStorage.getItem(taskStorageKey(domain)) ?? localStorage.getItem('my-brain.tasks.v1')
    if (stored) {
      const loaded = (JSON.parse(stored) as Task[]).filter((task) => task.domain === domain && !task.triageForTaskId).map((task) => ({
        ...task,
        storeType: (task.storeType as string) === 'general' ? 'other' as const : task.storeType,
      }))
      const missingRoutines = initialTasks(domain).filter((task) => task.recurrence && !loaded.some((item) => item.id === task.id))
      return [...loaded, ...missingRoutines]
    }
  } catch {
    // Storage can be unavailable in privacy modes; the app still works in memory.
  }
  return initialTasks(domain)
}

export default function App() {
  const [domain, setDomain] = useState<Domain>('personal')
  useKeyboardInset()
  return <Workspace key={domain} activeDomain={domain} onDomain={setDomain} />
}

export function Workspace({ activeDomain, onDomain }: { activeDomain: Domain; onDomain: (domain: Domain) => void }) {
  const [view, setView] = useState<View>(() => parseHash().view)
  const [docked, setDocked] = useState(() => typeof matchMedia === 'function' && matchMedia(dockedQuery).matches)
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks(activeDomain))
  const [availableMin, setAvailableMin] = useState<number>(60)
  const [energy, setEnergy] = useState<Energy>('shallow')
  const [placeOverride, setPlaceOverride] = useState<Place | undefined>()
  const [activeStore, setActiveStore] = useState<StoreType>('grocery')
  const [settings, setSettings] = useState(() => loadSettings(activeDomain))
  const [product, setProduct] = useState<ProductState>(() => loadProductState(activeDomain))
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  // A transcript shared from the phone lands on #share before the hash effect normalizes it; capture it once.
  const [sharing, setSharing] = useState(() => typeof location !== 'undefined' && location.hash === '#share')
  // #chat/talk opens the chat already listening: the app shortcut and the android widget use it.
  const [talk, setTalk] = useState(() => typeof location !== 'undefined' && location.hash === talkHash)
  const [editingTaskId, setEditingTaskId] = useState<string | undefined>(() => parseHash().taskId)
  const [personalData, setPersonalData] = useState<PersonalGraphData>()
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    activeDomain === 'work' || configuredPersonalClientId() ? 'disconnected' : 'unconfigured',
  )
  const workBridge = useMemo(() => new WorkBridgeProvider(), [])
  const workSyncedAt = useRef(0)
  const [accountName, setAccountName] = useState<string>()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string>()
  const [calendarEvents, setCalendarEvents] = useState<CalendarBlock[]>([])
  const [heldEvents, setHeldEvents] = useState<Record<string, CalendarBlock>>({})
  const [inboxCounts, setInboxCounts] = useState<InboxCounts>()
  const authStarted = useRef(false)
  const tasksRef = useRef(tasks)
  const productRef = useRef(product)
  productRef.current = product

  const currentDay = today()
  const currentPlace = placeOverride ?? inferredPlace()
  const openTasks = useMemo(() => tasks.filter((task) => task.domain === activeDomain && !isDoneToday(task, currentDay) && !task.storeType), [activeDomain, currentDay, tasks])
  const commitments = useMemo(() => todayCommitments(tasks, currentDay, activeDomain), [activeDomain, currentDay, tasks])
  const weeklyCommitments = useMemo(() => thisWeekCommitments(tasks, currentDay, activeDomain), [activeDomain, currentDay, tasks])
  const plan = useMemo(() => buildNowPlan(openTasks, {
    domain: activeDomain,
    today: currentDay,
    availableMin,
    weeklyCapacityMin: activeDomain === 'work' ? settings.workdayCapacityMin * 5 : settings.personalWeeklyCeilingMin,
    energy,
    place: energy === 'errand' ? 'out' : currentPlace,
    availableNeeds: energy === 'errand' ? ['car', 'store', 'phone'] : currentPlace === 'office' ? ['computer', 'phone'] : ['computer', 'phone', 'tools'],
  }), [activeDomain, availableMin, currentDay, currentPlace, energy, openTasks, settings.personalWeeklyCeilingMin, settings.workdayCapacityMin])
  const openEstimate = openTasks.reduce((sum, task) => sum + task.estimateMin, 0)
  const activeCommitment = [...product.commitments].reverse().find((item) => item.domain === activeDomain)
  const weekPaid = activeCommitment ? buildWeekReceipt(activeCommitment, product.activities.filter((item) => item.domain === activeDomain), product.dayOverrides).paid : false

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  // The android widget mirrors the today card.
  useEffect(() => {
    void pushWidget(widgetSnapshot(activeDomain, commitments, currentDay, currentPlace))
  }, [activeDomain, commitments, currentDay, currentPlace])

  useEffect(() => {
    const clientId = configuredPersonalClientId()
    if (activeDomain !== 'personal' || !clientId || authStarted.current) return
    authStarted.current = true
    void createPersonalGraphData(clientId).then((data) => {
      setPersonalData(data)
      const account = data.auth.account()
      if (!account) return
      setAccountName(account.username)
      setConnectionStatus('connected')
      void syncPersonal(data)
    }).catch((error: unknown) => setSyncError(errorMessage(error)))
  }, [])

  // Work tasks live in Outlook (where Microsoft To Do keeps them); the bridge reads them on open and whenever the tab comes back after a while.
  useEffect(() => {
    if (activeDomain !== 'work') return
    void syncWork()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - workSyncedAt.current > workResyncAfterMs) void syncWork()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(taskStorageKey(activeDomain), JSON.stringify(tasks.filter((task) => task.domain === activeDomain)))
    } catch {
      // Keep the in-memory experience usable if persistence is unavailable.
    }
  }, [tasks])

  useEffect(() => saveSettings(settings, activeDomain), [settings])

  useEffect(() => saveProductState(product, activeDomain), [product])

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
    }
    const clearInstallPrompt = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', captureInstallPrompt)
    window.addEventListener('appinstalled', clearInstallPrompt)
    return () => {
      window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
      window.removeEventListener('appinstalled', clearInstallPrompt)
    }
  }, [])

  async function installApp() {
    if (!installPrompt) return
    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === 'accepted') setInstallPrompt(null)
  }

  function startAddingTask() {
    setEditingTaskId(undefined)
    setView('task')
  }

  useEffect(() => {
    const desired = hashFor(view, editingTaskId)
    if (location.hash !== desired) history.pushState(null, '', desired)
  }, [view, editingTaskId])

  useEffect(() => {
    const onPop = () => {
      if (location.hash === talkHash) setTalk(true)
      const parsed = parseHash()
      setEditingTaskId(parsed.taskId)
      setView(parsed.view)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const query = matchMedia(dockedQuery)
    const update = () => setDocked(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  function commitTasks(next: Task[]): void {
    const scoped = next.filter((task) => task.domain === activeDomain)
    tasksRef.current = scoped
    setTasks(scoped)
    try {
      localStorage.setItem(taskStorageKey(activeDomain), JSON.stringify(scoped))
    } catch {
      // Keep changes usable when storage is unavailable.
    }
  }

  async function persistPersonalMetadata(next: Task[], data = personalData): Promise<void> {
    if (!data || connectionStatus !== 'connected') return
    try {
      for (const meta of taskMetadata(next)) await data.events.append('taskMeta', meta.taskId, 'set', meta)
      setSyncError(undefined)
    } catch (error) {
      setSyncError(errorMessage(error))
    }
  }

  async function syncPersonal(data = personalData): Promise<void> {
    if (activeDomain !== 'personal' || !data) return
    setSyncing(true)
    setSyncError(undefined)
    try {
      const [providerTasks, replay, legacyMetadata] = await Promise.all([
        data.tasks.listTasks(),
        data.events.replay(),
        data.sidecar.readJson<ReturnType<typeof taskMetadata>>(personalTaskMetaFile),
      ])
      const current = tasksRef.current
      const replayedMetadata = Object.values(replay.state.taskMeta ?? {}) as ReturnType<typeof taskMetadata>
      const metadata = replayedMetadata.length ? replayedMetadata : legacyMetadata ?? taskMetadata(current)
      const personal = mergePersonalTasks(providerTasks, metadata, current)
      commitTasks(personal)
    } catch (error) {
      setSyncError(errorMessage(error))
    } finally {
      setSyncing(false)
    }
    await syncGlance(data)
  }

  async function syncWork(): Promise<void> {
    if (activeDomain !== 'work') return
    setSyncing(true)
    setSyncError(undefined)
    try {
      const remote = await workBridge.listTasks()
      commitTasks(mergeWorkTasks(remote, tasksRef.current))
      workSyncedAt.current = Date.now()
      setConnectionStatus('connected')
      setAccountName('outlook tasks through the work bridge')
    } catch (error) {
      setConnectionStatus('disconnected')
      setSyncError(workErrorMessage(error))
    } finally {
      setSyncing(false)
    }
  }

  /** The active space's remote task list when it is reachable: To Do for personal, Outlook through the bridge for work. */
  function remoteTasks(): TaskProvider | undefined {
    if (connectionStatus !== 'connected') return undefined
    return activeDomain === 'personal' ? personalData?.tasks : workBridge
  }

  function reportSync(error: unknown): void {
    setSyncError(activeDomain === 'work' ? workErrorMessage(error) : errorMessage(error))
  }

  /** Calendar and inbox are read-only glances: their failure never blocks the task sync. */
  async function syncGlance(data: PersonalGraphData): Promise<void> {
    const start = `${currentDay}T00:00:00`
    const end = `${addDays(currentDay, 7)}T00:00:00`
    const [events, counts] = await Promise.allSettled([data.calendar.events(start, end), data.mail.inboxCounts()])
    if (events.status === 'fulfilled') setCalendarEvents(events.value)
    if (counts.status === 'fulfilled') setInboxCounts(counts.value)
    const failure = [events, counts].find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) setSyncError((current) => current ?? errorMessage(failure.reason))
    await reconcileHeldGoals(data)
  }

  async function reconcileHeldGoals(data: PersonalGraphData): Promise<void> {
    const held = productRef.current.goals.filter((goal) => goal.domain === 'personal' && goal.status === 'active' && goal.calendarEventId)
    if (!held.length) return
    const found: Record<string, CalendarBlock> = {}
    for (const goal of held) {
      let event: CalendarBlock | undefined
      try {
        event = await data.calendar.event(goal.calendarEventId!)
      } catch (error) {
        setSyncError((current) => current ?? errorMessage(error))
        continue
      }
      const change = reconcileHeldGoal(goal, event)
      if (event) found[goal.id] = event
      // Passing the event id along marks this as a read-back, so updateGoal does not write the day to the calendar again.
      if (change.kind === 'moved') updateGoal(goal.id, { scheduledOn: change.scheduledOn, calendarEventId: goal.calendarEventId })
      if (change.kind === 'released') updateGoal(goal.id, { calendarEventId: undefined })
    }
    setHeldEvents(found)
  }

  async function holdGoal(id: string): Promise<void> {
    const goal = productRef.current.goals.find((item) => item.id === id && item.domain === activeDomain)
    if (!goal || goal.shape !== 'block' || !goal.scheduledOn) throw new Error('pick a date before holding it in the calendar')
    if (!personalData || connectionStatus !== 'connected') throw new Error('connect microsoft to hold a block in the calendar')
    if (goal.calendarEventId) return
    const window = blockWindow(goal.scheduledOn)
    const event = await personalData.calendar.createReservedBlock(goal.title, window.start, window.end, 'held by my brain. move the hour here; the day comes back to the app.')
    setHeldEvents((current) => ({ ...current, [goal.id]: event }))
    updateGoal(id, { calendarEventId: event.id })
  }

  async function releaseGoal(id: string): Promise<void> {
    const goal = productRef.current.goals.find((item) => item.id === id && item.domain === activeDomain)
    if (!goal?.calendarEventId) return
    if (personalData && connectionStatus === 'connected') await personalData.calendar.deleteEvent(goal.calendarEventId)
    setHeldEvents((current) => { const next = { ...current }; delete next[goal.id]; return next })
    updateGoal(id, { calendarEventId: undefined })
  }

  function holdAction(action: () => Promise<void>): void {
    void action().then(() => setSyncError(undefined)).catch((error: unknown) => setSyncError(errorMessage(error)))
  }

  async function connectPersonal(): Promise<void> {
    setSyncing(true)
    setSyncError(undefined)
    try {
      const clientId = configuredPersonalClientId()
      if (!clientId) throw new Error('microsoft app id is not configured')
      const data = personalData ?? await createPersonalGraphData(clientId)
      setPersonalData(data)
      const account = await data.auth.signIn()
      setAccountName(account.username)
      setConnectionStatus('connected')
      await syncPersonal(data)
    } catch (error) {
      setSyncError(errorMessage(error))
      setSyncing(false)
    }
  }

  async function disconnectPersonal(): Promise<void> {
    if (!personalData) return
    setSyncing(true)
    try {
      await personalData.auth.signOut()
      setConnectionStatus('disconnected')
      setAccountName(undefined)
      setSyncError(undefined)
    } catch (error) {
      setSyncError(errorMessage(error))
    } finally {
      setSyncing(false)
    }
  }

  function addTask(task: Task) {
    if (task.domain !== activeDomain) return
    insertTask(task)
    if (task.storeType) {
      setActiveStore(task.storeType)
      setView('stores')
    } else {
      setView('today')
    }
  }

  function insertTask(task: Task) {
    if (task.domain !== activeDomain) return
    const localNext = [...tasksRef.current, task]
    commitTasks(localNext)
    const remote = remoteTasks()
    if (remote && !task.recurrence) {
      void (async () => {
        try {
          const listId = activeDomain === 'personal' && personalData ? await personalData.tasks.defaultListId() : outlookTaskList
          const created = await remote.createTask(listId, task)
          const next = tasksRef.current.map((item) => item.id === task.id ? { ...item, ...created, taskId: created.id } : item)
          commitTasks(next)
          await persistPersonalMetadata(next)
        } catch (error) {
          reportSync(error)
        }
      })()
    } else {
      void persistPersonalMetadata(localNext)
    }
  }

  function completeTask(id: string) {
    const task = tasksRef.current.find((item) => item.id === id)
    if (!task) return undefined
    if (isDoneToday(task, currentDay)) return { id, title: task.title, alreadyDone: true }
    toggleComplete(id)
    return { id, title: task.title, alreadyDone: false }
  }

  function reopenTask(id: string) {
    const task = tasksRef.current.find((item) => item.id === id)
    if (!task || !isDoneToday(task, currentDay)) return
    toggleComplete(id)
    // The completion also left a mark on the week; undoing takes that back too.
    if (!task.recurrence) {
      setProduct((current) => {
        const at = current.activities.map((item) => item.kind === 'task-completed' && item.taskId === id).lastIndexOf(true)
        return at < 0 ? current : { ...current, activities: current.activities.filter((_, index) => index !== at) }
      })
    }
  }

  function removeTask(id: string): Task | undefined {
    const previous = tasksRef.current.find((task) => task.id === id)
    if (!previous) return undefined
    commitTasks(tasksRef.current.filter((task) => task.id !== id))
    // Neither adapter deletes; completing the task remotely keeps it from syncing back.
    const remote = remoteTasks()
    if (remote && previous.providerListId && !previous.completed) {
      void remote.updateTask(previous, { completed: true }).catch((error: unknown) => reportSync(error))
    }
    return previous
  }

  function restoreTask(task: Task) {
    if (task.domain !== activeDomain || tasksRef.current.some((item) => item.id === task.id)) return
    commitTasks([...tasksRef.current, task])
    const remote = remoteTasks()
    if (remote && task.providerListId && !task.completed) {
      void remote.updateTask({ ...task, completed: true }, { completed: false }).catch((error: unknown) => reportSync(error))
    }
  }

  function addGoal(input: Parameters<CompanionActions['addGoal']>[0]) {
    const goal = companionGoal(activeDomain, input)
    setProduct((current) => ({ ...current, goals: [...current.goals, goal] }))
    productRef.current = { ...productRef.current, goals: [...productRef.current.goals, goal] }
    return summarizeGoal(goal)
  }

  function removeGoal(id: string) {
    const existing = productRef.current.goals.find((goal) => goal.id === id && goal.domain === activeDomain)
    if (!existing) return
    const apply = (goals: Goal[]) => goals.filter((goal) => goal.id !== id)
    setProduct((current) => ({ ...current, goals: apply(current.goals) }))
    productRef.current = { ...productRef.current, goals: apply(productRef.current.goals) }
    if (existing.calendarEventId && personalData && connectionStatus === 'connected') {
      void personalData.calendar.deleteEvent(existing.calendarEventId).catch((error: unknown) => setSyncError(errorMessage(error)))
    }
  }

  function updateGoal(id: string, changes: GoalChanges | GoalEdit) {
    const existing = productRef.current.goals.find((goal) => goal.id === id && goal.domain === activeDomain)
    if (!existing) return undefined
    const revisions = [...existing.revisions]
    if (changes.targetDate !== undefined && changes.targetDate !== existing.targetDate) revisions.push({ on: currentDay, field: 'date', from: existing.targetDate ?? '', to: changes.targetDate })
    if ('scheduledOn' in changes && changes.scheduledOn !== existing.scheduledOn) revisions.push({ on: currentDay, field: 'date', from: existing.scheduledOn ?? '', to: changes.scheduledOn ?? '' })
    if (changes.hoursCommitted !== undefined && changes.hoursCommitted !== existing.hoursCommitted) revisions.push({ on: currentDay, field: 'hours', from: existing.hoursCommitted ?? 0, to: changes.hoursCommitted })
    const updated: Goal = { ...existing, ...changes, revisions }
    const apply = (goals: Goal[]) => goals.map((goal) => goal.id === id ? updated : goal)
    setProduct((current) => ({ ...current, goals: apply(current.goals) }))
    productRef.current = { ...productRef.current, goals: apply(productRef.current.goals) }
    const movedHold = 'scheduledOn' in changes && changes.scheduledOn && changes.scheduledOn !== existing.scheduledOn && existing.calendarEventId && !('calendarEventId' in changes)
    if (movedHold && personalData && connectionStatus === 'connected') {
      void personalData.calendar.moveEventToDay(existing.calendarEventId!, changes.scheduledOn!)
        .then((event) => { if (event) setHeldEvents((current) => ({ ...current, [id]: event })) })
        .catch((error: unknown) => setSyncError(errorMessage(error)))
    }
    if (updated.status !== 'active' && existing.calendarEventId && personalData && connectionStatus === 'connected') {
      void personalData.calendar.deleteEvent(existing.calendarEventId).catch((error: unknown) => setSyncError(errorMessage(error)))
    }
    return summarizeGoal(updated)
  }

  const companionActions: CompanionActions = {
    listTasks: (options) => tasksRef.current.filter((task) => task.domain === activeDomain && !task.storeType && (options?.includeCompleted || !isDoneToday(task, currentDay))).map(summarizeTask),
    findTask: (id) => { const task = tasksRef.current.find((item) => item.id === id && item.domain === activeDomain); return task ? summarizeTask(task) : undefined },
    createTask: (input) => {
      const task = companionTask(activeDomain, input, currentDay)
      insertTask(task)
      return summarizeTask(task)
    },
    completeTask,
    reopenTask,
    removeTask,
    restoreTask,
    listGoals: () => productRef.current.goals.filter((goal) => goal.domain === activeDomain && goal.status === 'active').map(summarizeGoal),
    findGoal: (id) => { const goal = productRef.current.goals.find((item) => item.id === id && item.domain === activeDomain); return goal ? summarizeGoal(goal) : undefined },
    addGoal,
    updateGoal,
    removeGoal,
    listProjects: () => productRef.current.projects.filter((project) => project.domain === activeDomain && project.status === 'active').map(summarizeProject),
    listCalendar: () => activeDomain === 'personal' ? calendarEvents : [],
    holdGoal: async (id) => { await holdGoal(id); return summarizeGoal(productRef.current.goals.find((goal) => goal.id === id)!) },
    releaseGoal,
    todaySummary: () => buildPlanSummary({ today: currentDay, domain: activeDomain, tasks: tasksRef.current, commitments, weeklyCommitments, plan, goals: productRef.current.goals, projects: productRef.current.projects, calendar: activeDomain === 'personal' ? eventsOn(calendarEvents, currentDay) : [] }),
  }

  function editTask(id: string) {
    setEditingTaskId(id)
    setView('task')
  }

  function deleteTask(id: string) {
    if (!removeTask(id)) return
    setEditingTaskId(undefined)
    setView('today')
  }

  function delegateTask(id: string): void {
    const source = tasksRef.current.find((task) => task.id === id)
    if (!source) return
    const next = tasksRef.current.map((task) => task.id === id ? { ...task, kind: 'delegated' as const, metadataComplete: true } : task)
    commitTasks(next)
    void persistPersonalMetadata(next)
    setProduct((current) => ({ ...current, delegations: [...current.delegations, {
      id: crypto.randomUUID(), domain: source.domain, title: source.title, assignee: '', askedOn: currentDay,
      checkBackOn: currentDay, status: 'asked',
    }] }))
    setEditingTaskId(undefined)
    setView('today')
  }

  function updateTask(updated: Task) {
    if (updated.domain !== activeDomain) return
    const previous = tasksRef.current.find((task) => task.id === updated.id)
    const next = tasksRef.current.map((task) => task.id === updated.id ? updated : task)
    commitTasks(next)
    void persistPersonalMetadata(next)
    const remote = remoteTasks()
    if (remote && previous?.providerListId) {
      const changes = { title: updated.title, dueDate: updated.dueDate }
      void remote.updateTask(previous, activeDomain === 'work' ? { ...changes, notes: updated.notes ?? '' } : changes)
        .catch((error: unknown) => reportSync(error))
    }
    setEditingTaskId(undefined)
    setView('today')
  }

  function toggleComplete(id: string) {
    const previous = tasksRef.current.find((task) => task.id === id)
    if (!previous) return
    const next = tasksRef.current.map((task) => {
      if (task.id !== id) return task
      if (task.recurrence) return { ...task, lastCompletedDate: task.lastCompletedDate === currentDay ? undefined : currentDay }
      return { ...task, completed: !task.completed }
    })
    commitTasks(next)
    if (!previous.recurrence && !previous.completed) {
      setProduct((current) => ({ ...current, activities: [...current.activities, {
        id: crypto.randomUUID(), domain: previous.domain, kind: 'task-completed', taskId: previous.id,
        projectId: previous.projectId, mode: previous.mode, occurredAt: new Date().toISOString(),
        estimateDeltaMin: previous.estimateMin,
      }] }))
    }
    const remote = remoteTasks()
    if (previous.recurrence) {
      void persistPersonalMetadata(next)
    } else if (remote && previous.providerListId) {
      void remote.updateTask(previous, { completed: !previous.completed }).catch((error: unknown) => {
        commitTasks(tasksRef.current.map((task) => task.id === id ? previous : task))
        reportSync(error)
      })
    }
  }

  const shownView: View = docked && view === 'chat' ? 'today' : view
  const untriaged = tasks.filter((task) => task.domain === activeDomain && task.metadataComplete === false && !task.completed && !task.storeType)
  const floorToday = product.dayOverrides.some((item) => item.domain === activeDomain && item.date === currentDay && item.kind === 'floor')
  const strategicTodayMin = product.activities.filter((item) => item.domain === activeDomain && item.kind === 'strategic' && item.occurredAt.slice(0, 10) === currentDay).reduce((sum, item) => sum + (item.minutes ?? 0), 0)
  const primaryViews = primaryViewsFor(activeDomain)
  const moreItems = [
    ...(activeDomain === 'personal' ? [{ label: 'stores', onSelect: () => setView('stores') }] : [{ label: 'progress', onSelect: () => setView('progress') }]),
    { label: 'goals', onSelect: () => setView('goals') },
    { label: 'usage', onSelect: () => setView('usage') },
    { label: 'settings', onSelect: () => setView('settings') },
    ...(installPrompt ? [{ label: 'install app', onSelect: () => void installApp() }] : []),
  ]
  const chat = <Suspense fallback={<header className="view-head"><h1>chat</h1></header>}><ChatView key={activeDomain} domain={activeDomain} settings={settings} actions={companionActions} summary={companionActions.todaySummary()} hasCalendar={activeDomain === 'personal' && connectionStatus === 'connected'} onSettings={() => setView('settings')} onChangeSettings={(change) => setSettings((current) => ({ ...current, ...change }))} docked={docked} talk={talk} onTalkStarted={() => setTalk(false)} /></Suspense>

  function navButton(item: { view: View; icon: IconName }) {
    return <button key={item.view} className={shownView === item.view ? 'active' : ''} onClick={() => setView(item.view)} type="button" aria-current={shownView === item.view ? 'page' : undefined}><Icon name={item.icon} /><span>{item.view}</span></button>
  }

  return <div className={`app${docked ? ' is-docked' : ''}`}>
    <nav className="rail" aria-label="primary">
      {primaryViews.filter((item) => !(docked && item.view === 'chat')).map(navButton)}
      <div className="rail-more"><Menu label="more" align="start" items={moreItems}><Icon name="more" /><span>more</span></Menu></div>
    </nav>

    <div className="main">
      <header className="topbar">
        <div className="switch" role="group" aria-label="space">
          {(['personal', 'work'] as const).map((item) => <button aria-pressed={activeDomain === item} className={activeDomain === item ? 'selected' : ''} key={item} onClick={() => onDomain(item)} type="button">{item}</button>)}
        </div>
        {shownView !== 'task' && <button className="icon-button" type="button" aria-label="new task" title="new task" onClick={startAddingTask}><Icon name="plus" /></button>}
      </header>

      <div className={`content view-${shownView}`}>
        {sharing && <Suspense fallback={null}><ShareLanding onClose={() => setSharing(false)} /></Suspense>}
        {shownView === 'today' && <TodayView domain={activeDomain} currentDay={currentDay} place={currentPlace} placeOverride={placeOverride} onPlaceOverride={setPlaceOverride}
          commitments={commitments} weeklyCommitments={weeklyCommitments} habits={product.habits} habitEntries={product.habitEntries}
          onHabitPart={(habitId, partId) => setProduct((current) => ({ ...current, habitEntries: toggleHabitPart(current.habitEntries, habitId, partId, currentDay) }))}
          plan={plan} availableMin={availableMin} energy={energy} onMinutes={setAvailableMin} onEnergy={setEnergy}
          weekPaid={weekPaid} floorToday={floorToday} strategicTodayMin={strategicTodayMin}
          onFloorNight={() => setProduct((current) => ({ ...current, dayOverrides: [...current.dayOverrides, { date: currentDay, domain: activeDomain, kind: 'floor' }] }))}
          onStrategic={(minutes) => setProduct((current) => ({ ...current, activities: [...current.activities, { id: newId('activity'), domain: activeDomain, kind: 'strategic', occurredAt: new Date().toISOString(), minutes }] }))}
          untriaged={untriaged} openCount={openTasks.length} openMin={openEstimate} onToggle={toggleComplete} onOpen={editTask}
          calendar={activeDomain === 'personal' ? eventsOn(calendarEvents, currentDay) : []} inbox={activeDomain === 'personal' ? inboxCounts : undefined} mailAppUrl={activeDomain === 'personal' ? settings.mailAppUrl : ''} />}
        {shownView === 'dashboard' && <WorkDashboardView currentDay={currentDay} />}
        {shownView === 'progress' && <ProgressView domain={activeDomain} product={product} currentDay={currentDay} heldEvents={heldEvents} onProduct={setProduct} onGoals={() => setView('goals')} />}
        {shownView === 'chat' && chat}
        {shownView === 'goals' && <GoalsView domain={activeDomain} product={product} tasks={tasks} currentDay={currentDay} heldEvents={heldEvents} canHold={activeDomain === 'personal' && connectionStatus === 'connected'} holdError={syncError} onProduct={setProduct} onEditGoal={(id, changes) => { updateGoal(id, changes) }} onHold={(id) => holdAction(() => holdGoal(id))} onRelease={(id) => holdAction(() => releaseGoal(id))} />}
        {shownView === 'stores' && <StoresView activeStore={activeStore} tasks={tasks} onStore={setActiveStore} onToggle={toggleComplete} onAdd={addTask} />}
        {shownView === 'usage' && <UsageView domain={activeDomain} />}
        {shownView === 'settings' && <SettingsView domain={activeDomain} accountName={accountName} connectionStatus={connectionStatus} settings={settings} syncing={syncing} syncError={syncError} canInstall={Boolean(installPrompt)} onInstall={() => void installApp()} onConnect={connectPersonal} onDisconnect={disconnectPersonal} onSync={() => { void (activeDomain === 'work' ? syncWork() : syncPersonal()) }} onSettings={setSettings} />}
        {shownView === 'task' && <TaskPage key={editingTaskId ?? 'new'} domain={activeDomain} existingTask={tasks.find((task) => task.id === editingTaskId)} projects={product.projects.filter((project) => project.domain === activeDomain && project.status === 'active')} onAdd={addTask} onUpdate={updateTask} onDelete={deleteTask} onNotMine={delegateTask} onCancel={() => { setEditingTaskId(undefined); setView('today') }} />}
      </div>

      {shownView !== 'task' && <nav className="tabbar" aria-label="primary">
        {primaryViews.map(navButton)}
        <Menu label="more" items={moreItems}><Icon name="more" /><span>more</span></Menu>
      </nav>}
    </div>

    {docked && <aside className="dock">{chat}</aside>}
  </div>
}
