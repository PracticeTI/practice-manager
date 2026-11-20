/**
 * Local-database fallbacks for patient report/billing job queues.
 *
 * When the domain backend (`two`) is unreachable, these helpers write the job
 * straight into the same queue tables the `two` workers poll, so the work is
 * not lost while the backend is offline. Store-and-forward only — the actual
 * job is still processed by the `two` worker once it is back.
 *
 * Postgres-only, matching the other local queue fallbacks in this codebase.
 */

import { isDdlPermissionError, missingTables } from './pgOptionalDdl.js'

export const DEFAULT_REPORT_QUEUE_TABLE = 'patient_report_jobs'
export const DEFAULT_BILLING_QUEUE_TABLE = 'patient_billing_jobs'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveQueueTableName(configuredValue, fallbackTable, envName) {
    const table = String(configuredValue || fallbackTable).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error(`${envName} must be a safe SQL identifier (letters, numbers, underscore)`)
    }
    return table
}

export function resolveReportQueueTableName() {
    return resolveQueueTableName(process.env.REPORT_QUEUE_TABLE, DEFAULT_REPORT_QUEUE_TABLE, 'REPORT_QUEUE_TABLE')
}

export function resolveBillingQueueTableName() {
    return resolveQueueTableName(process.env.BILLING_QUEUE_TABLE, DEFAULT_BILLING_QUEUE_TABLE, 'BILLING_QUEUE_TABLE')
}

function buildQueueSchemaStatements(table, { eventType, requestedAction }) {
    return {
        create: `
  CREATE TABLE IF NOT EXISTS ${table} (
    id BIGSERIAL PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    domain VARCHAR(100) NOT NULL,
    patient_id BIGINT NOT NULL,
    patient_name TEXT,
    event_type VARCHAR(80) NOT NULL DEFAULT '${eventType}',
    requested_action VARCHAR(80) NOT NULL DEFAULT '${requestedAction}',
    payload_json TEXT NOT NULL DEFAULT '{}',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER,
    next_attempt_at TIMESTAMP NULL,
    claimed_at TIMESTAMP NULL,
    claimed_by VARCHAR(128),
    completed_at TIMESTAMP NULL,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`,
        indexes: [
            `CREATE INDEX IF NOT EXISTS ${table}_status_next_attempt_idx ON ${table} (status, next_attempt_at)`,
            `CREATE INDEX IF NOT EXISTS ${table}_domain_created_idx ON ${table} (domain, created_at)`
        ]
    }
}

async function ensureLocalQueueTable(connection, table, defaults) {
    const schema = buildQueueSchemaStatements(table, defaults)
    // `CREATE TABLE IF NOT EXISTS` still asks for CREATE on the schema, so a
    // constrained runtime role is refused even when the queue table is already there.
    if ((await missingTables(connection, [table])).length > 0) {
        await connection.query(schema.create)
    }

    for (const indexStatement of schema.indexes) {
        try {
            await connection.query(indexStatement)
        } catch (error) {
            // A non-owner role cannot create the index; the table is still usable
            // without it. See lib/pgOptionalDdl.js.
            if (isDdlPermissionError(error)) continue

            const message = String(error?.message || '')
            if (!message.includes('already exists') && !message.includes('Duplicate')) {
                throw error
            }
        }
    }
}

export async function ensureLocalReportQueueTable(connection, table = resolveReportQueueTableName()) {
    return ensureLocalQueueTable(connection, table, {
        eventType: 'reporting_enabled',
        requestedAction: 'create_or_edit',
    })
}

export async function ensureLocalBillingQueueTable(connection, table = resolveBillingQueueTableName()) {
    return ensureLocalQueueTable(connection, table, {
        eventType: 'billing_enabled',
        requestedAction: 'generate_draft_invoice',
    })
}

/**
 * Store a report job in the local queue when the domain backend is unavailable.
 */
export async function enqueuePatientReportJobLocalFallback({ connection, patientId, patientName, domain, metadata, aiUsage, eventType, source }) {
    const table = resolveReportQueueTableName()
    await ensureLocalReportQueueTable(connection, table)

    const payload = {
        domain,
        patientId,
        patientName,
        metadata,
        aiUsage,
        source: String(source || 'one:patient-agent-toggle') + ':local-db-fallback'
    }

    const result = await connection.query(
        `
    INSERT INTO ${table} (
      status,
      domain,
      patient_id,
      patient_name,
      event_type,
      requested_action,
      payload_json,
      attempts,
      created_at,
      updated_at
    ) VALUES (
      'queued',
      $1,
      $2,
      $3,
      $4,
      'create_or_edit',
      $5,
      0,
      NOW(),
      NOW()
    )
    RETURNING id
  `,
        [domain, patientId, patientName || null, eventType || 'reporting_enabled', JSON.stringify(payload)]
    )

    return {
        success: true,
        queued: true,
        id: result?.rows?.[0]?.id || null,
        domain,
        patientId,
        requestedAction: 'create_or_edit',
        source: 'local-db-fallback'
    }
}

/**
 * Store a billing job in the local queue when the domain backend is unavailable.
 */
export async function enqueuePatientBillingJobLocalFallback({ connection, patientId, patientName, domain, metadata, eventType, source }) {
    const table = resolveBillingQueueTableName()
    await ensureLocalBillingQueueTable(connection, table)

    const payload = {
        domain,
        patientId,
        patientName,
        metadata,
        source: String(source || 'one:patient-agent-toggle') + ':local-db-fallback'
    }

    const result = await connection.query(
        `
    INSERT INTO ${table} (
      status,
      domain,
      patient_id,
      patient_name,
      event_type,
      requested_action,
      payload_json,
      attempts,
      created_at,
      updated_at
    ) VALUES (
      'queued',
      $1,
      $2,
      $3,
      $4,
      'generate_draft_invoice',
      $5,
      0,
      NOW(),
      NOW()
    )
    RETURNING id
  `,
        [domain, patientId, patientName || null, eventType || 'billing_enabled', JSON.stringify(payload)]
    )

    return {
        success: true,
        queued: true,
        id: result?.rows?.[0]?.id || null,
        domain,
        patientId,
        requestedAction: 'generate_draft_invoice',
        source: 'local-db-fallback'
    }
}
