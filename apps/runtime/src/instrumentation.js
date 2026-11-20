/**
 * Next.js instrumentation: runs once when a server instance starts (not during a build).
 *
 * This app *is* the worker host for deployments that point the core at `DOMAIN_BACKEND_URL`,
 * so the queue pollers start here. A `*_WORKER_ENABLED=true` flag still selects which loops
 * run, exactly as it does for the inline workers in `apps/core`; the runtime differs only in
 * not requiring `INLINE_WORKERS`.
 *
 * `RUNTIME_WORKERS_DISABLED=true` keeps the API routes but starts nothing, for a deployment
 * that drains the queues with `npm run jobs:once` instead (Cloud Run job, cron entry).
 */

/** The workers' own rule: a flag is on only when it is the literal `true`. */
function isFlagTrue(value) {
  return String(value ?? '').trim().toLowerCase() === 'true'
}

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (isFlagTrue(process.env.RUNTIME_WORKERS_DISABLED)) return

  // Imported lazily so a non-node runtime never loads a database driver.
  const { startWorkers, enabledWorkerKeys } = await import('@practice-manager/jobs')
  const enabled = enabledWorkerKeys()

  if (enabled.length === 0) {
    console.warn('[jobs] no *_WORKER_ENABLED=true flag is set - the runtime is serving requests but polling nothing')
    return
  }

  const stop = startWorkers({ workers: enabled })
  console.log(`[jobs] runtime workers started: ${enabled.join(', ')}`)

  // A dev hot reload registers again; keep one stop handle per process.
  globalThis.__practiceManagerRuntimeJobStop?.()
  globalThis.__practiceManagerRuntimeJobStop = stop
}
