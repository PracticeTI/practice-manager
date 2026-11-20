/**
 * Queue-table helpers.
 *
 * These own the table names and the `CREATE TABLE IF NOT EXISTS` calls for every queue a
 * worker polls. Route handlers (apps/runtime) and the inline bridge (apps/core) both go
 * through this module so a queue table is only ever described in one place.
 */

export { ensureReportQueueTable, resolveReportQueueTableName, reportQueueAvailable } from './jobs/reportQueue.js'
export { ensureAnalysisQueueTable, analysisQueueAvailable } from './jobs/analysisQueue.js'
export { ensureBillingQueueTable, billingQueueAvailable } from './jobs/billingQueue.js'
export { ensureScribeQueueTable, ensureScribeQueueTableForCurrentDb } from './jobs/scribeQueue.js'
export { ensureEmailQueueTable } from './jobs/emailQueue.js'
export { ensureInboundEmailTable } from './jobs/inboundEmailWorker.js'
export { ensureEquipmentSourcerQueueTable, equipmentSourcerQueueAvailable } from './jobs/equipmentSourcerQueue.js'
