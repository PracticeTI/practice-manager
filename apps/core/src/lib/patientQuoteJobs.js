// Queue for the patient "Quote Writer" worker.
//
// Mirrors the other AI worker queues (`patientEquipmentQueue.js`,
// `patientScribeQueue.js`): the app only *enqueues* here, and the worker drains
// the table. The table lives in this app (rather than the worker service)
// because drafting a quote has to price every line against
// `ndisSupportCatalogue.js`, which is the single source of truth for NDIS
// support items and price limits. A second copy of the catalogue in the worker
// service would be a second answer to "what is the limit for this support?".

import { QUOTE_WRITER_AGENT_KEY, isQuoteWriterEnabled } from './patientQuoteDrafting.js'
import { missingTables, runOptionalDdl } from './pgOptionalDdl.js'

const DEFAULT_TABLE = 'patient_quote_jobs'

export const QUOTE_WRITER_EVENT_ENABLED = 'quote_writer_enabled'
export const QUOTE_WRITER_EVENT_CONFIG_CHANGED = 'quote_writer_config_changed'
export const QUOTE_WRITER_EVENT_REQUESTED = 'quote_writer_requested'

export const QUOTE_WRITER_ACTION_DRAFT = 'draft_patient_quote'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveQuoteWriterQueueTableName() {
    const table = String(process.env.QUOTE_WRITER_QUEUE_TABLE || DEFAULT_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('QUOTE_WRITER_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function getQueueSchemaStatements(table) {
    return {
        create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        quote_id BIGINT,
        event_type VARCHAR(80) NOT NULL DEFAULT '${QUOTE_WRITER_EVENT_ENABLED}',
        requested_action VARCHAR(80) NOT NULL DEFAULT '${QUOTE_WRITER_ACTION_DRAFT}',
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
            `CREATE INDEX IF NOT EXISTS ${table}_domain_patient_idx ON ${table} (domain, patient_id, created_at)`,
        ],
    }
}

export async function ensureQuoteWriterQueueTable(connection, dbType = 'postgresql', table = resolveQuoteWriterQueueTableName()) {
    if (dbType !== 'postgresql') {
        throw new Error(`Unsupported database type for Quote Writer queue writes: ${dbType}`)
    }

    const schema = getQueueSchemaStatements(table)
    // `CREATE TABLE IF NOT EXISTS` still asks for CREATE on the schema, so a
    // constrained runtime role is refused even when the queue table is already there.
    if ((await missingTables(connection, [table])).length > 0) {
        await connection.query(schema.create)
    }

    // A non-owner role cannot create the indexes; the queue still works without them.
    for (const indexStatement of schema.indexes) {
        await runOptionalDdl(connection, indexStatement)
    }
}

export { isQuoteWriterEnabled, QUOTE_WRITER_AGENT_KEY }

/**
 * Queues a drafting job. Called when the worker is switched on for a patient,
 * when its settings change, or when a practitioner asks for a fresh draft.
 */
export async function enqueueQuoteWriterJob({
    connection,
    dbType = 'postgresql',
    patientId,
    patientName,
    domain,
    metadata,
    quoteId = null,
    eventType = QUOTE_WRITER_EVENT_ENABLED,
    requestedAction = QUOTE_WRITER_ACTION_DRAFT,
    source = 'one:patient-agent-toggle',
}) {
    if (dbType !== 'postgresql') {
        throw new Error(`Unsupported database type for Quote Writer queue: ${dbType}`)
    }

    const table = resolveQuoteWriterQueueTableName()
    await ensureQuoteWriterQueueTable(connection, dbType, table)

    const payload = JSON.stringify({ domain, patientId, patientName: patientName || null, quoteId, metadata, source })

    const result = await connection.query(
        `INSERT INTO ${table} (status, domain, patient_id, patient_name, quote_id, event_type, requested_action, payload_json, attempts, created_at, updated_at)
         VALUES ('queued', $1, $2, $3, $4, $5, $6, $7, 0, NOW(), NOW()) RETURNING id`,
        [domain, patientId, patientName || null, quoteId, eventType, requestedAction, payload]
    )

    return {
        success: true,
        queued: true,
        id: result.rows?.[0]?.id || null,
        requestedAction,
    }
}
