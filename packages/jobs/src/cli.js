#!/usr/bin/env node
/**
 * One-shot queue drain.
 *
 *   node src/cli.js                  # every enabled worker, one cycle each
 *   node src/cli.js --only report    # one worker, even if its flag is off
 *   node src/cli.js --only report,scribe
 *
 * Exits non-zero when any cycle errors, so a container or cron job can retry.
 */

import { enabledWorkerKeys, runOnce, WORKER_KEYS } from './driver.js'

const args = process.argv.slice(2)
const onlyIndex = args.indexOf('--only')
const only = onlyIndex >= 0 ? String(args[onlyIndex + 1] || '').trim() : ''

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: node src/cli.js [--only worker[,worker]]\nKnown workers: ${WORKER_KEYS.join(', ')}`)
  process.exit(0)
}

const workers = only
  ? only.split(',').map((key) => key.trim()).filter(Boolean)
  : enabledWorkerKeys()

if (workers.length === 0) {
  console.error('No workers enabled. Set a *_WORKER_ENABLED flag or pass --only <worker>.')
  process.exit(1)
}

const results = await runOnce({ workers })

for (const result of results) {
  if (result.ok) {
    console.log(`[${new Date().toISOString()}] ${result.worker}: ${JSON.stringify(result.result)}`)
  } else {
    console.error(`[${new Date().toISOString()}] ${result.worker} failed: ${result.error}`)
  }
}

process.exit(results.some((result) => !result.ok) ? 1 : 0)
