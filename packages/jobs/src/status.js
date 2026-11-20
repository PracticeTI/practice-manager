/**
 * Queue status reads, without the runtime service.
 *
 * Mirrors the runtime's four `/queue/status` routes so the UI can poll the same shape from
 * a single-install deployment. The queue is the source of truth for job progress; the
 * analysis and transcript-summary tables are checked first because a completed output is
 * more useful to the patient view than the queue row that produced it.
 *
 * PostgreSQL only, for the same reason as the write side: the runtime's MySQL and Mongo
 * paths are deprecated and this distribution installs `pg` alone.
 */

import { detectDatabaseType, getDatabaseConnection } from './database.js'
import { QueueError } from './errors.js'
import { resolveReportQueueTableName, ensureReportQueueTable } from './jobs/reportQueue.js'
import { resolveAnalysisQueueTableName, ensureAnalysisQueueTable } from './jobs/analysisQueue.js'
import { resolveScribeQueueTableName, ensureScribeQueueTable } from './jobs/scribeQueue.js'
import { resolveBillingQueueTableName, ensureBillingQueueTable } from './jobs/billingQueue.js'
import { resolvePatientAnalysisTableName, resolveScribeSummariesTableName } from './jobs/analysisWorker.js'

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePatientId(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function requirePostgres() {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    throw new QueueError(
      `Queue reads require PostgreSQL (detected ${dbType || 'no database'})`,
      503,
      'unsupported_database'
    )
  }
  return dbType
}

function requireTarget(input) {
  const domain = normalizeDomain(input?.domain)
  const patientId = normalizePatientId(input?.patientId ?? input?.patient_id)
  if (!domain) throw new QueueError('domain is required')
  if (!patientId) throw new QueueError('patientId is required')
  return { domain, patientId }
}

function parseJsonObject(value) {
  if (!value) return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('does not exist')
    || message.includes('unknown table')
    || (message.includes('relation') && message.includes('does not exist'))
}

/** Report jobs label an update differently from a first build. */
function reportStatusLabel(status, row) {
  const normalized = String(status || '').trim().toLowerCase()
  const eventType = String(row?.event_type || row?.eventType || '').trim().toLowerCase()
  const isUpdateAction = eventType === 'reporting_config_changed'

  if (normalized === 'queued') return isUpdateAction ? 'Update Pending' : 'Creating'
  if (normalized === 'processing') return isUpdateAction ? 'Updating' : 'Creating'
  if (normalized === 'completed') return 'Ready'
  if (normalized === 'failed') return 'Failed'
  return 'Waiting'
}

function plainStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'processing') return 'Working'
  if (normalized === 'completed') return 'Ready'
  if (normalized === 'failed') return 'Failed'
  return 'Waiting'
}

function normalizeJobRow(row, labelFor = plainStatusLabel) {
  if (!row || typeof row !== 'object') return null

  const status = String(row.status || 'queued').trim().toLowerCase() || 'queued'
  return {
    id: row.id,
    domain: row.domain,
    patientId: row.patient_id,
    patientName: row.patient_name,
    eventType: row.event_type,
    requestedAction: row.requested_action,
    status,
    statusLabel: labelFor(status, row),
    attempts: Number(row.attempts || 0),
    maxAttempts: row.max_attempts === null || row.max_attempts === undefined ? null : Number(row.max_attempts),
    nextAttemptAt: row.next_attempt_at || null,
    claimedAt: row.claimed_at || null,
    completedAt: row.completed_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    errorMessage: row.error_message || null,
    payload: parseJsonObject(row.payload_json || row.payload || null),
  }
}

async function withConnection(work) {
  let connection = null
  try {
    connection = await getDatabaseConnection()
    return await work(connection)
  } finally {
    if (connection?.end) await connection.end().catch(() => {})
    else if (connection?.close) await connection.close().catch(() => {})
  }
}

