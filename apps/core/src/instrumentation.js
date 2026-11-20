/**
 * Next.js instrumentation: runs once when a server instance starts (not during a build).
 *
 * Single-practitioner installs have no second deployable for the worker service, so the
 * queue pollers run inside this process. `INLINE_WORKERS=true` opts in — deployments that
 * point at a runtime service (`DOMAIN_BACKEND_URL`) keep workers out of the web process.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const { isFlagTrue, startWorkers, enabledWorkerKeys } = await import('@practice-manager/jobs')

  if (!isFlagTrue(process.env.INLINE_WORKERS)) return

  const enabled = enabledWorkerKeys()

  if (enabled.length === 0) {
    console.warn('[jobs] INLINE_WORKERS=true but no *_WORKER_ENABLED=true flag is set - no workers started')
    return
  }

  const stop = startWorkers({ workers: enabled })
  console.log(`[jobs] inline workers started: ${enabled.join(', ')}`)

  // Keep a single stop handle across dev hot reloads and expose it for graceful shutdown.
  globalThis.__practiceManagerJobsStop?.()
  globalThis.__practiceManagerJobsStop = stop
}
