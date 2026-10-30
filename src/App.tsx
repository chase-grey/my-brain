import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { configuredPersonalClientId, createPersonalGraphData, type PersonalGraphData } from './data/personalGraphData'
import { mergePersonalTasks, personalTaskMetaFile, taskMetadata } from './data/personalTaskSync'
import { demoProviderTasks, demoTaskMetadata } from './demoData'
import { buildNowPlan, isDoneToday, thisWeekCommitments, todayCommitments } from './domain/personalNow'
import { storeLabel, storeOptions, visibleStoreItems } from './domain/shopping'
import { projectTasks } from './domain/taskProjection'
import { buildLifeRing } from './domain/lifeRing'
import { buildWeekReceipt } from './domain/receipt'
import { completedParts, dueParts, toggleHabitPart } from './domain/habits'
import type { Commitment, Domain, Energy, Goal, Habit, HabitEntry, Need, Place, Priority, Project, StoreType, Task } from './domain/types'
import { loadProductState, saveProductState, type ProductState } from './productState'
import { applySettings, companionModelOptions, defaultSettings, loadSettings, saveSettings, themeColorPresets, type AppSettings } from './settings'
import { CompanionView } from './companion/CompanionView'
import { buildPlanSummary, companionGoal, companionTask, summarizeGoal, summarizeProject, summarizeTask, type CompanionActions, type GoalChanges } from './companion/companionTools'

const NotesContext = createContext<(id: string) => void>(() => {})

type View = 'now' | 'plan' | 'inbox' | 'progress' | 'stores' | 'settings' | 'add' | 'companion'
type ConnectionStatus = 'unconfigured' | 'disconnected' | 'connected'
const taskStorageKey = (domain: Domain) => `my-brain.${domain}.tasks.v1`

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const minuteOptions = [30, 60, 120] as const
const energyOptions: { value: Energy; label: string }[] = [
  { value: 'shallow', label: 'Light' },
  { value: 'deep', label: 'Focused' },
  { value: 'errand', label: 'Out' },
]
const placeOptions: { value: Place; label: string; hint: string }[] = [
  { value: 'home', label: 'At home', hint: 'Needs me at home' },
  { value: 'office', label: 'At work', hint: 'Can be done while at work' },
  { value: 'out', label: 'Out & about', hint: 'An errand away from home' },
]
const needOptions: { value: Need; label: string }[] = [
  { value: 'computer', label: 'Laptop' },
  { value: 'phone', label: 'Phone' },
  { value: 'tools', label: 'Tools' },
  { value: 'car', label: 'Car' },
]

function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

function inferredPlace(now = new Date()): Place {
  const weekday = now.getDay()
  const hour = now.getHours()
  return weekday >= 1 && weekday <= 5 && hour >= 9 && hour < 17 ? 'office' : 'home'
}