async function fetchQueueState(connection, table, domain, patientId, labelFor = plainStatusLabel) {
  const latest = await connection.query(
    `SELECT * FROM ${table} WHERE domain = $1 AND patient_id = $2 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [domain, patientId]
  )

  const counts = await connection.query(
    `SELECT status, COUNT(*)::int AS count FROM ${table} WHERE domain = $1 AND patient_id = $2 GROUP BY status`,
    [domain, patientId]
  )

  const row = normalizeJobRow(latest.rows?.[0], labelFor)
  const tally = (counts.rows || []).reduce((acc, entry) => {
    const key = String(entry.status || '').trim().toLowerCase() || 'unknown'
    acc[key] = Number(entry.count || 0)
    return acc
  }, {})

  return { latest: row, counts: tally }
}

function queueStatusPayload({ domain, patientId, source, latest, counts, fallbackLabel }) {
  return {
    success: true,
    source,
    domain,
    patientId,
    latest,
    counts,
    status: latest?.status || 'none',
    statusLabel: latest?.statusLabel || fallbackLabel,
  }
}

/** Latest report job for a patient, with a per-status tally. */
export async function getReportJobStatus(input = {}) {
  requirePostgres()
  const { domain, patientId } = requireTarget(input)

  const table = resolveReportQueueTableName()
  const state = await withConnection(async (connection) => {
    await ensureReportQueueTable(connection, 'postgresql', table)
    return fetchQueueState(connection, table, domain, patientId, reportStatusLabel)
  })

  return queueStatusPayload({ domain, patientId, source: 'report-queue', ...state, fallbackLabel: 'Creating' })
}

/** Latest analysis job, or the stored analysis output when one exists. */
export async function getAnalysisJobStatus(input = {}) {
  requirePostgres()
  const { domain, patientId } = requireTarget(input)

  const queueTable = resolveAnalysisQueueTableName()
  const analysisTable = resolvePatientAnalysisTableName()

  return withConnection(async (connection) => {
    let analysis = null
    try {
      const result = await connection.query(
        `SELECT id, updated_at, created_at FROM ${analysisTable}
         WHERE domain = $1 AND patient_id = $2
         ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`,
        [domain, patientId]
      )
      analysis = result.rows?.[0] || null
    } catch (error) {
      if (!isMissingTableError(error)) throw error
    }

    if (analysis) {
      return {
        success: true,
        source: 'analysis-output',
        domain,
        patientId,
        latest: null,
        counts: {},
        status: 'completed',
        statusLabel: 'Ready',
        analysisExists: true,
        analysisUpdatedAt: analysis.updated_at || analysis.created_at || null,
      }
    }

    try {
      await ensureAnalysisQueueTable(connection, 'postgresql', queueTable)
      const state = await fetchQueueState(connection, queueTable, domain, patientId)
      return queueStatusPayload({ domain, patientId, source: 'analysis-queue', ...state, fallbackLabel: 'Waiting' })
    } catch (error) {
      if (!isMissingTableError(error)) throw error
      return queueStatusPayload({
        domain,
        patientId,
        source: 'analysis-queue',
        latest: null,
        counts: {},
        fallbackLabel: 'Waiting',
      })
    }
  })
}

/** Latest transcript-summary job, or the stored summary when one exists. */
export async function getScribeJobStatus(input = {}) {
  requirePostgres()
  const { domain, patientId } = requireTarget(input)

  const queueTable = resolveScribeQueueTableName()
  const summariesTable = resolveScribeSummariesTableName()

  return withConnection(async (connection) => {
    let summary = null
    try {
      const result = await connection.query(
        `SELECT id, transcription_id, updated_at, created_at FROM ${summariesTable}
         WHERE domain = $1 AND patient_id = $2
         ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`,
        [domain, patientId]
      )
      summary = result.rows?.[0] || null
    } catch (error) {
      if (!isMissingTableError(error)) throw error
    }

    if (summary) {
      return {
        success: true,
        source: 'scribe-output',
        domain,
        patientId,
        latest: null,
        counts: {},
        status: 'completed',
        statusLabel: 'Ready',
        summaryExists: true,
        transcriptionId: summary.transcription_id || null,
        summaryUpdatedAt: summary.updated_at || summary.created_at || null,
      }
    }

    try {
      await ensureScribeQueueTable(connection, 'postgresql', queueTable)
      const state = await fetchQueueState(connection, queueTable, domain, patientId)
      return queueStatusPayload({ domain, patientId, source: 'scribe-queue', ...state, fallbackLabel: 'Waiting' })
    } catch (error) {
      if (!isMissingTableError(error)) throw error
      return queueStatusPayload({
        domain,
        patientId,
        source: 'scribe-queue',
        latest: null,
        counts: {},
        fallbackLabel: 'Waiting',
      })
    }
  })
}

/** Latest billing job for a patient. */
export async function getBillingJobStatus(input = {}) {
  requirePostgres()
  const { domain, patientId } = requireTarget(input)

  const table = resolveBillingQueueTableName()
  const state = await withConnection(async (connection) => {
    await ensureBillingQueueTable(connection, 'postgresql', table)
    return fetchQueueState(connection, table, domain, patientId)
  })

  return queueStatusPayload({ domain, patientId, source: 'billing-queue', ...state, fallbackLabel: 'Waiting' })
}
