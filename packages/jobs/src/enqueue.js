/**
 * Inline enqueue bridge.
 *
 * The runtime service accepts queue writes over HTTP (`/api/<queue>/queue`). A
 * single-install deployment has no runtime service, so the core app calls these
 * functions instead. They perform the same normalisation and the same inserts, and
 * return the same `{ success, queued, id, … }` shape, so callers do not branch.
 *
 * The queue table is created on demand by the `ensure*QueueTable` helpers, which is what
 * makes a first-run database usable without a migration step for these tables.
 *
 * Each function validates its request before it touches the database, so a missing domain
 * or patient is a 400 whatever the database happens to be — the order the HTTP routes have
 * always used.
 *
 * PostgreSQL only: the MySQL and MongoDB paths in the runtime are deprecated, and this
 * distribution installs `pg` alone. A deployment configured for another engine gets a
 * clear `unsupported_database` error rather than a half-written row.
 */

import { detectDatabaseType, getDatabaseConnection } from './database.js'
import { QueueError } from './errors.js'
import { nudgeWorker } from './driver.js'
import { resolveReportQueueTableName, ensureReportQueueTable } from './jobs/reportQueue.js'
import { resolveAnalysisQueueTableName, ensureAnalysisQueueTable } from './jobs/analysisQueue.js'
import { resolveScribeQueueTableName, ensureScribeQueueTable } from './jobs/scribeQueue.js'
import { resolveBillingQueueTableName, ensureBillingQueueTable } from './jobs/billingQueue.js'
import { ensureEmailQueueTable } from './jobs/emailQueue.js'
import { ensureInboundEmailTable, resolveInboundEmailTableName } from './jobs/inboundEmailWorker.js'

const DEFAULT_EMAIL_TABLE = 'outbound_messages'

export { QueueError } from './errors.js'

function normalizeDomain(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized ? normalized.slice(0, 100) : ''
}

function normalizePatientId(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeText(value, maxLength = 500) {
  const normalized = String(value || '').trim()
  return normalized ? normalized.slice(0, maxLength) : ''
}

function normalizePayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function normalizeMaxAttempts(value) {
  return Number.isFinite(Number(value)) ? Math.max(1, Math.floor(Number(value))) : null
}

/** `transcription_id` is a bigint column; a non-numeric id is treated as absent. */
function normalizeTranscriptionId(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function requirePostgres() {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    throw new QueueError(
      `Queue writes require PostgreSQL (detected ${dbType || 'no database'})`,
      503,
      'unsupported_database'
    )
  }
  return dbType
}

function requireDomain(domain) {
  if (!domain) throw new QueueError('domain is required')
  return domain
}

function requirePatientId(patientId) {
  if (!patientId) throw new QueueError('patientId is required')
  return patientId
}

/** Run `work` with a connection, always closing it. */
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

/**
 * Insert one queued row and return its id.
 *
 * `values` may contain the marker `NOW_PLUS_SECONDS` to delay a row (used by the scribe
 * queue) instead of an absolute timestamp.
 */
async function insertQueuedRow(connection, table, row) {
  const columns = Object.keys(row)
  const params = []
  const placeholders = columns.map((column) => {
    const value = row[column]
    if (value === 'NOW()') return 'NOW()'
    if (value && typeof value === 'object' && value.sql === 'NOW_PLUS_SECONDS') {
      params.push(value.seconds)
      return `CASE WHEN $${params.length} > 0 THEN NOW() + ($${params.length} || ' seconds')::interval ELSE NULL END`
    }
    params.push(value)
    return `$${params.length}`
  })

  const result = await connection.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
    params
  )

  return result?.rows?.[0]?.id ?? null
}

function patientJobRow({ domain, patientId, patientName, eventType, requestedAction, payload, maxAttempts }) {
  return {
    status: 'queued',
    domain,
    patient_id: patientId,
    patient_name: patientName || null,
    event_type: eventType,
    requested_action: requestedAction,
    payload_json: JSON.stringify(payload),
    attempts: 0,
    max_attempts: maxAttempts,
    created_at: 'NOW()',
    updated_at: 'NOW()',
  }
}

