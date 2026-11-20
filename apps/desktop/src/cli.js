#!/usr/bin/env node
/**
 * Desktop helper CLI. The Electron shell runs the same functions; this exists so an
 * operator (or a support call) can run the checks without launching the app.
 *
 *   npm run preflight --workspace @practice-manager/desktop
 *   npm run setup --workspace @practice-manager/desktop
 *
 * `--json` prints machine-readable output for the setup wizard.
 */

import { runPreflight } from './preflight.js'
import { provisionDatabase } from './setup.js'
import { hasProductionBuild, startCoreServer } from '../main/launchPlan.js'

const [command, ...flags] = process.argv.slice(2)
const asJson = flags.includes('--json')

function printChecks(result) {
  for (const check of result.checks) {
    const mark = check.ok ? '✔' : '✖'
    console.log(`${mark} ${check.name}: ${check.detail}`)
    if (!check.ok && check.fix) console.log(`   → ${check.fix}`)
  }
}

async function preflight() {
  const result = await runPreflight()
  if (asJson) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printChecks(result)
  }
  process.exit(result.ok ? 0 : 1)
}

async function setup() {
  try {
    const result = await provisionDatabase({
      log: asJson ? () => {} : (message) => console.log(`[setup] ${message}`),
    })

    const check = await runPreflight()
    if (asJson) {
      console.log(JSON.stringify({ ...result, checks: check.checks }, null, 2))
    } else {
      console.log('')
      printChecks(check)
    }

    process.exit(check.ok ? 0 : 1)
  } catch (error) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, error: error?.message || String(error) }, null, 2))
    } else {
      console.error(`[setup] ${error?.message || error}`)
    }
    process.exit(1)
  }
}

/**
 * Headless equivalent of what the shell does: start the core app, wait for health, and
 * stay in the foreground. `--once` exits as soon as the server answers, which is what the
 * smoke test uses.
 */
async function serve() {
  const once = flags.includes('--once')

  if (!hasProductionBuild()) {
    console.error('No production build found. Run: npm run build')
    process.exit(1)
  }

  const started = await startCoreServer({ onOutput: (line) => console.log(`[core] ${line}`) })
  if (!started.ok) {
    console.error(`Server did not start: ${started.error}`)
    process.exit(1)
  }

  console.log(`[serve] listening on ${started.baseUrl}`)

  if (once) {
    started.child.kill('SIGTERM')
    process.exit(0)
  }

  const shutdown = () => {
    started.child.kill('SIGTERM')
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

const commands = { preflight, setup, serve }

if (!commands[command]) {
  console.error('Usage: node src/cli.js <preflight|setup> [--json]')
  process.exit(2)
}

await commands[command]()
