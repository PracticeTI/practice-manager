import { detectDatabaseType, getDatabaseConnection } from '../database.js'
import { ensureBillingQueueTable, resolveBillingQueueTableName } from './billingQueue.js'

const DEFAULT_BATCH_SIZE = 10
const DEFAULT_POLL_SECONDS = 200
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_SECONDS = 30
const DEFAULT_RETRY_MAX_SECONDS = 1800
const DEFAULT_STALE_PROCESSING_MINUTES = 15
const DEFAULT_DRAFT_INVOICES_TABLE = 'patient_draft_invoices'

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(1, Math.floor(parsed))
}

function getConfig() {
    return {
        enabled: isTrue(process.env.BILLING_WORKER_ENABLED || 'false'),
        table: resolveBillingQueueTableName(),
        batchSize: parsePositiveInt(process.env.BILLING_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        pollSeconds: parsePositiveInt(process.env.BILLING_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        defaultMaxAttempts: parsePositiveInt(process.env.BILLING_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        retryBaseSeconds: parsePositiveInt(process.env.BILLING_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS),
        retryMaxSeconds: parsePositiveInt(process.env.BILLING_RETRY_MAX_SECONDS, DEFAULT_RETRY_MAX_SECONDS),
        staleProcessingMinutes: parsePositiveInt(
            process.env.BILLING_STALE_PROCESSING_MINUTES,
            DEFAULT_STALE_PROCESSING_MINUTES
        )
    }
}

function truncateText(value, maxLength = 2000) {
    if (!value) return ''
    const text = String(value)
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} chars]`
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveDraftInvoicesTableName() {
    const table = String(process.env.PATIENT_BILLING_DRAFTS_TABLE || DEFAULT_DRAFT_INVOICES_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('PATIENT_BILLING_DRAFTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function parsePayload(row) {
    const raw = row?.payload_json || row?.payload || null
    if (!raw) return {}
    if (typeof raw === 'object') return raw
    try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function parseJsonObject(value) {
    if (!value) return {}
    if (typeof value === 'object' && !Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function getDraftInvoiceSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        summary_text TEXT,
        draft_payload_json TEXT NOT NULL DEFAULT '{}',
        last_job_id BIGINT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT ${table}_domain_patient_unique UNIQUE (domain, patient_id)
      )
    `,
            indexes: [
                `CREATE INDEX IF NOT EXISTS ${table}_domain_patient_idx ON ${table} (domain, patient_id)`,
                `CREATE INDEX IF NOT EXISTS ${table}_updated_idx ON ${table} (updated_at)`
            ]
        }
    }

    if (dbType === 'mysql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        domain VARCHAR(100) NOT NULL,
        patient_id BIGINT NOT NULL,
        patient_name TEXT,
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        summary_text TEXT,
        draft_payload_json LONGTEXT NOT NULL,
        last_job_id BIGINT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY ${table}_domain_patient_unique (domain, patient_id),
        KEY ${table}_domain_patient_idx (domain, patient_id),
        KEY ${table}_updated_idx (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `,
            indexes: []
        }
    }

    throw new Error(`Unsupported database type for billing drafts: ${dbType}`)
}

async function ensureDraftInvoicesTable(connection, dbType, table) {
    const schema = getDraftInvoiceSchemaStatements(table, dbType)
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
}

async function fetchPatientContextPostgres(connection, domain, patientId) {
    const patientResult = await connection.query(
        `
      SELECT id, patient_name, domain, metadata
      FROM patients
      WHERE id = $1 AND domain = $2
      LIMIT 1
    `,
        [patientId, domain]
    )

    return patientResult.rows?.[0] || null
}

async function fetchPatientContextMySql(connection, domain, patientId) {
    const [patientRows] = await connection.execute(
        `
      SELECT id, patient_name, domain, metadata
      FROM patients
      WHERE id = ? AND domain = ?
      LIMIT 1
    `,
        [patientId, domain]
    )

    return patientRows?.[0] || null
}

function buildDraftInvoicePayload({ patient, domain, job, payload }) {
    const patientMetadata = parseJsonObject(patient?.metadata)

    return {
        generatedAt: new Date().toISOString(),
        generator: 'two-billing-worker-mvp',
        criteriaStatus: 'pending_definition',
        note: 'Draft invoice placeholder generated. Billing criteria are not finalized yet.',
        domain,
        patientId: patient?.id || null,
        patientName: patient?.patient_name || '',
        eventType: job?.event_type || 'billing_enabled',
        requestedAction: job?.requested_action || 'generate_draft_invoice',
        source: String(payload?.source || '').trim() || 'one:patient-agent-toggle',
        patientMetadata,
        upstreamPayload: payload
    }
}

async function upsertDraftInvoicePostgres(connection, table, invoiceDraft) {
    const result = await connection.query(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        patient_name,
        status,
        summary_text,
        draft_payload_json,
        last_job_id,
        created_at,
        updated_at
      ) VALUES (
        $1,
        $2,
        $3,
        'draft',
        $4,
        $5,
        $6,
        NOW(),
        NOW()
      )
      ON CONFLICT (domain, patient_id)
      DO UPDATE SET
        patient_name = EXCLUDED.patient_name,
        status = 'draft',
        summary_text = EXCLUDED.summary_text,
        draft_payload_json = EXCLUDED.draft_payload_json,
        last_job_id = EXCLUDED.last_job_id,
        updated_at = NOW()
      RETURNING id
    `,
        [
            invoiceDraft.domain,
            invoiceDraft.patientId,
            invoiceDraft.patientName,
            invoiceDraft.summaryText,
            JSON.stringify(invoiceDraft.payload),
            invoiceDraft.lastJobId
        ]
    )

    return result?.rows?.[0]?.id || null
}

