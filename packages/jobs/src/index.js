/**
 * Public surface of the jobs package.
 *
 * Consumers:
 *   apps/runtime  - starts the poll loops as a service, one-shot mode drains and exits
 *   apps/core     - starts them inline for single-install deployments (INLINE_WORKERS=1)
 *   packages/*    - imports queue helpers to enqueue work without an HTTP hop
 */

export {
  WORKERS,
  WORKER_KEYS,
  isFlagTrue,
  isWorkerEnabled,
  enabledWorkerKeys,
  isWorkerRunning,
  nudgeWorker,
  startWorkers,
  runOnce,
} from './driver.js'
