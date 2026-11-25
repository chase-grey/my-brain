/**
 * `npm run autofix` — one watcher per app, side by side: my-brain, my-mail and
 * workout-tracker. Each is that repo's own scripts/autofix.mjs, run in its own
 * checkout, so each keeps its own lock, worktree and logs. This file only starts
 * them, names their lines, and brings one back if it dies.
 *
 * A watcher that exits is restarted after a minute. One that keeps refusing to
 * start (a token that cannot write to that repo yet, a second watcher already on
 * that checkout) is tried every ten minutes from then on, so fixing the cause is
 * enough and nothing here needs restarting.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const projects = path.resolve(import.meta.dirname, '..', '..')
const apps = ['my-brain', 'my-mail', 'workout-tracker'].filter((app) => existsSync(path.join(projects, app, 'scripts', 'autofix.mjs')))
const RESTART_MS = 60_000
const SLOW_RESTART_MS = 10 * 60_000
// How many quick tries a watcher gets before it drops to the slow ones.
const QUICK_RESTARTS = 5
const children = new Map()
let stopping = false

function start(app, restarts = 0) {
  const child = spawn(process.execPath, ['scripts/autofix.mjs'], { cwd: path.join(projects, app), stdio: ['ignore', 'pipe', 'pipe'] })
  children.set(app, child)
  const started = Date.now()
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    let rest = ''
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) console.log(`[${app}] ${line.trimEnd()}`)
    })
    stream.on('end', () => { if (rest.trim()) console.log(`[${app}] ${rest.trimEnd()}`) })
  }
  child.on('close', (code) => {
    children.delete(app)
    if (stopping) return
    // A watcher that ran for an hour before it died gets a fresh count.
    const count = Date.now() - started > 60 * 60_000 ? 0 : restarts
    const slow = count >= QUICK_RESTARTS
    // Said once when it drops to the slow tries, not every ten minutes after.
    if (count <= QUICK_RESTARTS) console.log(`[${app}] stopped (exit ${code}); trying again ${slow ? 'every ten minutes' : 'in a minute'}.`)
    setTimeout(() => { if (!stopping) start(app, count + 1) }, slow ? SLOW_RESTART_MS : RESTART_MS)
  })
}

function stop() {
  stopping = true
  for (const child of children.values()) child.kill()
  process.exit(0)
}
for (const signal of ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? ['SIGBREAK'] : ['SIGHUP'])]) process.on(signal, stop)

console.log(`autofix: watching ${apps.join(', ')}.`)
for (const app of apps) start(app)