async function upsertDraftInvoiceMySql(connection, table, invoiceDraft) {
    const [result] = await connection.execute(
        `
      INSERT INTO ${table} (
        domain,
        patient_id,
        patient_name,
        status,
        summary_text,
        draft_payload_json,
        last_job_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'draft', ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE
        patient_name = VALUES(patient_name),
        status = 'draft',
        summary_text = VALUES(summary_text),
        draft_payload_json = VALUES(draft_payload_json),
        last_job_id = VALUES(last_job_id),
        updated_at = UTC_TIMESTAMP()
    `,
        [
            invoiceDraft.domain,
            invoiceDraft.patientId,
            invoiceDraft.patientName,
            invoiceDraft.summaryText,
            JSON.stringify(invoiceDraft.payload),
            invoiceDraft.lastJobId
        ]
    )

    return result?.insertId || null
}

async function processBillingJobLocally(connection, dbType, draftInvoicesTable, row, payload) {
    const domain = String(row?.domain || payload?.domain || '').trim().toLowerCase()
    const patientId = Number.parseInt(String(row?.patient_id || payload?.patientId || payload?.patient_id || ''), 10)

    if (!domain) {
        throw new Error('Billing job missing domain')
    }
    if (!Number.isFinite(patientId) || patientId <= 0) {
        throw new Error('Billing job missing valid patient_id')
    }

    const patient = dbType === 'postgresql'
        ? await fetchPatientContextPostgres(connection, domain, patientId)
        : await fetchPatientContextMySql(connection, domain, patientId)

    if (!patient) {
        throw new Error(`Patient not found for domain=${domain}, patient_id=${patientId}`)
    }

    const draftPayload = buildDraftInvoicePayload({
        patient,
        domain,
        job: row,
        payload
    })

    const summaryText = 'Draft invoice placeholder generated. Final billing criteria are pending definition.'

    const draftInvoiceId = dbType === 'postgresql'
        ? await upsertDraftInvoicePostgres(connection, draftInvoicesTable, {
            domain,
            patientId,
            patientName: patient.patient_name,
            summaryText,
            payload: draftPayload,
            lastJobId: row.id
        })
        : await upsertDraftInvoiceMySql(connection, draftInvoicesTable, {
            domain,
            patientId,
            patientName: patient.patient_name,
            summaryText,
            payload: draftPayload,
            lastJobId: row.id
        })

    return {
        draftInvoiceId,
        patientName: patient.patient_name
    }
}

function getBackoffSeconds(attempt, config) {
    const exponent = Math.max(0, attempt - 1)
    const seconds = config.retryBaseSeconds * (2 ** exponent)
    return Math.min(seconds, config.retryMaxSeconds)
}

async function markCompletedPostgres(connection, table, rowId) {
    await connection.query(
        `
      UPDATE ${table}
      SET status = 'completed',
          completed_at = NOW(),
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
        [rowId]
    )
}

async function markCompletedMySql(connection, table, rowId) {
    await connection.execute(
        `
      UPDATE ${table}
      SET status = 'completed',
          completed_at = UTC_TIMESTAMP(),
          error_message = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [rowId]
    )
}

