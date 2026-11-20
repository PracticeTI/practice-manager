import { detectDatabaseType } from '../database.js'
import { ensurePermissiveRowLevelSecurity } from './postgresRls.js'

const DEFAULT_TABLE = 'patient_analysis_jobs'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveAnalysisQueueTableName() {
    const table = String(process.env.ANALYSIS_QUEUE_TABLE || DEFAULT_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('ANALYSIS_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
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
        event_type VARCHAR(80) NOT NULL DEFAULT 'analyst_enabled',
        requested_action VARCHAR(80) NOT NULL DEFAULT 'prepare_fca_suggestions',
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
            additions: [
                'ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT \'queued\'',
                'ADD COLUMN IF NOT EXISTS domain VARCHAR(100) NOT NULL DEFAULT \'\'',
                'ADD COLUMN IF NOT EXISTS patient_id BIGINT NOT NULL DEFAULT 0',
                'ADD COLUMN IF NOT EXISTS patient_name TEXT',
                'ADD COLUMN IF NOT EXISTS event_type VARCHAR(80) NOT NULL DEFAULT \'analyst_enabled\'',
                'ADD COLUMN IF NOT EXISTS requested_action VARCHAR(80) NOT NULL DEFAULT \'prepare_fca_suggestions\'',
                'ADD COLUMN IF NOT EXISTS payload_json TEXT NOT NULL DEFAULT \'{}\'',
                'ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0',
                'ADD COLUMN IF NOT EXISTS max_attempts INTEGER',
                'ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMP NULL',
                'ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP NULL',
                'ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(128)',
                'ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP NULL',
                'ADD COLUMN IF NOT EXISTS error_message TEXT',
                'ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP',
                'ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
            ],
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
        event_type VARCHAR(80) NOT NULL DEFAULT 'analyst_enabled',
        requested_action VARCHAR(80) NOT NULL DEFAULT 'prepare_fca_suggestions',
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
            additions: [
                'ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT \'queued\'',
                'ADD COLUMN domain VARCHAR(100) NOT NULL',
                'ADD COLUMN patient_id BIGINT NOT NULL',
                'ADD COLUMN patient_name TEXT',
                'ADD COLUMN event_type VARCHAR(80) NOT NULL DEFAULT \'analyst_enabled\'',
                'ADD COLUMN requested_action VARCHAR(80) NOT NULL DEFAULT \'prepare_fca_suggestions\'',
                'ADD COLUMN payload_json LONGTEXT NOT NULL',
                'ADD COLUMN attempts INT NOT NULL DEFAULT 0',
                'ADD COLUMN max_attempts INT NULL',
                'ADD COLUMN next_attempt_at DATETIME NULL',
                'ADD COLUMN claimed_at DATETIME NULL',
                'ADD COLUMN claimed_by VARCHAR(128) NULL',
                'ADD COLUMN completed_at DATETIME NULL',
                'ADD COLUMN error_message TEXT',
                'ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
                'ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
            ],
            indexes: [
                `CREATE INDEX ${table}_status_next_attempt_idx ON ${table} (status, next_attempt_at)`,
                `CREATE INDEX ${table}_domain_created_idx ON ${table} (domain, created_at)`
            ]
        }
    }

    throw new Error(`Unsupported database type for analysis queue writes: ${dbType}`)
}

export async function ensureAnalysisQueueTable(connection, dbType, table = resolveAnalysisQueueTableName()) {
    const schema = getSchemaStatements(table, dbType)
    await connection.query(schema.create)

    for (const addition of schema.additions) {
        try {
            await connection.query(`ALTER TABLE ${table} ${addition}`)
        } catch (error) {
            const message = String(error?.message || '')
            if (!message.includes('Duplicate') && !message.includes('already exists')) {
                throw error
            }
        }
    }

    for (const indexStatement of schema.indexes) {
        try {
            await connection.query(indexStatement)
        } catch (error) {
            const message = String(error?.message || '')
            const duplicate = message.includes('Duplicate key name') || message.includes('already exists')
            if (!duplicate) {
                throw error
            }
        }
    }

    if (dbType === 'postgresql') {
        await ensurePermissiveRowLevelSecurity(connection, table, `${table}_rls_policy`)
    }
}

export function analysisQueueAvailable() {
    const dbType = detectDatabaseType()
    return dbType === 'postgresql' || dbType === 'mysql'
}