function duration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`
}

function toggleValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.toLowerCase() : 'sync failed'
}

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
      const loaded = (JSON.parse(stored) as Task[]).filter((task) => task.domain === domain).map((task) => ({
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
  return <Workspace key={domain} activeDomain={domain} onDomain={setDomain} />
}

export function Workspace({ activeDomain, onDomain }: { activeDomain: Domain; onDomain: (domain: Domain) => void }) {
  const [view, setView] = useState<View>('now')
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks(activeDomain))
  const [availableMin, setAvailableMin] = useState<number>(60)
  const [energy, setEnergy] = useState<Energy>('shallow')
  const [placeOverride, setPlaceOverride] = useState<Place | undefined>()
  const [activeStore, setActiveStore] = useState<StoreType>('grocery')
  const [settings, setSettings] = useState(() => loadSettings(activeDomain))
  const [product, setProduct] = useState<ProductState>(() => loadProductState(activeDomain))
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [notesTaskId, setNotesTaskId] = useState<string>()
  const [editingTaskId, setEditingTaskId] = useState<string>()
  const [personalData, setPersonalData] = useState<PersonalGraphData>()
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    configuredPersonalClientId() ? 'disconnected' : 'unconfigured',
  )
  const [accountName, setAccountName] = useState<string>()
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string>()
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

  useEffect(() => {
    try {
      localStorage.setItem(taskStorageKey(activeDomain), JSON.stringify(tasks.filter((task) => task.domain === activeDomain)))
    } catch {
      // Keep the in-memory experience usable if persistence is unavailable.
    }
  }, [tasks])

  useEffect(() => {
    applySettings(settings)
    saveSettings(settings, activeDomain)
  }, [settings])

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
    setView('add')
  }

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

  function addTask(task: Task, triageTask?: Task) {
    if (task.domain !== activeDomain || (triageTask && triageTask.domain !== activeDomain)) return
    insertTask(task, triageTask)
    if (task.storeType) {
      setActiveStore(task.storeType)
      setView('stores')
    } else {
      setView('inbox')
    }
  }

  function insertTask(task: Task, triageTask?: Task) {
    if (task.domain !== activeDomain || (triageTask && triageTask.domain !== activeDomain)) return
    const localNext = [...tasksRef.current, task, ...(triageTask ? [triageTask] : [])]
    commitTasks(localNext)
    if (personalData && connectionStatus === 'connected' && task.domain === 'personal' && !task.recurrence) {
      void (async () => {
        try {
          const listId = await personalData.tasks.defaultListId()
          const created = await personalData.tasks.createTask(listId, task)
          const next = tasksRef.current.map((item) => {
            if (item.id === task.id) return { ...item, ...created, taskId: created.id }
            if (item.triageForTaskId === task.id) return { ...item, triageForTaskId: created.id }
            return item
          })
          commitTasks(next)
          await persistPersonalMetadata(next)
        } catch (error) {
          setSyncError(errorMessage(error))
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

  function addGoal(input: Parameters<CompanionActions['addGoal']>[0]) {
    const goal = companionGoal(activeDomain, input)
    setProduct((current) => ({ ...current, goals: [...current.goals, goal] }))
    productRef.current = { ...productRef.current, goals: [...productRef.current.goals, goal] }
    return summarizeGoal(goal)
  }

  function updateGoal(id: string, changes: GoalChanges) {
    const existing = productRef.current.goals.find((goal) => goal.id === id && goal.domain === activeDomain)
    if (!existing) return undefined
    const revisions = [...existing.revisions]
    if (changes.targetDate !== undefined && changes.targetDate !== existing.targetDate) revisions.push({ on: currentDay, field: 'date', from: existing.targetDate ?? '', to: changes.targetDate })
    if (changes.hoursCommitted !== undefined && changes.hoursCommitted !== existing.hoursCommitted) revisions.push({ on: currentDay, field: 'hours', from: existing.hoursCommitted ?? 0, to: changes.hoursCommitted })
    const updated: Goal = { ...existing, ...changes, revisions }
    const apply = (goals: Goal[]) => goals.map((goal) => goal.id === id ? updated : goal)
    setProduct((current) => ({ ...current, goals: apply(current.goals) }))
    productRef.current = { ...productRef.current, goals: apply(productRef.current.goals) }
    return summarizeGoal(updated)
  }

  const companionActions: CompanionActions = {
    listTasks: (options) => tasksRef.current.filter((task) => task.domain === activeDomain && !task.storeType && (options?.includeCompleted || !isDoneToday(task, currentDay))).map(summarizeTask),
    createTask: (input) => {
      const task = companionTask(activeDomain, input, currentDay)
      insertTask(task)
      return summarizeTask(task)
    },
    completeTask,
    listGoals: () => productRef.current.goals.filter((goal) => goal.domain === activeDomain && goal.status === 'active').map(summarizeGoal),
    addGoal,
    updateGoal,
    listProjects: () => productRef.current.projects.filter((project) => project.domain === activeDomain && project.status === 'active').map(summarizeProject),
    todaySummary: () => buildPlanSummary({ today: currentDay, domain: activeDomain, tasks: tasksRef.current, commitments, weeklyCommitments, plan, goals: productRef.current.goals, projects: productRef.current.projects }),
  }

  function editTask(id: string) {
    setEditingTaskId(id)
    setView('add')
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
  }

  function updateTask(updated: Task) {
    if (updated.domain !== activeDomain) return
    const previous = tasksRef.current.find((task) => task.id === updated.id)
    const next = tasksRef.current.map((task) => {
      if (task.id === updated.id) return updated
      if (task.triageForTaskId === updated.id) return { ...task, completed: true }
      return task
    })
    commitTasks(next)
    void persistPersonalMetadata(next)
    if (personalData && connectionStatus === 'connected' && previous?.domain === 'personal' && previous.domain === 'personal' && previous.providerListId) {
      void personalData.tasks.updateTask(previous, {
        title: updated.title,
        dueDate: updated.dueDate,
      }).catch((error: unknown) => setSyncError(errorMessage(error)))
    }
    setEditingTaskId(undefined)
    setView('inbox')
  }

  function chooseDomain(domain: Domain) {
    onDomain(domain)
  }

  function addStoreItem(task: Task) {
    addTask(task)
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
    if (previous.recurrence) {
      void persistPersonalMetadata(next)
    } else if (personalData && connectionStatus === 'connected' && previous.domain === 'personal' && previous.providerListId) {
      void personalData.tasks.updateTask(previous, { completed: !previous.completed }).catch((error: unknown) => {
        commitTasks(tasksRef.current.map((task) => task.id === id ? previous : task))
        setSyncError(errorMessage(error))
      })
    }
  }

  return (
    <NotesContext.Provider value={setNotesTaskId}>
    <main className="app-shell">
      <section className="app-surface" aria-label="My Brain tasks">
        <aside className="desktop-sidebar">
          <div className="desktop-brand"><span className="brand-mark" aria-hidden="true">M</span><div><strong>My Brain</strong><small>{activeDomain}</small></div></div>
          <DomainSwitch domain={activeDomain} onDomain={chooseDomain} />
          <nav className="desktop-nav" aria-label="Primary navigation">
            <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')} type="button"><span>now</span></button>
            <button className={view === 'plan' ? 'active' : ''} onClick={() => setView('plan')} type="button"><span>plan</span></button>
            <button className={view === 'inbox' ? 'active' : ''} onClick={() => setView('inbox')} type="button"><span>inbox</span></button>
            <button className={view === 'progress' ? 'active' : ''} onClick={() => setView('progress')} type="button"><span>progress</span></button>
            <button className={view === 'companion' ? 'active' : ''} onClick={() => setView('companion')} type="button"><span>companion</span></button>
            <button className={view === 'settings' ? 'active' : ''} onClick={() => setView('settings')} type="button"><span>settings</span></button>
          </nav>
          <div className="sidebar-ledger"><span>{openTasks.length} open</span><span>{duration(openEstimate)}</span></div>
          {installPrompt && <button className="sidebar-install" type="button" onClick={installApp}>install desktop app</button>}
        </aside>
        <div className="workspace">
        <header className="topline">
          <div className="mobile-heading">
            <p className="brand-label">My Brain</p>
            <p className="ledger">{openTasks.length} open · {duration(openEstimate)}</p>
          </div>
          <DomainSwitch domain={activeDomain} onDomain={chooseDomain} />
          <div className="topline-actions">
            {installPrompt && <button className="install-app" type="button" onClick={installApp}>install app</button>}
            {view !== 'add' && <button className="quick-add" type="button" onClick={startAddingTask}><span aria-hidden="true">+</span> add task</button>}
          </div>
        </header>

        <div className={`view-content view-${view}`}>
        {view === 'now' && <DailyNowView availableMin={availableMin} commitments={commitments} weeklyCommitments={weeklyCommitments} currentDay={currentDay} domain={activeDomain} energy={energy} habits={product.habits} habitEntries={product.habitEntries} place={currentPlace} placeOverride={placeOverride} plan={plan} weekPaid={weekPaid} onFloorNight={() => setProduct((current) => ({ ...current, dayOverrides: [...current.dayOverrides, { date: currentDay, domain: activeDomain, kind: 'floor' }] }))} onHabitPart={(habitId, partId) => setProduct((current) => ({ ...current, habitEntries: toggleHabitPart(current.habitEntries, habitId, partId, currentDay) }))} onStrategic={(minutes) => setProduct((current) => ({ ...current, activities: [...current.activities, { id: crypto.randomUUID(), domain: activeDomain, kind: 'strategic', occurredAt: new Date().toISOString(), minutes }] }))} onMinutes={setAvailableMin} onEnergy={setEnergy} onPlaceOverride={setPlaceOverride} onToggle={toggleComplete} />}
        {view === 'plan' && <PlanView domain={activeDomain} product={product} tasks={tasks} onProduct={setProduct} onStores={() => setView('stores')} />}
        {view === 'inbox' && <InboxView domain={activeDomain} tasks={tasks} onMine={editTask} onNotMine={delegateTask} onAdd={startAddingTask} />}
        {view === 'progress' && <ProgressView domain={activeDomain} product={product} onProduct={setProduct} />}
        {view === 'stores' && <StoreLists activeStore={activeStore} tasks={tasks} onStore={setActiveStore} onToggle={toggleComplete} onAdd={addStoreItem} />}
        {view === 'companion' && <CompanionView domain={activeDomain} settings={settings} actions={companionActions} summary={companionActions.todaySummary()} />}
        {view === 'settings' && <SettingsView domain={activeDomain} accountName={accountName} connectionStatus={connectionStatus} settings={settings} syncing={syncing} syncError={syncError} onConnect={connectPersonal} onDisconnect={disconnectPersonal} onSync={() => syncPersonal()} onSettings={setSettings} />}
        {view === 'add' && <AddTask key={editingTaskId ?? 'new'} domain={activeDomain} existingTask={tasks.find((task) => task.id === editingTaskId)} onAdd={addTask} onUpdate={updateTask} onCancel={() => { setEditingTaskId(undefined); setView('inbox') }} />}
        </div>

        {view !== 'add' && <nav className="tabbar" aria-label="Primary navigation">
          <button className={view === 'now' ? 'active' : ''} onClick={() => setView('now')} type="button">now</button>
          <button className={view === 'plan' ? 'active' : ''} onClick={() => setView('plan')} type="button">plan</button>
          <button className={view === 'inbox' ? 'active' : ''} onClick={() => setView('inbox')} type="button">inbox</button>
          <button className={view === 'progress' ? 'active' : ''} onClick={() => setView('progress')} type="button">progress</button>
          <button className={view === 'companion' ? 'active' : ''} onClick={() => setView('companion')} type="button">companion</button>
        </nav>}
        </div>
      </section>
    </main>
    {notesTaskId && tasks.find((task) => task.id === notesTaskId) && <TaskNotesEditor key={notesTaskId} task={tasks.find((task) => task.id === notesTaskId)!} onClose={() => setNotesTaskId(undefined)} onSave={(notes) => {
      const next = tasksRef.current.map((task) => task.id === notesTaskId ? { ...task, notes } : task)
      commitTasks(next)
      void persistPersonalMetadata(next)
      setNotesTaskId(undefined)
    }} />}
    </NotesContext.Provider>
  )
}

function NotesButton({ task }: { task: Task }) {
  const openNotes = useContext(NotesContext)
  return <button className="task-notes-button" type="button" onClick={() => openNotes(task.id)} aria-label={`notes for ${task.title}`}>{task.notes ? 'notes' : 'add notes'}</button>
}

function TaskNotesEditor({ task, onSave, onClose }: { task: Task; onSave: (notes: string) => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [notes, setNotes] = useState(task.notes ?? '')
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog className="task-notes-dialog" ref={dialog} aria-labelledby="notes-title" onCancel={onClose} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); onSave(notes) }}>
      <h2 id="notes-title">{task.title}</h2>
      <label className="field-label">notes<textarea autoFocus rows={8} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      <div className="form-actions"><button className="primary-action" type="submit">save notes</button><button className="secondary-action" type="button" onClick={onClose}>cancel</button></div>
    </form>
  </dialog>
}

function DomainSwitch({ domain, onDomain }: { domain: Domain; onDomain: (domain: Domain) => void }) {
  return <div className="domain-switch" aria-label="task space">
    {(['personal', 'work'] as const).map((item) => <button aria-pressed={domain === item} className={domain === item ? 'selected' : ''} key={item} onClick={() => onDomain(item)} type="button">{item}</button>)}
  </div>
}

function PlanView({ domain, product, tasks, onProduct, onStores }: {
  domain: Domain
  product: ProductState
  tasks: Task[]
  onProduct: React.Dispatch<React.SetStateAction<ProductState>>
  onStores: () => void
}) {
  const [goalTitle, setGoalTitle] = useState('')
  const [projectTitle, setProjectTitle] = useState('')
  const [projectMode, setProjectMode] = useState('')
  const [targetMin, setTargetMin] = useState(240)
  const [ceilingMin, setCeilingMin] = useState(360)
  const goals = product.goals.filter((goal) => goal.domain === domain && goal.status === 'active')
  const projects = product.projects.filter((project) => project.domain === domain && project.status === 'active')
  const waiting = product.delegations.filter((item) => item.domain === domain && item.status !== 'delivered')
  const commitment = [...product.commitments].reverse().find((item) => item.domain === domain)

  function addGoal(event: React.FormEvent): void {
    event.preventDefault()
    const title = goalTitle.trim()
    if (!title) return
    const goal: Goal = { id: crypto.randomUUID(), domain, horizon: 'season', title, funded: true, status: 'active', revisions: [] }
    onProduct((current) => ({ ...current, goals: [...current.goals, goal] }))
    setGoalTitle('')
  }

  function addProject(event: React.FormEvent): void {
    event.preventDefault()
    const title = projectTitle.trim()
    const mode = projectMode.trim()
    if (!title || !mode) return
    const project: Project = { id: crypto.randomUUID(), domain, title, status: 'active', rhythm: 'pace', drive: 'intrinsic', mode }
    onProduct((current) => ({ ...current, projects: [...current.projects, project] }))
    setProjectTitle('')
    setProjectMode('')
  }

  function saveCommitment(): void {
    const start = new Date()
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const item: Commitment = {
      weekStart: start.toLocaleDateString('en-CA'), domain, targetMin: Math.min(targetMin, ceilingMin),
      strategicMin: 0, habitDaysRequired: 0, maintenance: [], halfTargetMin: Math.ceil(Math.min(targetMin, ceilingMin) / 2), ceilingMin,
    }
    onProduct((current) => ({ ...current, commitments: [...current.commitments.filter((existing) => existing.weekStart !== item.weekStart || existing.domain !== domain), item] }))
  }

  return <section className="list-view" aria-labelledby="plan-title">
    <div className="section-heading"><h1 id="plan-title">plan</h1></div>
    <section className="today-card">
      <div className="today-card-heading"><h2>this week</h2><span>{commitment ? `${duration(commitment.targetMin)}` : 'open'}</span></div>
      <div className="field-pair">
        <label className="field-label">target<input min="0" step="30" type="number" value={targetMin} onChange={(event) => setTargetMin(Number(event.target.value))} /></label>
        <label className="field-label">ceiling<input min="0" step="30" type="number" value={ceilingMin} onChange={(event) => setCeilingMin(Number(event.target.value))} /></label>
      </div>
      <button className="primary-action" type="button" onClick={saveCommitment}>set week</button>
    </section>
    <section className="form-section">
      <h2>goals</h2>
      {goals.map((goal) => <p key={goal.id}>{goal.title}</p>)}
      <form className="quick-item" onSubmit={addGoal}><input aria-label="goal" placeholder="goal" value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} /><button disabled={!goalTitle.trim()}>add</button></form>
    </section>
    <section className="form-section">
      <h2>projects</h2>
      {projects.map((project) => {
        const projectTasks = tasks.filter((task) => task.projectId === project.id)
        const remaining = projectTasks.filter((task) => !task.completed).reduce((sum, task) => sum + task.estimateMin, 0)
        return <div className="store-heading" key={project.id}><div><h2>{project.title}</h2><p>{project.mode}</p></div><span>{duration(remaining)}</span></div>
      })}
      <form onSubmit={addProject}><div className="field-pair"><label className="field-label">project<input value={projectTitle} onChange={(event) => setProjectTitle(event.target.value)} /></label><label className="field-label">mode<input value={projectMode} onChange={(event) => setProjectMode(event.target.value)} /></label></div><button className="primary-action" disabled={!projectTitle.trim() || !projectMode.trim()}>add project</button></form>
    </section>
    <section className="form-section"><div className="store-heading"><h2>waiting</h2><span>{waiting.length}</span></div>{waiting.map((item) => <div className="store-heading" key={item.id}><div><p>{item.title}</p><small>{item.assignee || 'unassigned'}</small></div><button type="button" onClick={() => onProduct((current) => ({ ...current, delegations: current.delegations.map((entry) => entry.id === item.id ? { ...entry, status: 'delivered' } : entry) }))}>delivered</button></div>)}</section>
    {domain === 'personal' && <button className="secondary-action" type="button" onClick={onStores}>stores</button>}
  </section>
}

function InboxView({ domain, tasks, onMine, onNotMine, onAdd }: {
  domain: Domain
  tasks: Task[]
  onMine: (id: string) => void
  onNotMine: (id: string) => void
  onAdd: () => void
}) {
  const inbox = tasks.filter((task) => task.domain === domain && task.metadataComplete === false && !task.completed)
  const task = inbox[0]
  return <section className="list-view" aria-labelledby="inbox-title">
    <div className="section-heading"><h1 id="inbox-title">inbox</h1></div>
    {task ? <article className="plan-card"><p className="eyebrow">{inbox.length} to triage</p><h2>{task.title}</h2><NotesButton task={task} /><div className="form-actions"><button className="primary-action" type="button" onClick={() => onMine(task.id)}>mine</button><button className="secondary-action" type="button" onClick={() => onNotMine(task.id)}>not mine</button></div></article> : <div className="list-empty"><p>inbox zero</p><button type="button" onClick={onAdd}>add task</button></div>}
  </section>
}

function ProgressView({ domain, product, onProduct }: {
  domain: Domain
  product: ProductState
  onProduct: React.Dispatch<React.SetStateAction<ProductState>>
}) {
  const [restRating, setRestRating] = useState(5)
  const [person, setPerson] = useState('')
  const [money, setMoney] = useState({ netWorth: 0, homeRemaining: 0, carRemaining: 0, incomeMonthly: 0, spendingMonthly: 0 })
  const ring = buildLifeRing(product.ringEvidence, product.ringCommitments, today())
  const commitment = [...product.commitments].reverse().find((item) => item.domain === domain)
  const receipt = commitment ? buildWeekReceipt(commitment, product.activities.filter((item) => item.domain === domain), product.dayOverrides) : undefined
  return <section className="list-view" aria-labelledby="progress-title">
    <div className="section-heading"><h1 id="progress-title">progress</h1></div>
    {domain === 'personal' && <section className="today-card">
      <h2>life ring</h2>
      <div className="ring-legend">{ring.map((arc) => <div className="fit-line" key={arc.domain}><span>{arc.domain}</span><span>{arc.fill === undefined ? arc.state : `${Math.round(arc.fill * 100)}%`}</span>{domain === 'personal' && <input aria-label={`${arc.domain} 28-day commitment`} min="0" type="number" value={product.ringCommitments.find((item) => item.domain === arc.domain)?.commitment28 ?? 0} onChange={(event) => onProduct((current) => ({ ...current, ringCommitments: [...current.ringCommitments.filter((item) => item.domain !== arc.domain), { domain: arc.domain, commitment28: Number(event.target.value) }] }))} />}</div>)}</div>
    </section>}
    {receipt && <section className="today-card"><div className="today-card-heading"><h2>week receipt</h2><span>{receipt.paid ? 'paid' : duration(receipt.remainingMin)}</span></div><div className="fit-line"><span>{duration(receipt.clearedMin)} cleared</span><span>{duration(receipt.plannedMin)} planned</span></div></section>}
    {domain === 'personal' && <>
      <section className="form-section"><h2>connection</h2><form className="quick-item" onSubmit={(event) => { event.preventDefault(); const name = person.trim(); if (!name) return; onProduct((current) => ({ ...current, people: [...current.people.filter((item) => item.displayName !== name), { id: crypto.randomUUID(), displayName: name, lastSeenOn: today() }], ringEvidence: [...current.ringEvidence, { domain: 'connection', on: today(), value: 1 }], activities: [...current.activities, { id: crypto.randomUUID(), domain: 'personal', kind: 'connection', occurredAt: new Date().toISOString(), withPeople: [name] }] })); setPerson('') }}><input aria-label="who" placeholder="who" value={person} onChange={(event) => setPerson(event.target.value)} /><button disabled={!person.trim()}>saw someone</button></form></section>
      <section className="form-section"><h2>money</h2><div className="field-pair">{(Object.keys(money) as (keyof typeof money)[]).map((key) => <label className="field-label" key={key}>{key.replace(/([A-Z])/g, ' $1').toLowerCase()}<input type="number" value={money[key]} onChange={(event) => setMoney((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}</div><button className="primary-action" type="button" onClick={() => onProduct((current) => ({ ...current, moneySnapshots: [...current.moneySnapshots.filter((item) => item.month !== today().slice(0, 7)), { month: today().slice(0, 7), ...money }], ringEvidence: [...current.ringEvidence, { domain: 'money', on: today(), value: 1 }] }))}>save month</button></section>
      <section className="form-section"><h2>play & rest</h2><label className="field-label">felt sufficiency<input min="1" max="10" type="range" value={restRating} onChange={(event) => setRestRating(Number(event.target.value))} /></label><button className="primary-action" type="button" onClick={() => { const end = today(); const startDate = new Date(`${end}T00:00:00`); startDate.setDate(startDate.getDate() - 27); onProduct((current) => ({ ...current, restCheckIns: [...current.restCheckIns, { id: crypto.randomUUID(), periodStart: startDate.toLocaleDateString('en-CA'), periodEnd: end, rating: restRating as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10, createdAt: new Date().toISOString() }], ringEvidence: [...current.ringEvidence, { domain: 'rest', on: end, value: restRating }] })) }}>save {restRating}</button></section>
    </>}
  </section>
}

function SettingsView({ domain, accountName, connectionStatus, settings, syncing, syncError, onConnect, onDisconnect, onSync, onSettings }: {
  domain: Domain
  accountName?: string
  connectionStatus: ConnectionStatus
  syncing: boolean
  syncError?: string
  settings: AppSettings
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onSync: () => void
  onSettings: React.Dispatch<React.SetStateAction<AppSettings>>
}) {
  const themeColor = settings.themeColor
  return <section className="settings-view" aria-labelledby="settings-title">
    <div className="section-heading"><h1 id="settings-title">settings</h1></div>
    {domain === 'personal' && <fieldset className="form-section">
      <legend>microsoft account</legend>
      {connectionStatus === 'connected' ? <>
        <p className="field-help">{accountName}</p>
        <div className="form-actions">
          <button className="primary-action" disabled={syncing} type="button" onClick={onSync}>{syncing ? 'syncing' : 'sync now'}</button>
          <button className="secondary-action" disabled={syncing} type="button" onClick={() => void onDisconnect()}>disconnect</button>
        </div>
      </> : <button className="primary-action" disabled={syncing || connectionStatus === 'unconfigured'} type="button" onClick={() => void onConnect()}>{syncing ? 'connecting' : 'connect microsoft'}</button>}
      {connectionStatus === 'unconfigured' && <p className="field-help">add the microsoft app id to connect</p>}
      {syncError && <p className="field-help" role="alert">{syncError}</p>}
    </fieldset>}
    {domain === 'personal' ? <fieldset className="form-section">
      <legend>companion</legend>
      <label className="field-label">anthropic api key<input type="password" autoComplete="off" value={settings.anthropicApiKey} onChange={(event) => onSettings((current) => ({ ...current, anthropicApiKey: event.target.value }))} /></label>
      <label className="field-label">model<select value={settings.anthropicModel} onChange={(event) => onSettings((current) => ({ ...current, anthropicModel: event.target.value }))}>{companionModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
      <div className="field-pair">
        <label className="field-label">github repo<input autoComplete="off" value={settings.githubRepo} onChange={(event) => onSettings((current) => ({ ...current, githubRepo: event.target.value }))} placeholder="owner/name" /></label>
        <label className="field-label">branch<input autoComplete="off" value={settings.vaultBranch} onChange={(event) => onSettings((current) => ({ ...current, vaultBranch: event.target.value }))} /></label>
      </div>
      <label className="field-label">github token<input type="password" autoComplete="off" value={settings.githubToken} onChange={(event) => onSettings((current) => ({ ...current, githubToken: event.target.value }))} /></label>
    </fieldset> : <fieldset className="form-section">
      <legend>companion</legend>
      <p className="field-help">claude code on this pc, through the work bridge</p>
    </fieldset>}
    <fieldset className="form-section">
      <legend>capacity</legend>
      <div className="field-pair">{domain === 'work' ? <label className="field-label">workday minutes<input min="0" step="30" type="number" value={settings.workdayCapacityMin} onChange={(event) => onSettings((current) => ({ ...current, workdayCapacityMin: Number(event.target.value) }))} /></label> : <label className="field-label">personal weekly ceiling<input min="0" step="30" type="number" value={settings.personalWeeklyCeilingMin} onChange={(event) => onSettings((current) => ({ ...current, personalWeeklyCeilingMin: Number(event.target.value) }))} /></label>}</div>
      <label className="field-label">floors<input value={settings.floors.join(', ')} onChange={(event) => onSettings((current) => ({ ...current, floors: event.target.value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 4) }))} placeholder={domain === 'work' ? 'email, expenses' : 'floors'} /></label>
    </fieldset>
    <fieldset className="form-section theme-setting">
      <legend>theme color</legend>
      <label className="color-picker">
        <input type="color" value={themeColor} onChange={(event) => onSettings((current) => ({ ...current, themeColor: event.target.value }))} />
        <span><strong>custom color</strong><small>{themeColor.toUpperCase()}</small></span>
      </label>
      <div className="color-presets" aria-label="theme color presets">
        {themeColorPresets.map((preset) => <button
          aria-label={`${preset.label} theme`}
          aria-pressed={themeColor === preset.value}
          className={themeColor === preset.value ? 'selected' : ''}
          key={preset.value}
          onClick={() => onSettings((current) => ({ ...current, themeColor: preset.value }))}
          style={{ '--swatch-color': preset.value } as React.CSSProperties}
          type="button"
        ><span aria-hidden="true" />{preset.label.toLowerCase()}</button>)}
      </div>
      {themeColor !== defaultSettings.themeColor && <button className="reset-theme" type="button" onClick={() => onSettings((current) => ({ ...current, themeColor: defaultSettings.themeColor }))}>reset to purple</button>}
    </fieldset>
  </section>
}

function commitmentHint(task: Task, currentDay: string, place: Place): string {
  if (isDoneToday(task, currentDay)) return 'Done today'
  if (task.place?.length && !task.place.includes(place)) return task.place.includes('home') ? 'When you’re home' : 'When you’re at work'
  if (task.dueDate && task.dueDate < currentDay) return 'Overdue · do today'
  if (task.timeWindow === 'morning') return new Date().getHours() >= 17 ? 'Missed this morning · still worth doing' : 'This morning'
  if (task.timeWindow === 'evening') return 'This evening'
  return 'Any time today'
}

function weeklyCommitmentHint(task: Task): string {
  if (!task.dueDate) return ''
  return `due ${new Date(`${task.dueDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).toLowerCase()}`
}

function HabitCard({ date, entries, habits, onToggle }: {
  date: string
  entries: HabitEntry[]
  habits: Habit[]
  onToggle: (habitId: string, partId: string) => void
}) {
  if (!habits.length) return null
  return <section className="habit-card" aria-labelledby="habit-title">
    <div className="today-card-heading"><h2 id="habit-title">personal care</h2></div>
    <ul className="habit-list">{habits.map((habit) => {
      const completed = new Set(completedParts(entries, habit.id, date))
      return <li key={habit.id}><div className="habit-heading"><p>{habit.title}</p><small>{habit.timeWindow}</small></div><div className="habit-parts">{dueParts(habit, date).map((part) => {
        const done = completed.has(part.id)
        return <button aria-pressed={done} className={done ? 'is-complete' : ''} key={part.id} onClick={() => onToggle(habit.id, part.id)} type="button"><span aria-hidden="true" />{part.title}</button>
      })}</div></li>
    })}</ul>
  </section>
}

function DailyNowView({ availableMin, commitments, weeklyCommitments, currentDay, domain, energy, habits, habitEntries, place, placeOverride, plan, weekPaid, onFloorNight, onHabitPart, onStrategic, onMinutes, onEnergy, onPlaceOverride, onToggle }: {
  availableMin: number
  commitments: Task[]
  weeklyCommitments: Task[]
  currentDay: string
  domain: Domain
  energy: Energy
  habits: Habit[]
  habitEntries: HabitEntry[]
  place: Place
  placeOverride?: Place
  plan: ReturnType<typeof buildNowPlan>
  weekPaid: boolean
  onFloorNight: () => void
  onHabitPart: (habitId: string, partId: string) => void
  onStrategic: (minutes: number) => void
  onMinutes: (minutes: number) => void
  onEnergy: (energy: Energy) => void
  onPlaceOverride: (place?: Place) => void
  onToggle: (id: string) => void
}) {
  const remaining = commitments.filter((task) => !isDoneToday(task, currentDay)).length
  const personalHabits = domain === 'personal' ? habits.filter((habit) => habit.domain === 'personal') : []
  if (weekPaid) return <><section className="now-heading"><div><h1>now</h1></div></section><HabitCard date={currentDay} entries={habitEntries} habits={personalHabits} onToggle={onHabitPart} /><article className="plan-card"><h2>the week is paid</h2></article></>
  return <>
    <section className="now-heading" aria-labelledby="today-title">
      <div><p className="eyebrow">{domain} · now</p><h1 id="today-title">today</h1></div>
      <details className="location-menu">
        <summary aria-label="Change current location"><span>{place === 'office' ? 'At work' : 'At home'}</span><b aria-hidden="true">•••</b></summary>
        <div className="location-popover">
          <p>Where are you?</p>
          <button className={placeOverride === undefined ? 'selected' : ''} type="button" onClick={() => onPlaceOverride(undefined)}>Automatic <small>Weekdays, 9–5</small></button>
          <button className={placeOverride === 'home' ? 'selected' : ''} type="button" onClick={() => onPlaceOverride('home')}>At home</button>
          <button className={placeOverride === 'office' ? 'selected' : ''} type="button" onClick={() => onPlaceOverride('office')}>At work</button>
        </div>
      </details>
    </section>
    <section className="today-card" aria-label="Must do today">
      <div className="today-card-heading"><div><p className="eyebrow">Must happen today</p><h2>{remaining ? `${remaining} still to do` : 'You’re clear'}</h2></div><span>{commitments.length - remaining}/{commitments.length}</span></div>
      {commitments.length ? <ul className="commitment-list">{commitments.map((task) => {
        const done = isDoneToday(task, currentDay)
        return <li className={done ? 'is-complete' : ''} key={task.id}><button className="complete-toggle" type="button" onClick={() => onToggle(task.id)} aria-label={`${done ? 'Undo' : 'Complete'} ${task.title}`}><span /></button><div><p>{task.title}</p><NotesButton task={task} /><small>{commitmentHint(task, currentDay, place)}</small></div><span>{duration(task.estimateMin)}</span></li>
      })}</ul> : <p className="empty-copy">Nothing is required today.</p>}
    </section>
    <HabitCard date={currentDay} entries={habitEntries} habits={personalHabits} onToggle={onHabitPart} />
    <section className="week-card" aria-labelledby="week-title">
      <div className="today-card-heading"><div><p className="eyebrow">next up</p><h2 id="week-title">this week</h2></div><span>{weeklyCommitments.length}</span></div>
      {weeklyCommitments.length ? <ul className="commitment-list">{weeklyCommitments.map((task) => <li key={task.id}>
        <button className="complete-toggle" type="button" onClick={() => onToggle(task.id)} aria-label={`complete ${task.title}`}><span /></button>
        <div><p>{task.title}</p><NotesButton task={task} /><small>{weeklyCommitmentHint(task)}</small></div><span>{duration(task.estimateMin)}</span>
      </li>)}</ul> : <p className="empty-copy">nothing else due this week.</p>}
    </section>
    <section className="picker" aria-labelledby="picker-title">
      <p className="eyebrow">after this week</p><h1 id="picker-title">extra time</h1>
      <div className="segmented" aria-label="Time available">{minuteOptions.map((minutes) => <button className={availableMin === minutes ? 'selected' : ''} key={minutes} onClick={() => onMinutes(minutes)} type="button">{duration(minutes)}</button>)}</div>
      <div className="energy-row" aria-label="Energy">{energyOptions.map((option) => <button className={energy === option.value ? 'selected' : ''} key={option.value} onClick={() => onEnergy(option.value)} type="button">{option.label}</button>)}</div>
      <div className="energy-row"><button type="button" onClick={onFloorNight}>floor night</button>{[30, 60, 90].map((minutes) => <button key={minutes} type="button" onClick={() => onStrategic(minutes)}>strategic {duration(minutes)}</button>)}</div>
    </section>
    <article className="plan-card" aria-live="polite">
      <div className="card-rule" /><p className="eyebrow">suggested next · {energy === 'errand' ? 'out' : place === 'office' ? domain === 'personal' ? 'laptop or phone' : 'at work' : 'at home'}</p>
      <h2>{plan.tasks.length ? `${plan.tasks.length} things within reach` : 'Nothing honest fits'}</h2>
      {plan.tasks.length ? <ul className="task-set">{plan.tasks.map((task) => <li key={task.id}><div><span>{task.title}</span><NotesButton task={task} /></div><span>{duration(task.estimateMin)}</span></li>)}</ul> : <p className="empty-copy">Change the window or energy. The backlog stays safe.</p>}
      <div className="fit-line"><span>{duration(plan.totalMin)} planned</span><span>{duration(plan.availableMin - plan.totalMin)} left open</span></div><div className="fit-track" aria-hidden="true"><div style={{ width: `${(plan.totalMin / Math.max(plan.availableMin, 1)) * 100}%` }} /></div>
      <button className="primary-action" disabled={!plan.tasks.length} type="button">Take this set</button>
    </article>
  </>
}

function StoreLists({ activeStore, tasks, onStore, onToggle, onAdd }: {
  activeStore: StoreType
  tasks: Task[]
  onStore: (store: StoreType) => void
  onToggle: (id: string) => void
  onAdd: (task: Task) => void
}) {
  const [title, setTitle] = useState('')
  const items = visibleStoreItems(tasks, activeStore)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const id = globalThis.crypto?.randomUUID?.() ?? `item-${Date.now()}`
    const isOnline = activeStore === 'amazon'
    onAdd({
      id, taskId: id, domain: 'personal', title: cleanTitle, completed: false,
      estimateMin: 5, originalEstimateMin: 5, priority: 3,
      energy: isOnline ? 'shallow' : 'errand',
      place: isOnline ? ['home'] : ['out'],
      needs: isOnline ? ['computer'] : ['store'], storeType: activeStore,
      pinned: false, carries: 0, metadataComplete: true,
    })
    setTitle('')
  }

  const checkedCount = items.filter((item) => item.completed).length
  return <section className="store-view" aria-labelledby="store-title">
    <div className="section-heading"><p className="eyebrow">Running pickup lists</p><h1 id="store-title">Stores</h1></div>
    <div className="store-tabs" aria-label="Choose a store">{storeOptions.map((store) => {
      const count = visibleStoreItems(tasks, store.value).filter((item) => !item.completed).length
      return <button className={activeStore === store.value ? 'selected' : ''} key={store.value} onClick={() => onStore(store.value)} type="button"><span>{store.shortLabel}</span><small>{count}</small></button>
    })}</div>
    <div className="store-heading"><div><h2>{storeLabel(activeStore)}</h2><p>{activeStore === 'grocery' ? 'Checked items stay here for next time.' : 'Bought items leave this list.'}</p></div>{activeStore === 'grocery' && checkedCount > 0 && <span>{checkedCount} stocked</span>}</div>
    <form className="quick-item" onSubmit={submit}><input aria-label={`Add item to ${storeLabel(activeStore)}`} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`Add to ${storeLabel(activeStore)}`} /><button type="submit" disabled={!title.trim()}>Add</button></form>
    {items.length ? <ul className="shopping-list">{items.map((item) => <li className={item.completed ? 'is-complete' : ''} key={item.id}><button className="complete-toggle" type="button" onClick={() => onToggle(item.id)} aria-label={`${item.completed ? 'Need again' : 'Mark bought'}: ${item.title}`}><span /></button><span>{item.title}</span><NotesButton task={item} /></li>)}</ul> : <div className="list-empty"><p>{activeStore === 'grocery' ? 'No grocery items yet.' : `Nothing to buy from ${storeLabel(activeStore)}.`}</p></div>}
  </section>
}