async function markFailedPostgres(connection, table, id, errorMessage, attempts, maxAttempts, nextRetrySeconds) {
    const shouldFail = attempts >= maxAttempts
    const status = shouldFail ? 'failed' : 'queued'

    // `$3` is used both as an assignment target and in the CASE comparison below, so
    // both uses need an explicit ::text cast. Without them Postgres deduces
    // `character varying` from the assignment and `text` from `$3 = 'queued'` and
    // rejects the whole statement with 42P08 "inconsistent types deduced for
    // parameter $3" - which leaves the job stuck in `processing` (UI: "Working").
    await connection.query(
        `
      UPDATE ${table}
      SET attempts = $2::integer,
          status = $3::text,
          error_message = $4,
          next_attempt_at = CASE WHEN $3::text = 'queued' THEN NOW() + ($5::integer || ' seconds')::interval ELSE NULL END,
          updated_at = NOW()
      WHERE id = $1::bigint
    `,
        [id, attempts, status, errorMessage, Math.max(0, Math.floor(Number(nextRetrySeconds) || 0))]
    )
}

async function markFailedMySql(connection, table, id, errorMessage, attempts, maxAttempts, nextRetrySeconds) {
    const shouldFail = attempts >= maxAttempts
    await connection.execute(
        `
      UPDATE ${table}
      SET attempts = ?,
          status = ?,
          error_message = ?,
          next_attempt_at = CASE WHEN ? = 'queued' THEN DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND) ELSE NULL END,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [attempts, shouldFail ? 'failed' : 'queued', errorMessage, shouldFail ? 'failed' : 'queued', nextRetrySeconds, id]
    )
}

async function claimMessagesPostgres(connection, table, batchSize, workerId, defaultMaxAttempts) {
    const sql = `
    WITH candidate AS (
      SELECT id
      FROM ${table}
      WHERE status = 'queued'
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        AND COALESCE(attempts, 0) < COALESCE(max_attempts, $1)
      ORDER BY created_at ASC
      LIMIT $2
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${table} AS q
    SET status = 'processing',
        claimed_at = NOW(),
        claimed_by = $3,
        updated_at = NOW()
    FROM candidate
    WHERE q.id = candidate.id
    RETURNING q.*
  `

    const result = await connection.query(sql, [defaultMaxAttempts, batchSize, workerId])
    return result.rows || []
}

async function claimMessagesMySql(connection, table, batchSize, workerId, defaultMaxAttempts) {
    await connection.beginTransaction()

    try {
        const [rows] = await connection.execute(
            `
        SELECT id
        FROM ${table}
        WHERE status = 'queued'
          AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
          AND COALESCE(attempts, 0) < COALESCE(max_attempts, ?)
        ORDER BY created_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED
      `,
            [defaultMaxAttempts, batchSize]
        )

        const ids = rows.map((row) => row.id)
        if (ids.length === 0) {
            await connection.commit()
            return []
        }

        const placeholders = ids.map(() => '?').join(', ')
        await connection.execute(
            `
        UPDATE ${table}
        SET status = 'processing',
            claimed_at = UTC_TIMESTAMP(),
            claimed_by = ?,
            updated_at = UTC_TIMESTAMP()
        WHERE id IN (${placeholders})
      `,
            [workerId, ...ids]
        )

        const [claimedRows] = await connection.execute(
            `SELECT * FROM ${table} WHERE id IN (${placeholders})`,
            ids
        )

        await connection.commit()
        return claimedRows || []
    } catch (error) {
        await connection.rollback()
        throw error
    }
}

async function reclaimStaleProcessingPostgres(connection, table, staleProcessingMinutes) {
    const result = await connection.query(
        `
      UPDATE ${table}
      SET status = 'queued',
          claimed_at = NULL,
          claimed_by = NULL,
          updated_at = NOW()
      WHERE status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at <= NOW() - ($1 || ' minutes')::interval
      RETURNING id
    `,
        [staleProcessingMinutes]
    )
    return result.rowCount || 0
}

async function reclaimStaleProcessingMySql(connection, table, staleProcessingMinutes) {
    const [result] = await connection.execute(
        `
      UPDATE ${table}
      SET status = 'queued',
          claimed_at = NULL,
          claimed_by = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE status = 'processing'
        AND claimed_at IS NOT NULL
        AND claimed_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
    `,
        [staleProcessingMinutes]
    )
    return result?.affectedRows || 0
}

export async function runBillingWorkerCycle(options = {}) {
    const forceRun = options && typeof options === 'object' && options.forceRun === true
    const config = getConfig()
    if (!config.enabled && !forceRun) {
        return { skipped: true, reason: 'disabled' }
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql' && dbType !== 'mysql') {
        return { skipped: true, reason: `unsupported-db:${dbType || 'none'}` }
    }

    const workerId = `two-billing-worker-${process.pid}`
    let connection = null

    try {
        connection = await getDatabaseConnection()
        await ensureBillingQueueTable(connection, dbType, config.table)
        const draftInvoicesTable = resolveDraftInvoicesTableName()
        await ensureDraftInvoicesTable(connection, dbType, draftInvoicesTable)

        const reclaimed = dbType === 'postgresql'
            ? await reclaimStaleProcessingPostgres(connection, config.table, config.staleProcessingMinutes)
            : await reclaimStaleProcessingMySql(connection, config.table, config.staleProcessingMinutes)

        const claimed = dbType === 'postgresql'
            ? await claimMessagesPostgres(connection, config.table, config.batchSize, workerId, config.defaultMaxAttempts)
            : await claimMessagesMySql(connection, config.table, config.batchSize, workerId, config.defaultMaxAttempts)

        if (claimed.length === 0) {
            return {
                skipped: true,
                reason: reclaimed > 0 ? 'reclaimed-only' : 'empty',
                reclaimed
            }
        }

        let completedCount = 0
        let failedCount = 0

        for (const row of claimed) {
            const attempts = Number(row.attempts || 0) + 1
            const maxAttempts = Number(row.max_attempts || config.defaultMaxAttempts)

            try {
                const payload = parsePayload(row)
                await processBillingJobLocally(connection, dbType, draftInvoicesTable, row, payload)

                if (dbType === 'postgresql') {
                    await markCompletedPostgres(connection, config.table, row.id)
                } else {
                    await markCompletedMySql(connection, config.table, row.id)
                }

                completedCount += 1
            } catch (error) {
                const nextRetrySeconds = getBackoffSeconds(attempts, config)
                const safeErrorMessage = truncateText(error?.message || 'Billing worker failed')

                if (dbType === 'postgresql') {
                    await markFailedPostgres(connection, config.table, row.id, safeErrorMessage, attempts, maxAttempts, nextRetrySeconds)
                } else {
                    await markFailedMySql(connection, config.table, row.id, safeErrorMessage, attempts, maxAttempts, nextRetrySeconds)
                }

                failedCount += 1
            }
        }

        return {
            skipped: false,
            forced: forceRun,
            reclaimed,
            claimed: claimed.length,
            completed: completedCount,
            failed: failedCount
        }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export function startBillingWorker() {
    const config = getConfig()

    if (!config.enabled) {
        console.log('BILLING_WORKER_ENABLED=false - billing worker is disabled')
        return () => { }
    }

    console.log(`BILLING_WORKER_ENABLED=true - billing worker started (table=${config.table}, poll=${config.pollSeconds}s, batch=${config.batchSize})`)
    console.log(`Billing worker stale processing timeout: ${config.staleProcessingMinutes} minute(s)`)

    let timer = null
    let stopped = false

    const run = async () => {
        try {
            const result = await runBillingWorkerCycle()
            if (!result.skipped) {
                console.log(`[${new Date().toISOString()}] Billing worker cycle: reclaimed=${result.reclaimed || 0}, claimed=${result.claimed}, completed=${result.completed}, failed=${result.failed}`)
            } else if ((result.reclaimed || 0) > 0) {
                console.log(`[${new Date().toISOString()}] Billing worker cycle: reclaimed=${result.reclaimed}, no new billing jobs claimed yet`)
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Billing worker cycle failed: ${error?.message || error}`)
        }
    }

    const bootstrap = async () => {
        try {
            if (stopped) return

            await run()
            timer = setInterval(() => {
                run().catch(() => { })
            }, config.pollSeconds * 1000)
        } catch (error) {
            console.error(`[startup] Billing worker did not start cycles: ${error?.message || error}`)
        }
    }

    bootstrap().catch(() => { })

    return () => {
        stopped = true
        if (timer) {
            clearInterval(timer)
        }
    }
}

export default {
    startBillingWorker,
    runBillingWorkerCycle
}
