import { detectDatabaseType } from '../database.js'
import { ensurePermissiveRowLevelSecurity } from './postgresRls.js'

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

function getSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        event_type VARCHAR(80) NOT NULL DEFAULT 'equipment_sourcer_enabled',
        requested_action VARCHAR(80) NOT NULL DEFAULT 'source_equipment_suggestions',
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

    if (dbType === 'mysql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        event_type VARCHAR(80) NOT NULL DEFAULT 'equipment_sourcer_enabled',
        requested_action VARCHAR(80) NOT NULL DEFAULT 'source_equipment_suggestions',
        payload_json LONGTEXT NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NULL,
        next_attempt_at DATETIME NULL,
        claimed_at DATETIME NULL,
        claimed_by VARCHAR(128) NULL,
        completed_at DATETIME NULL,
        error_message TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX ${table}_status_next_attempt_idx (status, next_attempt_at),
        INDEX ${table}_domain_created_idx (domain, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
            indexes: []
        }
    }

    throw new Error(`Unsupported database type for equipment sourcer queue writes: ${dbType}`)
}

export async function ensureEquipmentSourcerQueueTable(connection, dbType, table = resolveEquipmentSourcerQueueTableName()) {
    const schema = getSchemaStatements(table, dbType)
    await connection.query(schema.create)

    for (const indexStatement of schema.indexes) {
        try {
            await connection.query(indexStatement)
        } catch (error) {
            const message = String(error?.message || '')
            if (!message.includes('already exists') && !message.includes('Duplicate')) {
                throw error
            }
        }
    }

    if (dbType === 'postgresql') {
        await ensurePermissiveRowLevelSecurity(connection, table, `${table}_rls_policy`)
    }
}

export function equipmentSourcerQueueAvailable() {
    const dbType = detectDatabaseType()
    return dbType === 'postgresql' || dbType === 'mysql'
}