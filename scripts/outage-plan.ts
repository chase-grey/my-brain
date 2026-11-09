// Prints the outage plan for a date window from the work snapshot the bridge keeps in the vault.
// Node 24 runs this directly: node scripts/outage-plan.ts 2026-11-09 2026-11-12 [snapshot.json] [config.json]
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { buildOutagePlan, outagePlanMarkdown } from '../src/work/outagePlan.ts'
import { defaultWorkConfig, type WorkConfig, type WorkSnapshot } from '../src/work/types.ts'

const [start, end, snapshotArg, configArg] = process.argv.slice(2)
if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
  console.error('usage: node scripts/outage-plan.ts <first day out> <last day out> [snapshot.json] [config.json]')
  process.exit(2)
}
const vault = process.env.MY_BRAIN_VAULT ?? join(homedir(), 'Documents', 'Obsidian', 'Hivemind')
const snapshotPath = snapshotArg ?? join(vault, '99 System', 'work-snapshot.json')
const configPath = configArg ?? join(vault, '99 System', 'work-dashboard.json')
if (!existsSync(snapshotPath)) {
  console.error(`no snapshot at ${snapshotPath}; start the work bridge (npm run bridge) or POST /work/refresh`)
  process.exit(1)
}
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as WorkSnapshot
const stored = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) as Partial<WorkConfig> : {}
const config: WorkConfig = { ...defaultWorkConfig, ...stored, filters: { ...defaultWorkConfig.filters, ...stored.filters }, ignores: stored.ignores ?? [] }
const today = new Date().toLocaleDateString('en-CA')
const plan = buildOutagePlan(snapshot, config, { start, end }, today)
if (process.argv.includes('--json')) console.log(JSON.stringify(plan, null, 2))
else console.log(outagePlanMarkdown(plan, snapshot.me.name))
console.error(`snapshot from ${snapshot.capturedAt}`)
