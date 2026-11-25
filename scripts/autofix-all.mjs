/**
 * `npm run autofix` — one watcher per app, side by side: my-brain, my-mail and
 * workout-tracker. Each is that repo's own scripts/autofix.mjs, run in its own
 * checkout, so each keeps its own lock, worktree and logs. This file only starts
 * them, names their lines, and brings one back if it dies.
 *
 * A watcher that exits is restarted after a minute, a few times at most: one that
 * refuses to start (no token, a second watcher already on that checkout) says why
 * and is left stopped rather than restarted forever.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const projects = path.resolve(import.meta.dirname, '..', '..')
const apps = ['my-brain', 'my-mail', 'workout-tracker'].filter((app) => existsSync(path.join(projects, app, 'scripts', 'autofix.mjs')))
const RESTART_MS = 60_000
const MAX_RESTARTS = 5
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
    if (count >= MAX_RESTARTS) {
      console.log(`[${app}] stopped (exit ${code}) and is not being restarted again.`)
      return
    }
    console.log(`[${app}] stopped (exit ${code}); starting it again in a minute.`)
    setTimeout(() => { if (!stopping) start(app, count + 1) }, RESTART_MS)
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
