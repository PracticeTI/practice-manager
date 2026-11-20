import { missingTables, runOptionalDdl } from './pgOptionalDdl.js'

const DEFAULT_TABLE = 'patient_equipment_sourcer_jobs'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveEquipmentSourcerQueueTableName() {
    const table = String(process.env.EQUIPMENT_SOURCER_QUEUE_TABLE || DEFAULT_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EQUIPMENT_SOURCER_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

export function isEquipmentSourcerEnabled(metadata) {
    const agents = metadata?.patientAgents || metadata?.agents
    return Boolean(agents && typeof agents === 'object' && !Array.isArray(agents) && agents.equipmentSourcer === true)
}

// Exported for the owner schema pass: the queue table is otherwise only created
// inside enqueueEquipmentSourcerJob(), which also inserts a job.
export async function ensureEquipmentSourcerQueueTable(connection, dbType, table = resolveEquipmentSourcerQueueTableName()) {
    return ensureQueueTable(connection, dbType, table)
}

async function ensureQueueTable(connection, dbType, table) {
    const create = `CREATE TABLE IF NOT EXISTS ${table} (
            id BIGSERIAL PRIMARY KEY, status VARCHAR(32) NOT NULL DEFAULT 'queued', domain VARCHAR(100) NOT NULL,
            patient_id BIGINT NOT NULL, patient_name TEXT, event_type VARCHAR(80) NOT NULL DEFAULT 'equipment_sourcer_enabled',
            requested_action VARCHAR(80) NOT NULL DEFAULT 'source_equipment_suggestions', payload_json TEXT NOT NULL DEFAULT '{}',
            attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER, next_attempt_at TIMESTAMP NULL, claimed_at TIMESTAMP NULL,
            claimed_by VARCHAR(128), completed_at TIMESTAMP NULL, error_message TEXT, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`

    // `CREATE TABLE IF NOT EXISTS` still asks for CREATE on the schema, so a
    // constrained runtime role is refused even when the queue table is already there.
    if ((await missingTables(connection, [table])).length > 0) {
        await connection.query(create)
    }

    // A non-owner role cannot create the indexes; the queue still works without them.
    await runOptionalDdl(connection, `CREATE INDEX IF NOT EXISTS ${table}_status_next_attempt_idx ON ${table} (status, next_attempt_at)`)
    await runOptionalDdl(connection, `CREATE INDEX IF NOT EXISTS ${table}_domain_created_idx ON ${table} (domain, created_at)`)
}

export async function enqueueEquipmentSourcerJob({ connection, dbType, patientId, patientName, domain, metadata, eventType = 'equipment_sourcer_enabled', source = 'one:patient-agent-toggle' }) {
    if (dbType !== 'postgresql') {
        throw new Error(`Unsupported database type for Equipment Sourcer queue: ${dbType}`)
    }

    const table = resolveEquipmentSourcerQueueTableName()
    await ensureQueueTable(connection, dbType, table)
    const payload = JSON.stringify({ domain, patientId, patientName, metadata, source })

    const result = await connection.query(
        `INSERT INTO ${table} (status, domain, patient_id, patient_name, event_type, requested_action, payload_json, attempts, created_at, updated_at)
         VALUES ('queued', $1, $2, $3, $4, 'source_equipment_suggestions', $5, 0, NOW(), NOW()) RETURNING id`,
        [domain, patientId, patientName || null, eventType, payload]
    )
    return { success: true, queued: true, id: result.rows?.[0]?.id || null, requestedAction: 'source_equipment_suggestions' }
}