import { enqueueScribeTask } from '@/lib/serviceClient'
import { missingTables, runOptionalDdl } from './pgOptionalDdl.js'

const DEFAULT_SCRIBE_QUEUE_TABLE = 'patient_transcript_scribe_jobs'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveScribeQueueTableName() {
    const table = String(process.env.SCRIBE_QUEUE_TABLE || DEFAULT_SCRIBE_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('SCRIBE_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function getScribeQueueSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        transcription_id BIGINT,
        event_type VARCHAR(80) NOT NULL DEFAULT 'transcript_completed',
        requested_action VARCHAR(80) NOT NULL DEFAULT 'summarize_transcript',
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
                `CREATE INDEX IF NOT EXISTS ${table}_transcription_idx ON ${table} (transcription_id)`
            ]
        }
    }

    throw new Error(`Unsupported database type for scribe queue fallback writes: ${dbType}`)
}

// Exported for the owner schema pass; enqueuePatientScribeJob() would otherwise
// have to insert a job to create the table.
export async function ensureScribeQueueTable(connection, dbType, table = resolveScribeQueueTableName()) {
    return ensureLocalScribeQueueTable(connection, dbType, table)
}

async function ensureLocalScribeQueueTable(connection, dbType, table) {
    const schema = getScribeQueueSchemaStatements(table, dbType)
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

function normalizeDelaySeconds(value) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.floor(parsed))
}

export function isScribeAgentEnabled(metadata) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false

    const patientAgents = metadata.patientAgents
    if (patientAgents && typeof patientAgents === 'object' && !Array.isArray(patientAgents)) {
        return patientAgents.scribe === true
    }

    const legacyAgents = metadata.agents
    if (legacyAgents && typeof legacyAgents === 'object' && !Array.isArray(legacyAgents)) {
        return legacyAgents.scribe === true
    }

    return false
}

async function enqueuePatientScribeJobLocalFallback({
    connection,
    dbType,
    patientId,
    patientName,
    domain,
    metadata,
    eventType,
    requestedAction,
    source,
    transcriptionId,
    delaySeconds,
    scribeConfig,
}) {
    const table = resolveScribeQueueTableName()
    await ensureLocalScribeQueueTable(connection, dbType, table)

    const normalizedDelaySeconds = normalizeDelaySeconds(delaySeconds)
    const payload = {
        domain,
        patientId,
        patientName,
        metadata,
        transcriptionId: transcriptionId || null,
        scribeConfig: scribeConfig && typeof scribeConfig === 'object' ? scribeConfig : undefined,
        source: String(source || 'one:scribe') + ':local-db-fallback'
    }

    const result = await connection.query(
        `
        INSERT INTO ${table} (
          status,
          domain,
          patient_id,
          patient_name,
          transcription_id,
          event_type,
          requested_action,
          payload_json,
          attempts,
          next_attempt_at,
          created_at,
          updated_at
        ) VALUES (
          'queued',
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          0,
          CASE WHEN $8 > 0 THEN NOW() + ($8 || ' seconds')::interval ELSE NULL END,
          NOW(),
          NOW()
        )
        RETURNING id
      `,
        [
            domain,
            patientId,
            patientName || null,
            transcriptionId || null,
            eventType || 'transcript_completed',
            requestedAction || 'summarize_transcript',
            JSON.stringify(payload),
            normalizedDelaySeconds,
        ]
    )

    return {
        success: true,
        queued: true,
        id: result?.rows?.[0]?.id || null,
        domain,
        patientId,
        requestedAction: requestedAction || 'summarize_transcript',
        source: 'local-db-fallback'
    }
}

export async function enqueuePatientScribeJob({
    connection,
    dbType,
    patientId,
    patientName,
    domain,
    metadata,
    eventType = 'transcript_completed',
    requestedAction = 'summarize_transcript',
    source = 'one:transcription-complete',
    transcriptionId = null,
    delaySeconds = 0,
    scribeConfig = null,
}) {
    let upstreamResult = null
    try {
        upstreamResult = await enqueueScribeTask({
            domain,
            patientId,
            patientName,
            transcriptionId,
            eventType,
            requestedAction,
            delaySeconds,
            payload: {
                domain,
                patientId,
                patientName,
                metadata,
                transcriptionId,
                scribeConfig,
                source
            }
        })
    } catch (error) {
        upstreamResult = {
            success: false,
            error: error?.message || 'Failed to enqueue scribe job'
        }
    }

    if (upstreamResult?.success || upstreamResult?.queued === true) {
        return upstreamResult
    }

    const fallbackResult = await enqueuePatientScribeJobLocalFallback({
        connection,
        dbType,
        domain,
        patientId,
        patientName,
        metadata,
        eventType,
        requestedAction,
        source,
        transcriptionId,
        delaySeconds,
        scribeConfig,
    })

    if (!fallbackResult?.success && fallbackResult?.queued !== true) {
        throw new Error(upstreamResult?.error || 'Failed to enqueue scribe job')
    }

    return {
        ...fallbackResult,
        upstreamUnavailable: true,
        upstreamError: upstreamResult?.error || null
    }
}