/** Queue a report build. Mirrors `/api/report/queue`. */
export async function enqueueReportJob(input = {}) {
  const domain = requireDomain(normalizeDomain(input.domain || input.payload?.domain))
  const patientId = requirePatientId(normalizePatientId(input.patientId || input.patient_id || input.payload?.patientId))
  const patientName = normalizeText(input.patientName || input.patient_name || input.payload?.patientName, 240)
  const eventType = normalizeText(input.eventType || 'reporting_enabled', 80).toLowerCase() || 'reporting_enabled'
  const requestedAction = normalizeText(input.requestedAction || 'create_or_edit', 80).toLowerCase() || 'create_or_edit'
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts)
  const payload = normalizePayload(input.payload)

  requirePostgres()
  const table = resolveReportQueueTableName()
  const id = await withConnection(async (connection) => {
    await ensureReportQueueTable(connection, 'postgresql', table)
    return insertQueuedRow(connection, table, patientJobRow({ domain, patientId, patientName, eventType, requestedAction, payload, maxAttempts }))
  })

  nudgeWorker('report')
  return { success: true, queued: true, id, domain, patientId, requestedAction }
}

/** Queue an analysis run. Mirrors `/api/analysis/queue`. */
export async function enqueueAnalysisJob(input = {}) {
  const domain = requireDomain(normalizeDomain(input.domain || input.payload?.domain))
  const patientId = requirePatientId(normalizePatientId(input.patientId || input.patient_id || input.payload?.patientId))
  const patientName = normalizeText(input.patientName || input.patient_name || input.payload?.patientName, 240)
  const eventType = normalizeText(input.eventType || 'analyst_enabled', 80).toLowerCase() || 'analyst_enabled'
  const requestedAction = normalizeText(input.requestedAction || 'prepare_fca_suggestions', 80).toLowerCase() || 'prepare_fca_suggestions'
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts)
  const payload = normalizePayload(input.payload)

  requirePostgres()
  const table = resolveAnalysisQueueTableName()
  const id = await withConnection(async (connection) => {
    await ensureAnalysisQueueTable(connection, 'postgresql', table)
    return insertQueuedRow(connection, table, patientJobRow({ domain, patientId, patientName, eventType, requestedAction, payload, maxAttempts }))
  })

  nudgeWorker('analysis')
  return { success: true, queued: true, id, domain, patientId, requestedAction }
}

/** Queue a transcript summary. Mirrors `/api/scribe/queue`. */
export async function enqueueScribeJob(input = {}) {
  const domain = requireDomain(normalizeDomain(input.domain || input.payload?.domain))
  const patientId = requirePatientId(normalizePatientId(input.patientId || input.patient_id || input.payload?.patientId))
  const transcriptionId = normalizeTranscriptionId(input.transcriptionId || input.transcription_id || input.payload?.transcriptionId)
  const patientName = normalizeText(input.patientName || input.patient_name || input.payload?.patientName, 240)
  const eventType = normalizeText(input.eventType || 'transcript_completed', 80).toLowerCase() || 'transcript_completed'
  const requestedAction = normalizeText(input.requestedAction || 'summarize_transcript', 80).toLowerCase() || 'summarize_transcript'
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts)
  const delaySeconds = Math.max(0, Math.floor(Number(input.delaySeconds) || 0))
  const payload = normalizePayload(input.payload)

  requirePostgres()
  const table = resolveScribeQueueTableName()
  const id = await withConnection(async (connection) => {
    await ensureScribeQueueTable(connection, 'postgresql', table)
    return insertQueuedRow(connection, table, {
      ...patientJobRow({ domain, patientId, patientName, eventType, requestedAction, payload, maxAttempts }),
      transcription_id: transcriptionId,
      next_attempt_at: { sql: 'NOW_PLUS_SECONDS', seconds: delaySeconds },
    })
  })

  nudgeWorker('scribe')
  return { success: true, queued: true, id, domain, patientId, transcriptionId, requestedAction }
}

/** Queue a billing draft. Mirrors `/api/billing/queue`. */
export async function enqueueBillingJob(input = {}) {
  const domain = requireDomain(normalizeDomain(input.domain || input.payload?.domain))
  const patientId = requirePatientId(normalizePatientId(input.patientId || input.patient_id || input.payload?.patientId))
  const patientName = normalizeText(input.patientName || input.patient_name || input.payload?.patientName, 240)
  const eventType = normalizeText(input.eventType || 'billing_enabled', 80).toLowerCase() || 'billing_enabled'
  const requestedAction = normalizeText(input.requestedAction || 'generate_draft_invoice', 80).toLowerCase() || 'generate_draft_invoice'
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts)
  const payload = normalizePayload(input.payload)

  requirePostgres()
  const table = resolveBillingQueueTableName()
  const id = await withConnection(async (connection) => {
    await ensureBillingQueueTable(connection, 'postgresql', table)
    return insertQueuedRow(connection, table, patientJobRow({ domain, patientId, patientName, eventType, requestedAction, payload, maxAttempts }))
  })

  nudgeWorker('billing')
  return { success: true, queued: true, id, domain, patientId, requestedAction }
}

