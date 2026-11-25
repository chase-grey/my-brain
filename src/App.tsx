import { Suspense, lazy, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import type { CalendarBlock } from './data/calendarGraphProvider'
import type { InboxCounts } from './data/mailGraphProvider'
import { addDays, blockWindow, eventsOn, keptPick, reconcileHeldGoal, timeNow } from './domain/calendar'
import { configuredPersonalClientId, createPersonalGraphData, type PersonalGraphData } from './data/personalGraphData'
import { mergePersonalTasks, personalTaskMetaFile, taskMetadata } from './data/personalTaskSync'
import type { TaskProvider } from './data/taskProvider'
import { WorkBridgeProvider, outlookTaskList } from './data/workBridgeProvider'
import { mergeWorkTasks } from './data/workTaskSync'
import { demoProviderTasks, demoTaskMetadata } from './demoData'
import { useFitColumns } from './fitColumns'
import { besideThisApp } from './site'
import { splitRail, useRailSlots } from './rail'
import { buildNowPlan, isDoneToday, thisWeekCommitments, todayCommitments } from './domain/personalNow'
import { currentStore } from './domain/shopping'
import { projectTasks } from './domain/taskProjection'
import { buildWeekReceipt } from './domain/receipt'
import { toggleHabitPart } from './domain/habits'
import type { Domain, Energy, Goal, Place, Priority, StoreType, Task } from './domain/types'
import { loadProductState, saveProductState, withMoneyReading, type ProductState } from './productState'
import { fetchTrackerSummary, newerSummary, readTrackerSummary, readTrackerToken, type TrackerSummary } from './domain/bodyTracker'
import { loadSettings, saveSettings, type AppSettings } from './settings'
import { applyDeviceSetup, loadAccount, saveAccount, setupFromHash, showsWork, takesSetupLink, type DeviceAccount } from './account'
import { accountFile, accountFileFrom, mergeAccountFile, type AccountFile } from './settingsSync'
import { GitHubVault, normalizeBranch, normalizeRepo, vaultConfigured } from './companion/githubVault'
import type { Attachment } from './companion/attachments'
import { WorkJournal } from './journal/workJournal'
import { buildPlanSummary, companionGoal, companionTask, summarizeGoal, summarizeProject, summarizeTask, type CompanionActions, type GoalChanges } from './companion/companionTools'
import { Icon, type IconName } from './navIcons'
import { newId, today } from './format'
import { Menu } from './ui'
import { useKeyboardInset } from './useKeyboardInset'
import { pushWidget, widgetSnapshot } from './native/widget'
import { pushReminders } from './native/reminders'
import { localMoment, remindersFor } from './domain/remind'
import { syncPhoneRest } from './native/health'
import { moneyBriefing } from './domain/money'
import { moneyReader } from './companion/moneyRead'
import { useTaskGuesses } from './companion/taskGuesses'
import { nextToSort, sortedTask } from './domain/taskGuess'
import { TodayView } from './views/TodayView'
import { ProgressView } from './views/ProgressView'
import { bumpsBetween, recordBumps } from './review/bumpLog'
import { useReviews } from './review/useReviews'
import { GoalsView, type GoalEdit } from './views/GoalsView'
import { StoresView } from './views/StoresView'
import { SettingsView, type ConnectionStatus } from './views/SettingsView'
import { UpdateToast } from './views/UpdateToast'
import { checkForUpdate, holdUpdates, useAppUpdate } from './appUpdate'
import { useIssuesWaiting } from './issues/useIssues'
import { TaskPage } from './views/TaskPage'
import { TripsView } from './views/TripsView'
import { WorkScreens } from './views/WorkScreens'
import { WelcomeView } from './views/WelcomeView'
import { SetupLanding, landsOnInstall } from './views/SetupLanding'
import { openInChrome, useInstallPrompt } from './installPrompt'

type View = 'today' | 'progress' | 'dashboard' | 'chat' | 'notes' | 'journal' | 'stores' | 'trips' | 'goals' | 'settings' | 'task'
const taskStorageKey = (domain: Domain) => `my-brain.${domain}.tasks.v1`
const dockedQuery = '(min-width: 87.5rem)'
// Work reviews a dashboard where personal reviews progress; the other tab moves under more.
/** The screens past the main ones: under … on the phone, and on the rail itself wherever a monitor has the room (src/rail.ts). */
const moreViewsFor = (domain: Domain): { view: View; icon: IconName }[] => [
  // Personal has notes, with the journal a folder inside them. Work has the journal alone, kept on the work pc.
  { view: domain === 'personal' ? 'notes' : 'journal', icon: 'journal' },
  ...(domain === 'personal' ? [{ view: 'stores', icon: 'stores' }, { view: 'trips', icon: 'trips' }] as const : [{ view: 'progress', icon: 'progress' }] as const),
  { view: 'goals', icon: 'goals' },
  { view: 'settings', icon: 'settings' },
]
const primaryViewsFor = (domain: Domain): { view: View; icon: IconName }[] => [
  { view: 'today', icon: 'today' },
  domain === 'work' ? { view: 'dashboard', icon: 'dashboard' } : { view: 'progress', icon: 'progress' },
  { view: 'chat', icon: 'chat' },
]
// The work journal lives in the work vault, behind the bridge.
const workJournal = new WorkJournal()
const NotesView = lazy(() => import('./notes/NotesView').then((module) => ({ default: module.NotesView })))
const ChatView = lazy(() => import('./companion/ChatView').then((module) => ({ default: module.ChatView })))
const ShareLanding = lazy(() => import('./transcripts/ShareLanding'))
/** The screens made of cards, which src/fitColumns.ts lays out to fit a monitor. */
const deckViews: View[] = ['today', 'progress', 'goals', 'settings', 'trips']
const views: View[] = ['today', 'progress', 'dashboard', 'chat', 'notes', 'journal', 'stores', 'trips', 'goals', 'settings', 'task']

function parseHash(): { view: View; taskId?: string } {
  if (typeof location === 'undefined') return { view: 'today' }
  const [name, id] = location.hash.replace(/^#/, '').split('/')
  if (name === 'task') return { view: 'task', taskId: id || undefined }
  return { view: views.includes(name as View) ? name as View : 'today' }
}

const talkHash = '#chat/talk'
// #chat/mail/<message id> is how the mail app hands a message over to talk about.
const mailHash = '#chat/mail/'

export function mailIdFromHash(hash: string): string | undefined {
  if (!hash.startsWith(mailHash)) return undefined
  try {
    return decodeURIComponent(hash.slice(mailHash.length)) || undefined
  } catch {
    return undefined
  }
}

/** A task still under new to sort. */
function toSort(task: Task): boolean {
  return task.metadataComplete === false && !task.completed && !task.storeType
}

function hashFor(view: View, taskId?: string): string {
  return view === 'task' && taskId ? `#task/${taskId}` : `#${view}`
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

/** The owner's starting tasks. Anyone else starts with none: these are Chase's errands, not theirs. */
function initialTasks(domain: Domain, owner: boolean): Task[] {
  if (!owner) return []
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
      estimateMin: 30, originalEstimateMin: 30, priority: 2, energy: 'shallow', place: ['office'],
      mode: 'email', kind: 'execution', recurrence: 'weekdays-135', timeWindow: 'day', pinned: false, carries: 0, metadataComplete: true,
    },
  ]
  return tasks.filter((task) => task.domain === domain)
}

function loadTasks(domain: Domain, owner: boolean): Task[] {
  try {
    const stored = localStorage.getItem(taskStorageKey(domain)) ?? localStorage.getItem('my-brain.tasks.v1')
    if (stored) {
      const loaded = (JSON.parse(stored) as Task[]).filter((task) => task.domain === domain && !task.triageForTaskId).map((task) => ({
        ...task,
        storeType: currentStore(task.storeType),
      }))
      const missingRoutines = initialTasks(domain, owner).filter((task) => task.recurrence && !loaded.some((item) => item.id === task.id))
      return [...loaded, ...missingRoutines]
    }
  } catch {
    // Storage can be unavailable in privacy modes; the app still works in memory.
  }
  return initialTasks(domain, owner)
}

/**
 * The account this device opens as. A setup link from another of your devices (#setup=...) sets it
 * up on the spot and is taken out of the address, so the keys it carried don't sit in history.
 */
let openedFromSetupLink = false

function initialAccount(): DeviceAccount {
  const setup = typeof location === 'undefined' ? undefined : setupFromHash(location.hash)
  if (!setup) return loadAccount()
  const current = loadAccount()
  if (!takesSetupLink(current)) {
    history.replaceState(null, '', `${location.pathname}${location.search}#today`)
    return current
  }
  openedFromSetupLink = true
  const applied = applyDeviceSetup(setup, loadSettings('personal'))
  saveSettings(applied.settings, 'personal')
  saveAccount(applied.account)
  history.replaceState(null, '', `${location.pathname}${location.search}#today`)
  return applied.account
}

export default function App() {
  const [account, setAccount] = useState(initialAccount)
  const [domain, setDomain] = useState<Domain>('personal')
  useKeyboardInset()
  const [landing, setLanding] = useState(() => openedFromSetupLink && landsOnInstall())
  const [kickoff, setKickoff] = useState<string>()
  const updateAccount = (next: DeviceAccount) => { saveAccount(next); setAccount(next) }
  if (!account.setupComplete) {
    return <WelcomeView onDone={(next, settings, finish) => {
      saveSettings(settings, 'personal')
      // With a key to answer it, setup ends in a conversation rather than an empty today.
      if (finish?.kickoff) { setKickoff(finish.kickoff); history.replaceState(null, '', `${location.pathname}${location.search}#chat`) }
      updateAccount(next)
    }} />
  }
  if (landing) return <SetupLanding name={account.name} onDone={() => setLanding(false)} />
  const shownDomain = showsWork(account) ? domain : 'personal'
  return <Workspace key={shownDomain} activeDomain={shownDomain} onDomain={setDomain} account={account} onAccount={updateAccount} kickoff={kickoff} onKickoffUsed={() => setKickoff(undefined)} />
}

const accountPushDelayMs = 1500

export function Workspace({ activeDomain, onDomain, account, onAccount, kickoff, onKickoffUsed }: { activeDomain: Domain; onDomain: (domain: Domain) => void; account: DeviceAccount; onAccount: (account: DeviceAccount) => void; kickoff?: string; onKickoffUsed?: () => void }) {
  const [view, setView] = useState<View>(() => parseHash().view)
  const { ready: updateReady, byHand: updateByHand } = useAppUpdate()
  const [docked, setDocked] = useState(() => typeof matchMedia === 'function' && matchMedia(dockedQuery).matches)
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks(activeDomain, account.owner))
  // The time picked on today. Until one is picked the calendar chooses, and chat is told no number.
  const [pick, setPick] = useState<{ min: number; at: number }>()
  const [energy, setEnergy] = useState<Energy>('shallow')
  const [placeOverride, setPlaceOverride] = useState<Place | undefined>()
  const [activeStore, setActiveStore] = useState<StoreType>('grocery')
  const [settings, setSettings] = useState(() => loadSettings(activeDomain))
  // An issue the fixer cannot move without an answer or a merge puts the same dot on settings that a waiting update does.
  const issuesWaiting = useIssuesWaiting(activeDomain === 'personal' ? settings.issueToken : '')
  const settingsDot = updateReady || issuesWaiting > 0
  const [product, setProduct] = useState<ProductState>(() => loadProductState(activeDomain, account.owner))
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const accountRef = useRef(account)
  accountRef.current = account
  const accountPush = useRef<ReturnType<typeof setTimeout>>(undefined)
  const install = useInstallPrompt()
  // A transcript shared from the phone lands on #share before the hash effect normalizes it; capture it once.
  const [sharing, setSharing] = useState(() => typeof location !== 'undefined' && location.hash === '#share')
  // A journal entry on its way into the chat: attached to the next message once the chat opens.
  const [chatAttachment, setChatAttachment] = useState<Attachment>()
  // #chat/talk opens the chat already listening: the app shortcut and the android widget use it.
  const [talk, setTalk] = useState(() => typeof location !== 'undefined' && location.hash === talkHash)
  // Captured before the hash effect normalizes it, like the two above. Mail is personal, so the chat it opens is too.
  const [mailId, setMailId] = useState(() => typeof location === 'undefined' ? undefined : mailIdFromHash(location.hash))
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
  const [calendarRead, setCalendarRead] = useState(false)
  const [, setMinute] = useState(0)
  const [heldEvents, setHeldEvents] = useState<Record<string, CalendarBlock>>({})
  const [inboxCounts, setInboxCounts] = useState<InboxCounts>()
  const authStarted = useRef(false)
  const tasksRef = useRef(tasks)
  const productRef = useRef(product)
  productRef.current = product

  const currentDay = today()
  // The gap to the next event shrinks and the day ends as the clock moves, so the answer is taken again each minute.
  useEffect(() => {
    const timer = setInterval(() => setMinute((value) => value + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  const pickedMin = keptPick(pick)
  // Nothing is suggested for extra time until a length is set on today's slider.
  const availableMin = pickedMin ?? 0
  // Trips read and write the HomeBase vault directly, with the same repo settings the chat uses.
  const tripVault = useMemo(() => {
    const config = { repo: normalizeRepo(settings.githubRepo), token: settings.githubToken.replace(/\s+/g, ''), branch: normalizeBranch(settings.vaultBranch) }
    return activeDomain === 'personal' && vaultConfigured(config) ? new GitHubVault(config) : undefined
  }, [activeDomain, settings.githubRepo, settings.githubToken, settings.vaultBranch])
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

  // The android app holds every reminder still to come and gives it at its moment, open or not. Only the
  // personal space sets them, so opening work never clears them.
  useEffect(() => {
    if (activeDomain === 'personal') void pushReminders(remindersFor(tasks, localMoment()))
  }, [activeDomain, tasks])

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

  // The body slice follows workout-tracker: pick up its summary on open and whenever the app comes back to the front.
  useEffect(() => {
    if (activeDomain !== 'personal') return
    const token = settings.trackerToken || readTrackerToken()
    if (token && !settings.trackerToken) setSettings((current) => current.trackerToken ? current : { ...current, trackerToken: token })
    const take = (summary: TrackerSummary | undefined) => setProduct((current) => {
      const next = newerSummary(current.bodyTracker, summary)
      return !next || JSON.stringify(current.bodyTracker) === JSON.stringify(next) ? current : { ...current, bodyTracker: next }
    })
    let asked = 0
    const read = () => {
      take(readTrackerSummary())
      if (!token || Date.now() - asked < 10 * 60_000) return
      asked = Date.now()
      void fetchTrackerSummary(token).then(take)
    }
    read()
    const onVisible = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [settings.trackerToken])

  // The rest slice reads the phone: fold in its sleep and screen time on open and whenever the app comes back to the front.
  useEffect(() => {
    if (activeDomain !== 'personal') return
    const read = () => void syncPhoneRest(setProduct, today())
    read()
    const onVisible = () => { if (document.visibilityState === 'visible') read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [activeDomain])

  /** Set when the sort form moves on to the next task, for the address to follow without a new step back. */
  const sortingOn = useRef(false)

  function startAddingTask() {
    setEditingTaskId(undefined)
    setView('task')
  }

  // A task being written is lost by a reload, so the app does not update itself under it.
  useEffect(() => (view === 'task' ? holdUpdates() : undefined), [view])

  // Once the handed-over message is in hand its link leaves the address, so a reload or the back button does not open it a second time.
  // This runs before the hash is brought in line with the view below, which would otherwise leave the link one step back.
  useEffect(() => {
    if (activeDomain === 'personal' && mailId && mailIdFromHash(location.hash)) history.replaceState(null, '', `${location.pathname}${location.search}#chat`)
  }, [mailId, activeDomain])

  useEffect(() => {
    const desired = hashFor(view, editingTaskId)
    if (location.hash !== desired) {
      // The next task to sort takes the place of the one just dealt with, so back leaves sorting in one step.
      if (sortingOn.current) history.replaceState(null, '', desired)
      else history.pushState(null, '', desired)
    }
    if (sortingOn.current) {
      contentRef.current?.scrollTo(0, 0)
      window.scrollTo(0, 0)
    }
    sortingOn.current = false
  }, [view, editingTaskId])

  useEffect(() => {
    const onPop = () => {
      if (location.hash === talkHash) setTalk(true)
      const handed = mailIdFromHash(location.hash)
      if (handed) {
        setMailId(handed)
        // From the work space the personal one opens instead, and reads the message off the hash as it starts.
        if (activeDomain !== 'personal') onDomain('personal')
      }
      const parsed = parseHash()
      setEditingTaskId(parsed.taskId)
      setView(parsed.view)
    }
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
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
    // Every path that moves a task's day passes through here, so this is where a bump is seen.
    recordBumps(activeDomain, bumpsBetween(tasksRef.current, scoped, currentDay), currentDay)
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

  /** Folds the account's settings.json into this device and pushes back whatever this device has that it lacks. */
  async function syncAccount(data: PersonalGraphData): Promise<void> {
    const now = new Date().toISOString()
    const remote = await data.sidecar.readJson<AccountFile>(accountFile)
    const merged = mergeAccountFile({ account: accountRef.current, settings: settingsRef.current }, remote, now)
    settingsRef.current = merged.settings
    setSettings(merged.settings)
    accountRef.current = merged.account
    onAccount(merged.account)
    if (merged.push) await data.sidecar.writeJson(accountFile, accountFileFrom(merged.account, merged.settings, merged.account.updatedAt ?? now))
  }

  async function pushAccount(): Promise<void> {
    if (!personalData || connectionStatus !== 'connected') return
    const personalSettings = activeDomain === 'personal' ? settingsRef.current : loadSettings('personal')
    const current = accountRef.current
    try {
      await personalData.sidecar.writeJson(accountFile, accountFileFrom(current, personalSettings, current.updatedAt ?? new Date().toISOString()))
    } catch (error) {
      setSyncError(errorMessage(error))
    }
  }

  /** A change made here: it is now the newest copy, and goes up once typing settles. */
  function markAccountChanged(next: DeviceAccount = accountRef.current): void {
    const stamped = { ...next, updatedAt: new Date().toISOString() }
    accountRef.current = stamped
    onAccount(stamped)
    clearTimeout(accountPush.current)
    accountPush.current = setTimeout(() => void pushAccount(), accountPushDelayMs)
  }

  function changeSettings(update: SetStateAction<AppSettings>): void {
    setSettings((current) => {
      const next = typeof update === 'function' ? update(current) : update
      settingsRef.current = next
      return next
    })
    if (activeDomain === 'personal') markAccountChanged()
  }

  /** `reconnect` is for a sync the user asked for: an expired sign-in opens microsoft again instead of failing. */
  async function syncPersonal(data = personalData, reconnect = false): Promise<void> {
    if (activeDomain !== 'personal' || !data) return
    setSyncing(true)
    setSyncError(undefined)
    if (reconnect) {
      try {
        await data.auth.accessToken(true)
      } catch (error) {
        setSyncError(errorMessage(error))
        setSyncing(false)
        return
      }
    }
    try {
      await syncAccount(data)
    } catch (error) {
      setSyncError(errorMessage(error))
    }
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

  /** The work calendar is a glance like the personal one: its failure is said, and never blocks the task sync. */
  async function syncWorkCalendar(): Promise<void> {
    try {
      setCalendarEvents(await workBridge.events(currentDay, addDays(currentDay, 7)))
      setCalendarRead(true)
    } catch (error) {
      setSyncError(`calendar: ${workErrorMessage(error)}`)
    }
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
      void syncWorkCalendar()
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
    if (events.status === 'fulfilled') { setCalendarEvents(events.value); setCalendarRead(true) }
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
      // A project the model names has to be one of this space's own.
      const projectId = product.projects.some((project) => project.id === input.projectId && project.domain === activeDomain) ? input.projectId : undefined
      const task = companionTask(activeDomain, { ...input, projectId }, currentDay)
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
    ...(activeDomain === 'personal' ? {
      recordMoney: (figures, accounts) => {
        const before = productRef.current.moneySnapshots
        setProduct((current) => withMoneyReading(current, currentDay, figures, accounts))
        return { saved: Object.keys(figures), undo: () => setProduct((current) => ({ ...current, moneySnapshots: before })) }
      },
    } satisfies Partial<CompanionActions> : {}),
    todaySummary: () => buildPlanSummary({ today: currentDay, domain: activeDomain, tasks: tasksRef.current, commitments, weeklyCommitments, plan, goals: productRef.current.goals, projects: productRef.current.projects, calendar: activeDomain === 'personal' ? eventsOn(calendarEvents, currentDay) : [], pickedMin: keptPick(pick), freeNow: timeNow(calendarRead ? calendarEvents : undefined), money: activeDomain === 'personal' ? moneyBriefing(productRef.current.moneyGoals, productRef.current.moneySnapshots, currentDay) : undefined }),
  }

  function editTask(id: string) {
    setEditingTaskId(id)
    setView('task')
  }

  /** Where the sort form goes once its task is dealt with, read before the task leaves the list. */
  function afterTask(id: string): string | undefined {
    if (view !== 'task') return undefined
    return nextToSort(tasksRef.current.filter((task) => task.domain === activeDomain && toSort(task)), id)
  }

  /** Leaves a task that is dealt with: on to the next one to sort while sorting, back to today otherwise. */
  function leaveTask(next: string | undefined) {
    if (next) {
      sortingOn.current = true
      setEditingTaskId(next)
      return
    }
    setEditingTaskId(undefined)
    setView('today')
  }

  function deleteTask(id: string) {
    const next = afterTask(id)
    if (!removeTask(id)) return
    leaveTask(next)
  }

  function finishTask(id: string) {
    const next = afterTask(id)
    completeTask(id)
    leaveTask(next)
  }

  function delegateTask(id: string): void {
    const source = tasksRef.current.find((task) => task.id === id)
    if (!source) return
    const after = afterTask(id)
    const next = tasksRef.current.map((task) => task.id === id ? { ...task, kind: 'delegated' as const, metadataComplete: true } : task)
    commitTasks(next)
    void persistPersonalMetadata(next)
    setProduct((current) => ({ ...current, delegations: [...current.delegations, {
      id: crypto.randomUUID(), domain: source.domain, title: source.title, assignee: '', askedOn: currentDay,
      checkBackOn: currentDay, status: 'asked',
    }] }))
    leaveTask(after)
  }

  function updateTask(updated: Task) {
    if (updated.domain !== activeDomain) return
    const previous = tasksRef.current.find((task) => task.id === updated.id)
    const after = afterTask(updated.id)
    const next = tasksRef.current.map((task) => task.id === updated.id ? updated : task)
    commitTasks(next)
    void persistPersonalMetadata(next)
    const remote = remoteTasks()
    if (remote && previous?.providerListId) {
      const changes = { title: updated.title, dueDate: updated.dueDate }
      void remote.updateTask(previous, activeDomain === 'work' ? { ...changes, notes: updated.notes ?? '' } : changes)
        .catch((error: unknown) => reportSync(error))
    }
    leaveTask(after)
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

  // An old link to the journal lands on notes in personal, and notes on the journal in work.
  const spaceView: View = view === 'journal' && activeDomain === 'personal' ? 'notes' : view === 'notes' && activeDomain === 'work' ? 'journal' : view
  const shownView: View = docked && spaceView === 'chat' ? 'today' : spaceView
  const reviews = useReviews({ domain: activeDomain, currentDay, tasks, product, onProduct: setProduct, settings, notesVault: connectionStatus === 'connected' ? personalData?.notes : undefined, userName: account.name })
  const untriaged = tasks.filter((task) => task.domain === activeDomain && toSort(task))
  const activeProjects = product.projects.filter((project) => project.domain === activeDomain && project.status === 'active')
  const guesses = useTaskGuesses({ domain: activeDomain, tasks: untriaged, projects: activeProjects, settings })
  function confirmGuess(id: string): void {
    const task = tasksRef.current.find((item) => item.id === id)
    if (task && guesses[id]) updateTask(sortedTask(task, guesses[id], currentDay))
  }
  const floorToday = product.dayOverrides.some((item) => item.domain === activeDomain && item.date === currentDay && item.kind === 'floor')
  const strategicTodayMin = product.activities.filter((item) => item.domain === activeDomain && item.kind === 'strategic' && item.occurredAt.slice(0, 10) === currentDay).reduce((sum, item) => sum + (item.minutes ?? 0), 0)
  const primaryViews = primaryViewsFor(activeDomain)
  const railSlots = useRailSlots()
  const contentRef = useRef<HTMLDivElement>(null)
  useFitColumns(contentRef, `${activeDomain} ${shownView}`)
  const moreViews = moreViewsFor(activeDomain)
  const menuFor = (shown: typeof moreViews) => [
    ...(issuesWaiting ? [{ label: issuesWaiting === 1 ? 'issue waiting' : `${issuesWaiting} issues waiting`, onSelect: () => setView('settings') }] : []),
    ...(updateReady ? [{ label: updateByHand ? 'update ready · install' : 'update ready · restart', onSelect: () => void checkForUpdate() }] : []),
    ...shown.map((item) => ({ label: item.view, onSelect: () => setView(item.view) })),
    ...(install.canPrompt ? [{ label: 'install app', onSelect: () => void install.install() }] : []),
  ]
  const moreItems = menuFor(moreViews)
  const railPrimary = primaryViews.filter((item) => !(docked && item.view === 'chat'))
  const rail = splitRail(moreViews, railSlots, railPrimary.length, menuFor([]).length)
  const railMenu = menuFor(rail.underMore)
  const chat = <Suspense fallback={<header className="view-head"><h1>chat</h1></header>}><ChatView key={activeDomain} domain={activeDomain} settings={settings} actions={companionActions} summary={companionActions.todaySummary()} hasCalendar={activeDomain === 'personal' && connectionStatus === 'connected'} onSettings={() => setView('settings')} onChangeSettings={(change) => changeSettings((current) => ({ ...current, ...change }))} notesVault={connectionStatus === 'connected' ? personalData?.notes : undefined} userName={account.name} prefill={kickoff} onPrefilled={onKickoffUsed} attach={chatAttachment} onAttached={() => setChatAttachment(undefined)} docked={docked} talk={talk} onTalkStarted={() => setTalk(false)} mail={activeDomain === 'personal' && connectionStatus === 'connected' ? personalData?.mail : undefined} mailId={activeDomain === 'personal' ? mailId : undefined} mailOff={connectionStatus !== 'connected' && (connectionStatus === 'unconfigured' || Boolean(personalData) || Boolean(syncError))} onMailTaken={() => setMailId(undefined)} /></Suspense>

  function navButton(item: { view: View; icon: IconName }) {
    return <button key={item.view} className={shownView === item.view ? 'active' : ''} onClick={() => setView(item.view)} type="button" aria-current={shownView === item.view ? 'page' : undefined}><Icon name={item.icon} /><span>{item.view}</span>{settingsDot && item.view === 'settings' && <i className="nav-dot" aria-hidden="true" />}</button>
  }

  return <div className={`app${docked ? ' is-docked' : ''}`}>
    <nav className="rail" aria-label="primary">
      {railPrimary.map(navButton)}
      {rail.onRail.map(navButton)}
      {railMenu.length > 0 && <div className="rail-more"><Menu label="more" align="start" items={railMenu}><Icon name="more" /><span>more</span>{settingsDot && <i className="nav-dot" aria-hidden="true" />}</Menu></div>}
    </nav>

    <div className="main">
      <header className="topbar">
        {showsWork(account) ? <div className="switch" role="group" aria-label="space">
          {(['personal', 'work'] as const).map((item) => <button aria-pressed={activeDomain === item} className={activeDomain === item ? 'selected' : ''} key={item} onClick={() => onDomain(item)} type="button">{item}</button>)}
        </div> : <span />}
        {shownView !== 'task' && <button className="icon-button" type="button" aria-label="new task" title="new task" onClick={startAddingTask}><Icon name="plus" /></button>}
      </header>

      <div className={`content view-${shownView}${deckViews.includes(shownView) ? ' is-deck' : ''}`} ref={contentRef}>
        {install.installed && shownView === 'today' && <div className="install-banner"><span>installed. open my brain from your apps</span></div>}
        {install.offer && !install.installed && shownView === 'today' && <div className="install-banner">
          {install.offer === 'prompt'
            ? <><span>install my brain</span><button className="primary" type="button" onClick={() => void install.install()}>install</button></>
            : install.offer === 'chrome'
              ? <><span>install my brain</span><button className="primary" type="button" onClick={openInChrome}>open in chrome</button></>
              : <span>share → add to home screen</span>}
          <button className="icon-button" type="button" aria-label="dismiss" onClick={install.dismiss}>×</button>
        </div>}
        {sharing && <Suspense fallback={null}><ShareLanding onClose={() => setSharing(false)} /></Suspense>}
        {shownView === 'today' && <TodayView domain={activeDomain} currentDay={currentDay} place={currentPlace} placeOverride={placeOverride} onPlaceOverride={setPlaceOverride}
          commitments={commitments} weeklyCommitments={weeklyCommitments} habits={product.habits} habitEntries={product.habitEntries}
          onHabitPart={(habitId, partId) => setProduct((current) => ({ ...current, habitEntries: toggleHabitPart(current.habitEntries, habitId, partId, currentDay) }))}
          plan={plan} pickedMin={pickedMin} energy={energy} onMinutes={(min) => setPick(min ? { min, at: Date.now() } : undefined)} onEnergy={setEnergy}
          weekPaid={weekPaid} floorToday={floorToday} strategicTodayMin={strategicTodayMin}
          onFloorNight={() => setProduct((current) => ({ ...current, dayOverrides: [...current.dayOverrides, { date: currentDay, domain: activeDomain, kind: 'floor' }] }))}
          onStrategic={(minutes) => setProduct((current) => ({ ...current, activities: [...current.activities, { id: newId('activity'), domain: activeDomain, kind: 'strategic', occurredAt: new Date().toISOString(), minutes }] }))}
          untriaged={untriaged} guesses={guesses} projects={activeProjects} onConfirm={confirmGuess} openCount={openTasks.length} openMin={openEstimate} onToggle={toggleComplete} onOpen={editTask}
          calendar={eventsOn(calendarEvents, currentDay)} inbox={activeDomain === 'personal' ? inboxCounts : undefined} mailAppUrl={activeDomain === 'personal' ? besideThisApp(settings.mailAppUrl) : ''} />}
        {shownView === 'dashboard' && <WorkScreens currentDay={currentDay} />}
        {shownView === 'progress' && <ProgressView domain={activeDomain} product={product} tasks={tasks} journalVault={activeDomain === 'personal' ? tripVault ?? (connectionStatus === 'connected' ? personalData?.notes : undefined) : undefined} currentDay={currentDay} heldEvents={heldEvents} onProduct={setProduct} onGoals={() => setView('goals')} onReview={reviews.open} readMoney={activeDomain === 'personal' ? moneyReader(settings) : undefined} />}
        {shownView === 'chat' && chat}
        {shownView === 'goals' && <GoalsView domain={activeDomain} product={product} tasks={tasks} currentDay={currentDay} heldEvents={heldEvents} canHold={activeDomain === 'personal' && connectionStatus === 'connected'} holdError={syncError} onProduct={setProduct} onEditGoal={(id, changes) => { updateGoal(id, changes) }} onHold={(id) => holdAction(() => holdGoal(id))} onRelease={(id) => holdAction(() => releaseGoal(id))} />}
        {shownView === 'stores' && <StoresView activeStore={activeStore} tasks={tasks} onStore={setActiveStore} onToggle={toggleComplete} onAdd={addTask} />}
        {(shownView === 'notes' || shownView === 'journal') && <Suspense fallback={<header className="view-head"><h1>{shownView}</h1></header>}><NotesView key={activeDomain} domain={activeDomain} settings={settings} vault={activeDomain === 'personal' ? tripVault ?? (connectionStatus === 'connected' ? personalData?.notes : undefined) : workJournal} onSettings={() => setView('settings')} onChat={(attachment) => { setChatAttachment(attachment); setView('chat') }} /></Suspense>}
        {shownView === 'trips' && <TripsView vault={tripVault} currentDay={currentDay} onSettings={() => setView('settings')} />}
        {shownView === 'settings' && <SettingsView domain={activeDomain} accountName={accountName} connectionStatus={connectionStatus} settings={settings} syncing={syncing} syncError={syncError} canInstall={install.canPrompt} onInstall={() => void install.install()} onConnect={connectPersonal} onDisconnect={disconnectPersonal} onSync={() => { void (activeDomain === 'work' ? syncWork() : syncPersonal(personalData, true)) }} onSettings={changeSettings} account={account} onAccount={markAccountChanged} />}
        {shownView === 'task' && <TaskPage key={editingTaskId ?? 'new'} domain={activeDomain} existingTask={tasks.find((task) => task.id === editingTaskId)} guess={editingTaskId ? guesses[editingTaskId] : undefined} projects={activeProjects} onAdd={addTask} onUpdate={updateTask} onDelete={deleteTask} onDone={finishTask} onNotMine={delegateTask} onChat={(attachment) => { setChatAttachment(attachment); if (!docked) setView('chat') }} onCancel={() => { setEditingTaskId(undefined); setView('today') }} />}
      </div>

      {shownView !== 'task' && <nav className="tabbar" aria-label="primary">
        {primaryViews.map(navButton)}
        <Menu label="more" items={moreItems}><Icon name="more" /><span>more</span>{settingsDot && <i className="nav-dot" aria-hidden="true" />}</Menu>
      </nav>}
    </div>

    {docked && <aside className="dock">{chat}</aside>}
    {reviews.overlay}
    <UpdateToast />
  </div>
}
