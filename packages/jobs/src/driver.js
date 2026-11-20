/**
 * Inline worker driver.
 *
 * The worker modules are poll loops: each `start*Worker()` returns a stop function and
 * reads its own `*_WORKER_ENABLED` flag, so this module only decides *which* loops run.
 * A long-lived service (apps/runtime) starts them all; a single-practitioner install
 * starts them inside the core app process, where there is no second deployable.
 *
 * Run modes:
 *   service  - apps/runtime calls startWorkers() once at boot
 *   inline   - apps/core calls startWorkers() from instrumentation.js when INLINE_WORKERS=1
 *   one-shot - CLI/`runOnce()` drains the queues once and returns (containers, cron, jobs)
 */

import { startAnalysisWorker, runAnalysisWorkerCycle } from './jobs/analysisWorker.js'
import { startAnalysisBackfillTrigger, runAnalysisBackfillTriggerCycle } from './jobs/analysisBackfillTrigger.js'
import { startBillingWorker, runBillingWorkerCycle } from './jobs/billingWorker.js'
import { startEmailWorker, runEmailWorkerCycle } from './jobs/emailQueue.js'
import { startInboundEmailWorker, runInboundEmailWorkerCycle } from './jobs/inboundEmailWorker.js'
import { startEquipmentSourcerWorker, runEquipmentSourcerWorkerCycle } from './jobs/equipmentSourcerWorker.js'
import { startQuoteWriterTrigger, runQuoteWriterTriggerCycle } from './jobs/quoteWriterTrigger.js'
import { startReportWorker, runReportWorkerCycle } from './jobs/reportWorker.js'
import { startSchedulingReminderWorker, runSchedulingReminderCycle } from './jobs/schedulingReminderWorker.js'
import { startScribeWorker, runScribeWorkerCycle } from './jobs/scribeWorker.js'
import { startSystemInfoWorker, runSystemInfoWorkerCycle } from './jobs/systemInfoWorker.js'

/**
 * The workers' own rule: a flag is on only when it is the literal `true`
 * (`String(value).toLowerCase() === 'true'`). The driver must not be more generous than
 * the loops it starts, or it reports a worker as started while the worker disables itself.
 */
export function isFlagTrue(value) {
  return String(value ?? '').trim().toLowerCase() === 'true'
}

/**
 * Worker registry. `enableEnv` is the flag the worker reads itself; `fallbackEnv` mirrors
 * the worker's own fallback (the inbound worker follows the outbound email flag unless it
 * is set explicitly).
 *
 * `requiresExplicitFlag` covers workers that default to *enabled* in the service. In the
 * core app they must be opted into, or every single-practitioner install would start
 * polling the environment-health table on boot.
 */
export const WORKERS = {
  analysis: { label: 'Analysis worker', enableEnv: 'ANALYSIS_WORKER_ENABLED', start: startAnalysisWorker, run: runAnalysisWorkerCycle },
  analysisBackfill: { label: 'Analysis backfill trigger', enableEnv: 'ANALYSIS_BACKFILL_TRIGGER_ENABLED', start: startAnalysisBackfillTrigger, run: runAnalysisBackfillTriggerCycle },
  billing: { label: 'Billing worker', enableEnv: 'BILLING_WORKER_ENABLED', start: startBillingWorker, run: runBillingWorkerCycle },
  email: { label: 'Outbound email worker', enableEnv: 'EMAIL_WORKER_ENABLED', start: startEmailWorker, run: runEmailWorkerCycle },
  inboundEmail: { label: 'Inbound email worker', enableEnv: 'INBOUND_EMAIL_WORKER_ENABLED', fallbackEnv: 'EMAIL_WORKER_ENABLED', start: startInboundEmailWorker, run: runInboundEmailWorkerCycle },
  equipmentSourcer: { label: 'Equipment sourcer worker', enableEnv: 'EQUIPMENT_SOURCER_WORKER_ENABLED', start: startEquipmentSourcerWorker, run: runEquipmentSourcerWorkerCycle },
  quoteWriter: { label: 'Quote writer trigger', enableEnv: 'QUOTE_WRITER_TRIGGER_ENABLED', start: startQuoteWriterTrigger, run: runQuoteWriterTriggerCycle },
  report: { label: 'Report worker', enableEnv: 'REPORT_WORKER_ENABLED', start: startReportWorker, run: runReportWorkerCycle },
  schedulingReminder: { label: 'Scheduling reminder worker', enableEnv: 'SCHEDULING_REMINDER_WORKER_ENABLED', start: startSchedulingReminderWorker, run: runSchedulingReminderCycle },
  scribe: { label: 'Scribe worker', enableEnv: 'SCRIBE_WORKER_ENABLED', start: startScribeWorker, run: runScribeWorkerCycle },
  systemInfo: { label: 'Environment health worker', enableEnv: 'ENV_HEALTH_WORKER_ENABLED', requiresExplicitFlag: true, start: startSystemInfoWorker, run: runSystemInfoWorkerCycle },
}