function resolveEmailTableName(env = process.env) {
  const table = env.EMAIL_QUEUE_TABLE || DEFAULT_EMAIL_TABLE
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(table))) {
    throw new QueueError('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)', 500, 'invalid_table')
  }
  return table
}

/** Queue an outbound email. Mirrors `/api/email/queue`. */
export async function enqueueEmailMessage(input = {}) {
  const toEmail = normalizeText(input.toEmail, 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
    throw new QueueError('Valid toEmail is required')
  }

  const category = normalizeText(input.category || 'generic', 80).toLowerCase() || 'generic'
  const subject = normalizeText(input.subject, 240)
  const text = normalizeText(input.text, 20000)
  const html = normalizeText(input.html, 20000)
  const payload = normalizePayload(input.payload)
  const domain = normalizeDomain(payload.domain)
  const maxAttempts = normalizeMaxAttempts(input.maxAttempts)

  requirePostgres()
  const table = resolveEmailTableName()

  if (input.dryRun === true || String(input.dryRun || '').toLowerCase() === 'true') {
    return { success: true, dryRun: true, queueAvailable: true, dbType: 'postgresql', table, toEmail }
  }

  const id = await withConnection(async (connection) => {
    await ensureEmailQueueTable(connection, 'postgresql', table)
    return insertQueuedRow(connection, table, {
      status: 'queued',
      to_email: toEmail,
      category,
      domain: domain || null,
      subject: subject || null,
      text_body: text || null,
      html_body: html || null,
      payload_json: JSON.stringify(payload),
      attempts: 0,
      max_attempts: maxAttempts,
      created_at: 'NOW()',
      updated_at: 'NOW()',
    })
  })

  nudgeWorker('email')
  return { success: true, queued: true, id, category, toEmail }
}

/** `"Name <mail@host>"` and `{ email }` both reduce to the bare address. */
function normalizeEmailAddress(value) {
  if (!value) return ''
  if (typeof value === 'object' && value.email) return String(value.email).trim().toLowerCase()

  const text = String(value).trim()
  const angle = text.match(/<([^>]+)>/)
  return (angle?.[1] || text).trim().toLowerCase()
}

function normalizeEmailList(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.map(normalizeEmailAddress).filter(Boolean)
  return [normalizeEmailAddress(value)].filter(Boolean)
}

/**
 * Record one inbound email for the inbound worker, mirroring `/api/email/inbound`.
 *
 * A provider webhook may arrive twice, and `(provider, provider_message_id)` is unique, so
 * a repeat is ignored rather than duplicated — the response still reports `received`, with
 * `id: null` when the row already existed. A row with no `domain` is left null: the worker
 * applies `INBOUND_DEFAULT_DOMAIN` when it classifies the message, which is the only place
 * that knows how a recipient address maps to a practice.
 */
export async function recordInboundEmail(body = {}) {
  requirePostgres()

  const envelope = normalizePayload(body)
  const data = envelope.type === 'email.received' && envelope.data ? normalizePayload(envelope.data) : envelope

  const fromEmail = normalizeEmailAddress(data.from || data.from_email || data.sender)
  const toEmail = normalizeEmailList(data.to || data.to_email || data.recipient)[0] || ''
  const subject = String(data.subject || '').trim()
  const textBody = String(data.text || data.text_body || data.body || '').trim()
  const htmlBody = String(data.html || data.html_body || '').trim()
  const providerMessageId = String(data.email_id || data.id || data.message_id || '').trim() || null
  const domain = normalizeDomain(data.domain || envelope.domain) || null
  const table = resolveInboundEmailTableName()

  const id = await withConnection(async (connection) => {
    await ensureInboundEmailTable(connection, 'postgresql', table)
    const result = await connection.query(
      `INSERT INTO ${table} (
        status, from_email, to_email, domain, subject, text_body, html_body, payload_json,
        category, provider, provider_message_id, attempts, max_attempts, created_at, updated_at
      ) VALUES ('received', $1, $2, $3, $4, $5, $6, $7::jsonb, 'inbound_email', 'resend', $8, 0, 5, NOW(), NOW())
      ON CONFLICT (provider, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
      RETURNING id`,
      [fromEmail, toEmail, domain, subject || null, textBody || null, htmlBody || null, JSON.stringify(envelope), providerMessageId]
    )
    return result?.rows?.[0]?.id ?? null
  })

  return { success: true, id, status: 'received' }
}
