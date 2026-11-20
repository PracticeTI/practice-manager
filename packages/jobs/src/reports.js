/**
 * Patient report reads and writes, without the runtime service.
 *
 * Mirrors `/api/report/patient`: a single `patient_reports` row per patient that holds the
 * current formal report. Working drafts belong to the builder and generated reports to the
 * report worker, so this module only ever touches the formal report row.
 */

import { detectDatabaseType, getDatabaseConnection } from './database.js'
import { QueueError } from './errors.js'

const DEFAULT_FORMAL_REPORTS_TABLE = 'patient_reports'

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePatientId(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeText(value, maxLength = 200000) {
  return String(value || '').slice(0, maxLength)
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

function resolveFormalReportsTableName(env = process.env) {
  const table = String(env.PATIENT_REPORTS_TABLE || DEFAULT_FORMAL_REPORTS_TABLE).trim()
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
    throw new QueueError('PATIENT_REPORTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)', 500, 'invalid_table')
  }
  return table
}

function requirePostgres() {
  const dbType = detectDatabaseType()
  if (dbType !== 'postgresql') {
    throw new QueueError(
      `Patient reports require PostgreSQL (detected ${dbType || 'no database'})`,
      503,
      'unsupported_database'
    )
  }
}

function requireTarget(input) {
  const domain = normalizeDomain(input?.domain)
  const patientId = normalizePatientId(input?.patientId ?? input?.patient_id)
  if (!domain) throw new QueueError('domain is required')
  if (!patientId) throw new QueueError('patientId is required')
  return { domain, patientId }
}

function normalizeReportRow(row) {
  if (!row || typeof row !== 'object') return null
  return {
    id: row.id,
    domain: row.domain,
    patientId: row.patient_id,
    patientName: row.patient_name,
    status: String(row.status || 'ready').trim().toLowerCase() || 'ready',
    transcriptCount: Number(row.transcript_count || 0),
    reportMarkdown: String(row.report_markdown || '').trim(),
    sourceNotes: String(row.source_notes || '').trim(),
    sourceMetadata: parseJsonObject(row.source_metadata_json || null),
    lastJobId: row.last_job_id || null,
    createdAt: row.created_at_tz || row.created_at || null,
    updatedAt: row.updated_at_tz || row.updated_at || null,
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

async function ensureFormalReportsTable(connection, table) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS ${table} (
      id BIGSERIAL PRIMARY KEY,
      domain VARCHAR(100) NOT NULL,
      patient_id BIGINT NOT NULL,
      patient_name TEXT,
      report_markdown TEXT NOT NULL,
      source_notes TEXT,
      transcript_count INTEGER NOT NULL DEFAULT 0,
      source_metadata_json TEXT NOT NULL DEFAULT '{}',
      last_job_id BIGINT,
      status VARCHAR(32) NOT NULL DEFAULT 'ready',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT ${table}_domain_patient_unique UNIQUE (domain, patient_id)
    )`
  )

  // Legacy tables may exist without the unique key the upsert needs.
  await connection.query(
    `WITH ranked AS (
       SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY domain, patient_id
           ORDER BY COALESCE(updated_at, created_at) DESC, id DESC
         ) AS rn
       FROM ${table}
     )
     DELETE FROM ${table} target
     USING ranked
     WHERE target.id = ranked.id
       AND ranked.rn > 1`
  )

  await connection.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_domain_patient_unique ON ${table} (domain, patient_id)`)
  await connection.query(`CREATE INDEX IF NOT EXISTS ${table}_domain_patient_idx ON ${table} (domain, patient_id)`)
  await connection.query(`CREATE INDEX IF NOT EXISTS ${table}_updated_idx ON ${table} (updated_at)`)
}

/** The current formal report for a patient, or `report: null` when none exists. */
export async function getPatientReport(input = {}) {
  requirePostgres()
  const { domain, patientId } = requireTarget(input)
  const table = resolveFormalReportsTableName()

  const row = await withConnection(async (connection) => {
    try {
      const result = await connection.query(
        `SELECT *,
                (created_at AT TIME ZONE current_setting('TIMEZONE')) AS created_at_tz,
                (updated_at AT TIME ZONE current_setting('TIMEZONE')) AS updated_at_tz
         FROM ${table}
         WHERE domain = $1 AND patient_id = $2
         ORDER BY updated_at DESC, id DESC
         LIMIT 1`,
        [domain, patientId]
      )
      return result.rows?.[0] || null
    } catch (error) {
      if (!isMissingTableError(error)) throw error
      return null
    }
  })

  return { success: true, domain, patientId, report: normalizeReportRow(row) }
}

/** Save the current formal report, replacing the patient's existing row. */
export async function savePatientReport(input = {}) {
  requirePostgres()
  const { domain, patientId } = requireTarget(input)
  const patientName = normalizeText(input.patientName ?? input.patient_name, 240).trim() || null
  const reportMarkdown = normalizeText(input.reportMarkdown ?? input.report_markdown, 200000)
  const table = resolveFormalReportsTableName()

  const row = await withConnection(async (connection) => {
    await ensureFormalReportsTable(connection, table)
    const result = await connection.query(
      `INSERT INTO ${table} (
         domain, patient_id, patient_name, report_markdown, source_notes,
         transcript_count, source_metadata_json, last_job_id, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, NULL, 0, '{}', NULL, 'ready', NOW(), NOW())
       ON CONFLICT (domain, patient_id)
       DO UPDATE SET
         patient_name = EXCLUDED.patient_name,
         report_markdown = EXCLUDED.report_markdown,
         status = 'ready',
         updated_at = NOW()
       RETURNING *,
                 (created_at AT TIME ZONE current_setting('TIMEZONE')) AS created_at_tz,
                 (updated_at AT TIME ZONE current_setting('TIMEZONE')) AS updated_at_tz`,
      [domain, patientId, patientName, reportMarkdown]
    )
    return result.rows?.[0] || null
  })

  return { success: true, domain, patientId, report: normalizeReportRow(row) }
}