function AddTask({ domain: initialDomain, existingTask, onAdd, onUpdate, onCancel }: {
  domain: Domain
  existingTask?: Task
  onAdd: (task: Task, triageTask?: Task) => void
  onUpdate: (task: Task) => void
  onCancel: () => void
}) {
  const domain = existingTask?.domain ?? initialDomain
  const [title, setTitle] = useState(existingTask?.title ?? '')
  const [notes, setNotes] = useState(existingTask?.notes ?? '')
  const [dueDate, setDueDate] = useState(existingTask?.dueDate ?? '')
  const [hiddenUntil, setHiddenUntil] = useState(existingTask?.hiddenUntil ?? '')
  const [estimateMin, setEstimateMin] = useState(existingTask?.estimateMin ?? 30)
  const [priority, setPriority] = useState<Priority>(existingTask?.priority ?? 3)
  const [energy, setEnergy] = useState<Energy>(existingTask?.energy ?? 'shallow')
  const [places, setPlaces] = useState<Place[]>(existingTask?.place ?? (domain === 'work' ? ['office'] : []))
  const [needs, setNeeds] = useState<Need[]>(existingTask?.needs ?? (domain === 'work' ? ['computer'] : []))
  const [storeType, setStoreType] = useState<StoreType | ''>(existingTask?.storeType ?? '')
  const [showDetails, setShowDetails] = useState(Boolean(existingTask))

  function chooseStore(next: StoreType | '') {
    setStoreType(next)
    if (next === 'amazon') {
      setPlaces((current) => current.includes('home') ? current.filter((place) => place !== 'out') : [...current.filter((place) => place !== 'out'), 'home'])
      setNeeds((current) => current.includes('computer') ? current.filter((need) => need !== 'store') : [...current.filter((need) => need !== 'store'), 'computer'])
      setEnergy('shallow')
    } else if (next) {
      setPlaces((current) => current.includes('out') ? current : [...current, 'out'])
      setNeeds((current) => current.includes('store') ? current : [...current, 'store'])
      setEnergy('errand')
    } else {
      setNeeds((current) => current.filter((need) => need !== 'store'))
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const cleanTitle = title.trim()
    if (!cleanTitle) return
    const id = existingTask?.id ?? globalThis.crypto?.randomUUID?.() ?? `task-${Date.now()}`
    const task: Task = { ...existingTask, id, taskId: id, domain, title: cleanTitle, notes, dueDate: dueDate || undefined, hiddenUntil: hiddenUntil || undefined, completed: existingTask?.completed ?? false,
      estimateMin, originalEstimateMin: estimateMin, priority, planDate: today(), energy,
      place: domain === 'personal' && places.length ? places : domain === 'work' ? ['office'] : undefined,
      needs: domain === 'personal' && needs.length ? needs : domain === 'work' ? ['computer'] : undefined,
      storeType: domain === 'personal' && storeType ? storeType : undefined,
      pinned: existingTask?.pinned ?? false, carries: existingTask?.carries ?? 0, metadataComplete: showDetails,
    }
    if (existingTask) {
      onUpdate({ ...task, metadataComplete: true })
      return
    }
    if (showDetails) {
      onAdd(task)
      return
    }
    const triageId = globalThis.crypto?.randomUUID?.() ?? `triage-${Date.now()}`
    const triageTask: Task = {
      id: triageId, taskId: triageId, domain, title: `triage: ${task.title}`, dueDate: today(), completed: false,
      estimateMin: 5, originalEstimateMin: 5, priority: 2, planDate: today(), energy: 'shallow',
      place: domain === 'work' ? ['office'] : undefined, needs: domain === 'work' ? ['computer'] : undefined,
      pinned: false, carries: 0, metadataComplete: true, triageForTaskId: task.id,
    }
    onAdd({ ...task, planDate: undefined, metadataComplete: false }, triageTask)
  }

  return <section className="add-view" aria-labelledby="add-title">
    <button className="back-button" type="button" onClick={onCancel}>← cancel</button>
    <div className="section-heading"><h1 id="add-title">{existingTask ? 'add details' : 'add a task'}</h1></div>
    <form onSubmit={submit}>
      <div className="quick-capture"><label className="field-label">task<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="what needs doing?" required /></label></div>

      <label className="field-label capture-notes">notes<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>

      {showDetails && <>
      <fieldset className="form-section"><legend>when</legend><div className="field-pair"><label className="field-label">available from<input type="date" value={hiddenUntil} onChange={(event) => setHiddenUntil(event.target.value)} /></label><label className="field-label">due date<input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label></div></fieldset>

      {domain === 'personal' && <fieldset className="form-section"><legend>2. where can this happen?</legend><div className="choice-cards">{placeOptions.map((option) => <button className={places.includes(option.value) ? 'selected' : ''} key={option.value} type="button" onClick={() => setPlaces((current) => toggleValue(current, option.value))}><strong>{option.label.toLowerCase()}</strong><small>{option.hint.toLowerCase()}</small></button>)}</div><label className="field-label select-label">shopping destination<select value={storeType} onChange={(event) => chooseStore(event.target.value as StoreType | '')}><option value="">not a shopping task</option>{storeOptions.map((store) => <option key={store.value} value={store.value}>{store.label}</option>)}</select></label></fieldset>}

      {domain === 'personal' && <fieldset className="form-section"><legend>3. what does it need?</legend><div className="chip-grid">{needOptions.map((option) => <button className={needs.includes(option.value) ? 'selected' : ''} key={option.value} type="button" onClick={() => setNeeds((current) => toggleValue(current, option.value))}>{option.label.toLowerCase()}</button>)}</div></fieldset>}

      <fieldset className="form-section"><legend>{domain === 'personal' ? '4' : '2'}. details</legend><div className="field-pair"><label className="field-label">time needed<select value={estimateMin} onChange={(event) => setEstimateMin(Number(event.target.value))}>{[5, 15, 30, 45, 60, 90, 120].map((minutes) => <option key={minutes} value={minutes}>{duration(minutes)}</option>)}</select></label><label className="field-label">priority<select value={priority} onChange={(event) => setPriority(Number(event.target.value) as Priority)}><option value="1">critical</option><option value="2">high</option><option value="3">normal</option><option value="4">low</option></select></label></div>{domain === 'personal' && <><p className="field-label standalone-label">energy</p><div className="chip-grid three-up">{energyOptions.map((option) => <button className={energy === option.value ? 'selected' : ''} key={option.value} type="button" onClick={() => setEnergy(option.value)}>{option.label.toLowerCase()}</button>)}</div></>}</fieldset>
      </>}
      <div className="form-actions"><button className="primary-action" type="submit" disabled={!title.trim()}>{existingTask ? 'save details' : 'add task'}</button>{!showDetails && <button className="secondary-action add-details-action" type="button" onClick={() => setShowDetails(true)}>add details</button>}<button className="secondary-action" type="button" onClick={onCancel}>cancel</button></div>
    </form>
  </section>
}
