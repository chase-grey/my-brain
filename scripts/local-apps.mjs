// Serves my-brain, my-mail and workout-tracker from localhost, side by side under the paths github pages gives
// them, for a pc that cannot reach chase-grey.github.io. Run with `npm run local`, then open http://localhost:5270/.
//
// Each app is built from origin/main in a worktree of its own (<repo>/.worktrees/local), so what is served is
// what is deployed, never another session's half-finished edits. origin/main is checked every few minutes and
// a new commit is rebuilt, which the apps pick up the way they pick up a deploy.
//
// The worktree borrows the main checkout's node_modules through a junction. Never `rm -rf` that worktree:
// following the junction would empty the real node_modules. Use `git worktree remove` after `rmdir node_modules`.
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = 5270
const CHECK_EVERY_MS = 5 * 60 * 1000
const BUILDS = '.local'
const projects = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const apps = ['my-brain', 'my-mail', 'workout-tracker'].map((name) => {
  const repo = join(projects, name)
  const tree = join(repo, '.worktrees', 'local')
  const current = join(tree, BUILDS, 'current')
  return { name, repo, tree, commit: existsSync(current) ? readFileSync(current, 'utf8') : '' }
})

const log = (line) => console.log(`${new Date().toLocaleTimeString()} ${line}`)

function run(cwd, command, args) {
  return new Promise((done, fail) => {
    execFile(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (error, stdout, stderr) => {
      if (error) fail(new Error(`${command} ${args.slice(0, 3).join(' ')}: ${(stderr || stdout || error.message).trim()}`))
      else done(stdout.trim())
    })
  })
}

// Vite reads the main checkout's env files itself (the sign-in client id, the tracker's backend address), so nothing is copied.
const buildScript = `import { build } from 'vite'
await build({ envDir: process.argv[1], logLevel: 'warn', build: { outDir: process.argv[2], emptyOutDir: true } })`

/** Brings one app's worktree to origin/main and rebuilds it when the commit has moved. */
async function sync(app) {
  await run(app.repo, 'git', ['fetch', '--quiet', 'origin', 'main'])
  const commit = await run(app.repo, 'git', ['rev-parse', 'origin/main'])
  if (app.commit === commit) return

  if (!existsSync(app.tree)) await run(app.repo, 'git', ['worktree', 'add', '--detach', app.tree, commit])
  else await run(app.tree, 'git', ['checkout', '--quiet', '--detach', '--force', commit])
  if (!existsSync(join(app.tree, 'node_modules'))) symlinkSync(join(app.repo, 'node_modules'), join(app.tree, 'node_modules'), 'junction')

  // Each commit is built into a folder of its own and a file names the one to serve. Swapping folders by
  // rename fails on Windows whenever a dev server is watching the repo.
  log(`${app.name}: building ${commit.slice(0, 7)}`)
  await run(app.tree, process.execPath, ['--input-type=module', '-e', buildScript, app.repo, `${BUILDS}/${commit}`])
  writeFileSync(join(app.tree, BUILDS, 'current'), commit)
  app.commit = commit
  for (const old of readdirSync(join(app.tree, BUILDS))) {
    if (old === commit || old === 'current') continue
    try {
      rmSync(join(app.tree, BUILDS, old), { recursive: true, force: true })
    } catch {
      // Still held open; it goes on a later pass.
    }
  }
  log(`${app.name}: serving ${commit.slice(0, 7)}`)
}

let syncing = false
async function syncAll() {
  if (syncing) return
  syncing = true
  for (const app of apps) {
    try {
      await sync(app)
    } catch (error) {
      // The last good build keeps being served.
      log(`${app.name}: ${error.message}`)
    }
  }
  syncing = false
}

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
}

// Microsoft knows a localhost copy only by its root, so every sign-in popup and renewal frame lands here and
// hands its result back to the app that asked. Opened by hand, it is a list of the apps.
const rootPage = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>apps</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 1rem; background: #111; font: 1.25rem system-ui, sans-serif; }
  a { color: #eee; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
<script src="/msal-redirect-bridge.js"></script>
<script>
  const params = new URLSearchParams(location.hash.slice(1) || location.search)
  if (params.has('state') && (params.has('code') || params.has('error'))) msalRedirectBridge.broadcastResponseToMainFrame()
  else addEventListener('DOMContentLoaded', () => {
    document.body.innerHTML = ${JSON.stringify(apps.map((app) => `<a href="/${app.name}/" target="_blank">${app.name.replace('-', ' ')}</a>`).join(''))}
  })
</script>
<body></body>`

function send(response, status, type, body, cache = 'no-cache') {
  response.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache })
  response.end(body)
}

const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
  if (path === '/') return send(response, 200, types['.html'], rootPage)
  if (path === '/msal-redirect-bridge.js') {
    const bridge = join(apps[0].repo, 'node_modules', '@azure', 'msal-browser', 'lib', 'redirect-bridge', 'msal-redirect-bridge.min.js')
    return send(response, 200, types['.js'], readFileSync(bridge))
  }

  const app = apps.find((candidate) => path === `/${candidate.name}` || path.startsWith(`/${candidate.name}/`))
  if (!app) return send(response, 404, types['.txt'], 'not found')
  if (path === `/${app.name}`) {
    response.writeHead(302, { Location: `/${app.name}/` })
    return response.end()
  }
  const dist = join(app.tree, BUILDS, app.commit)
  if (!app.commit || !existsSync(join(dist, 'index.html'))) return send(response, 503, types['.txt'], `${app.name} is still building, try again in a minute`)

  let file = resolve(dist, `.${path.slice(app.name.length + 1)}`)
  if (file !== dist && !file.startsWith(dist + sep)) return send(response, 404, types['.txt'], 'not found')
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
  if (!existsSync(file)) {
    // A missing file is a 404, as on github pages; only a page address falls back to the app.
    if (extname(file)) return send(response, 404, types['.txt'], 'not found')
    file = join(dist, 'index.html')
  }
  // Built assets carry a hash in their name; everything else is asked for again each time, so a rebuild is seen.
  const hashed = path.startsWith(`/${app.name}/assets/`)
  send(response, 200, types[extname(file)] ?? 'application/octet-stream', readFileSync(file), hashed ? 'public, max-age=31536000, immutable' : 'no-cache')
})

server.on('error', (error) => {
  // Already running in another window.
  if (error.code === 'EADDRINUSE') process.exit(0)
  throw error
})

server.listen(PORT, '127.0.0.1', () => {
  log(`http://localhost:${PORT}/`)
  void syncAll()
  setInterval(() => void syncAll(), CHECK_EVERY_MS)
})