export const WORKER_KEYS = Object.keys(WORKERS)

/** True when `key` should start, using the same rules the worker applies on its own. */
export function isWorkerEnabled(key, env = process.env) {
  const spec = WORKERS[key]
  if (!spec) return false
  const raw = env[spec.enableEnv]
  if (spec.requiresExplicitFlag) return isFlagTrue(raw)
  if (raw !== undefined) return isFlagTrue(raw)
  return spec.fallbackEnv ? isFlagTrue(env[spec.fallbackEnv]) : false
}

/** Worker keys enabled by `env`, in registry order. */
export function enabledWorkerKeys(env = process.env) {
  return WORKER_KEYS.filter((key) => isWorkerEnabled(key, env))
}

function resolveKeys(workers, env) {
  if (workers === undefined) return enabledWorkerKeys(env)
  const requested = Array.isArray(workers) ? workers : [workers]
  for (const key of requested) {
    if (!WORKERS[key]) throw new Error(`Unknown worker "${key}". Known workers: ${WORKER_KEYS.join(', ')}`)
  }
  return requested
}

/**
 * Workers started by `startWorkers()` in this process, so an enqueue can ask for a cycle
 * without waiting for the next poll. `inFlight` coalesces a burst of enqueues into one run.
 */
const activeWorkers = new Map()

/**
 * Run one cycle of a started worker as soon as the current call stack unwinds.
 * Returns false when that worker is not running inline in this process.
 *
 * The enqueue path never awaits this: a build or a report can take minutes, and the HTTP
 * request that queued it must not hold the connection open for it.
 */
export function nudgeWorker(key) {
  const entry = activeWorkers.get(key)
  if (!entry || entry.inFlight) return false

  entry.inFlight = true
  Promise.resolve()
    .then(() => entry.run())
    .catch((error) => console.error(`[jobs] ${key} immediate cycle failed: ${error?.message || error}`))
    .finally(() => {
      entry.inFlight = false
    })

  return true
}

export function isWorkerRunning(key) {
  return activeWorkers.has(key)
}

/**
 * Start poll loops for the selected workers (default: the enabled ones).
 * Returns a stop function that is safe to call more than once.
 *
 * @param {{ workers?: string[]|string, env?: Record<string, string|undefined> }} [options]
 * @returns {() => void}
 */
export function startWorkers(options = {}) {
  const env = options.env || process.env
  const keys = resolveKeys(options.workers, env)

  if (keys.length === 0) return () => {}

  const stops = []
  for (const key of keys) {
    const spec = WORKERS[key]
    try {
      const stop = spec.start()
      if (typeof stop === 'function') stops.push(stop)
      activeWorkers.set(key, { run: spec.run, inFlight: false })
    } catch (error) {
      console.error(`[jobs] ${spec.label} failed to start: ${error?.message || error}`)
    }
  }

  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    for (const key of keys) activeWorkers.delete(key)
    for (const stop of stops) {
      try {
        stop()
      } catch {
        // A stop function that throws must not prevent the others from stopping.
      }
    }
  }
}

/**
 * Run one cycle of the selected workers and return per-worker outcomes.
 * Explicitly selected workers run even when their enable flag is off — a one-shot drain
 * is an operator action, not a poll loop.
 *
 * @param {{ workers?: string[]|string, env?: Record<string, string|undefined> }} [options]
 * @returns {Promise<Array<{ worker: string, ok: boolean, result?: unknown, error?: string }>>}
 */
export async function runOnce(options = {}) {
  const env = options.env || process.env
  const keys = resolveKeys(options.workers, env)
  const results = []

  for (const key of keys) {
    const spec = WORKERS[key]
    try {
      results.push({ worker: key, ok: true, result: await spec.run() })
    } catch (error) {
      results.push({ worker: key, ok: false, error: error?.message || String(error) })
    }
  }

  return results
}
