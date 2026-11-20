import { detectDatabaseType, getDatabaseConnection } from '../database.js'
import { ensurePermissiveRowLevelSecurity } from './postgresRls.js'

const DEFAULT_TABLE = 'inbound_messages'
const DEFAULT_BATCH_SIZE = 10
const DEFAULT_POLL_SECONDS = 200
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_SECONDS = 60
const DEFAULT_RETRY_MAX_SECONDS = 3600
const DEFAULT_STALE_PROCESSING_MINUTES = 15
// Domain stamped on an inbound message that arrived without one. A deployment that
// serves more than one practice sets INBOUND_DEFAULT_DOMAIN to the practice that
// owns the shared inbox.
const FALLBACK_INBOUND_DOMAIN = String(process.env.INBOUND_DEFAULT_DOMAIN || 'default').trim() || 'default'

function isTrue(value) {
    return String(value).toLowerCase() === 'true'
}

function parsePositiveInt(value, fallback) {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return fallback
    return Math.max(1, Math.floor(parsed))
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveInboundEmailTableName() {
    const table = String(
        process.env.INBOUND_EMAIL_TABLE ||
        process.env.INBOUND_MESSAGES_TABLE ||
        DEFAULT_TABLE
    ).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('INBOUND_EMAIL_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

export function getConfig() {
    const emailWorkerEnabled = isTrue(process.env.EMAIL_WORKER_ENABLED || 'false')
    const explicitlyEnabled = process.env.INBOUND_EMAIL_WORKER_ENABLED !== undefined
        ? isTrue(process.env.INBOUND_EMAIL_WORKER_ENABLED)
        : emailWorkerEnabled

    return {
        enabled: explicitlyEnabled,
        table: resolveInboundEmailTableName(),
        batchSize: parsePositiveInt(process.env.INBOUND_EMAIL_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        pollSeconds: parsePositiveInt(process.env.INBOUND_EMAIL_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        maxAttempts: parsePositiveInt(process.env.INBOUND_EMAIL_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        retryBaseSeconds: parsePositiveInt(process.env.INBOUND_EMAIL_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS),
        retryMaxSeconds: parsePositiveInt(process.env.INBOUND_EMAIL_RETRY_MAX_SECONDS, DEFAULT_RETRY_MAX_SECONDS),
        staleProcessingMinutes: parsePositiveInt(
            process.env.INBOUND_EMAIL_STALE_PROCESSING_MINUTES,
            DEFAULT_STALE_PROCESSING_MINUTES
        )
    }
}

export async function ensureInboundEmailTable(connection, dbType, table = DEFAULT_TABLE) {
    if (dbType === 'postgresql') {
        await connection.query(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id BIGSERIAL PRIMARY KEY,
            status VARCHAR(32) NOT NULL DEFAULT 'received',
            from_email VARCHAR(320) NOT NULL,
            to_email VARCHAR(320) NOT NULL,
            domain VARCHAR(100),
            subject TEXT,
            text_body TEXT,
            html_body TEXT,
            payload_json JSONB DEFAULT '{}'::jsonb,
            category VARCHAR(80) NOT NULL DEFAULT 'generic',
            attempts INTEGER NOT NULL DEFAULT 0,
            max_attempts INTEGER DEFAULT 5,
            next_attempt_at TIMESTAMPTZ NULL,
            claimed_at TIMESTAMPTZ NULL,
            claimed_by VARCHAR(128) NULL,
            processed_at TIMESTAMPTZ NULL,
            provider VARCHAR(32) NOT NULL DEFAULT 'resend',
            provider_message_id TEXT,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `)

        await connection.query(`CREATE INDEX IF NOT EXISTS ${table}_status_next_attempt_idx ON ${table} (status, next_attempt_at)`)
        await connection.query(`CREATE INDEX IF NOT EXISTS ${table}_domain_created_idx ON ${table} (domain, created_at)`)
        await connection.query(`CREATE INDEX IF NOT EXISTS ${table}_claimed_at_idx ON ${table} (claimed_at)`)
        await connection.query(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_provider_msg_id_uidx ON ${table} (provider, provider_message_id) WHERE provider_message_id IS NOT NULL`)

        await ensurePermissiveRowLevelSecurity(connection, table)
    } else if (dbType === 'mysql') {
        await connection.execute(`
          CREATE TABLE IF NOT EXISTS ${table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            status VARCHAR(32) NOT NULL DEFAULT 'received',
            from_email VARCHAR(320) NOT NULL,
            to_email VARCHAR(320) NOT NULL,
            domain VARCHAR(100) NULL,
            subject TEXT,
            text_body LONGTEXT,
            html_body LONGTEXT,
            payload_json JSON NOT NULL,
            category VARCHAR(80) NOT NULL DEFAULT 'generic',
            attempts INT NOT NULL DEFAULT 0,
            max_attempts INT DEFAULT 5,
            next_attempt_at DATETIME NULL,
            claimed_at DATETIME NULL,
            claimed_by VARCHAR(128) NULL,
            processed_at DATETIME NULL,
            provider VARCHAR(32) NOT NULL DEFAULT 'resend',
            provider_message_id TEXT,
            error_message TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX ${table}_status_next_attempt_idx (status, next_attempt_at),
            INDEX ${table}_domain_created_idx (domain, created_at),
            INDEX ${table}_claimed_at_idx (claimed_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `)
    }
}

function safeJsonParse(value) {
    if (!value) return null
    if (typeof value === 'object') return value
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function getBackoffSeconds(attempt, config) {
    const exponent = Math.max(0, attempt - 1)
    const seconds = config.retryBaseSeconds * (2 ** exponent)
    return Math.min(seconds, config.retryMaxSeconds)
}

/**
 * If Resend sent only an email_id without bodies, attempt to fetch the full content from Resend API
 */
async function fetchResendInboundEmailContent(emailId) {
    const apiKey = process.env.EMAIL_RESEND_API_KEY || process.env.RESEND_API_KEY
    if (!apiKey || !emailId) return null

    try {
        // Try receiving endpoint first, then standard emails endpoint
        const endpoints = [
            `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
            `https://api.resend.com/emails/${encodeURIComponent(emailId)}`
        ]

        for (const url of endpoints) {
            const res = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
            if (res.ok) {
                const data = await res.json()
                if (data && (data.text || data.html || data.subject)) {
                    return data
                }
            }
        }
    } catch (err) {
        console.warn(`[inbound-email] Failed to fetch full email for ${emailId} from Resend: ${err.message}`)
    }
    return null
}

async function processInboundMessage(connection, dbType, row, config) {
    const payload = safeJsonParse(row.payload_json) || {}
    let textBody = row.text_body || ''
    let htmlBody = row.html_body || ''
    let subject = row.subject || ''

    // If message body is missing and we have a Resend email ID, try fetching it
    if ((!textBody && !htmlBody) && row.provider_message_id) {
        const fetched = await fetchResendInboundEmailContent(row.provider_message_id)
        if (fetched) {
            textBody = fetched.text || textBody
            htmlBody = fetched.html || htmlBody
            subject = fetched.subject || subject
        }
    }

    // Process domain inference if missing
    let domain = row.domain || FALLBACK_INBOUND_DOMAIN

    // Process category inference if generic
    let category = row.category || 'generic'
    const subjectLower = (subject || '').toLowerCase()
    const textLower = (textBody || '').toLowerCase()

    if (category === 'generic' || category === 'inbound_email') {
        if (subjectLower.includes('quote') || textLower.includes('quotation') || textLower.includes('pricing')) {
            category = 'quote_response'
        } else if (subjectLower.startsWith('re:') || subjectLower.includes('reply')) {
            category = 'email_reply'
        } else if (subjectLower.includes('contact') || subjectLower.includes('inquiry')) {
            category = 'contact_inquiry'
        }
    }

    // Mark as processed
    if (dbType === 'postgresql') {
        await connection.query(
            `UPDATE ${config.table}
             SET status = 'processed',
                 domain = $1,
                 category = $2,
                 subject = COALESCE(subject, $3),
                 text_body = COALESCE(text_body, $4),
                 html_body = COALESCE(html_body, $5),
                 processed_at = NOW(),
                 updated_at = NOW(),
                 error_message = NULL
             WHERE id = $6`,
            [domain, category, subject || null, textBody || null, htmlBody || null, row.id]
        )
    } else if (dbType === 'mysql') {
        await connection.execute(
            `UPDATE ${config.table}
             SET status = 'processed',
                 domain = ?,
                 category = ?,
                 subject = COALESCE(subject, ?),
                 text_body = COALESCE(text_body, ?),
                 html_body = COALESCE(html_body, ?),
                 processed_at = NOW(),
                 updated_at = NOW(),
                 error_message = NULL
             WHERE id = ?`,
            [domain, category, subject || null, textBody || null, htmlBody || null, row.id]
        )
    }

    return { id: row.id, status: 'processed', domain, category }
}

async function markFailed(connection, dbType, row, error, config) {
    const attempts = Number(row.attempts || 0) + 1
    const maxAttempts = Number(row.max_attempts || config.maxAttempts)
    const failed = attempts >= maxAttempts
    const nextStatus = failed ? 'failed' : 'received'
    const backoffSeconds = getBackoffSeconds(attempts, config)
    const errorMessage = String(error?.message || error || 'Unknown error').slice(0, 2000)

    if (dbType === 'postgresql') {
        await connection.query(
            `UPDATE ${config.table}
             SET status = $1,
                 attempts = $2,
                 next_attempt_at = CASE WHEN $1 = 'failed' THEN NULL ELSE NOW() + ($3 || ' seconds')::INTERVAL END,
                 error_message = $4,
                 updated_at = NOW()
             WHERE id = $5`,
            [nextStatus, attempts, backoffSeconds, errorMessage, row.id]
        )
    } else if (dbType === 'mysql') {
        await connection.execute(
            `UPDATE ${config.table}
             SET status = ?,
                 attempts = ?,
                 next_attempt_at = CASE WHEN ? = 'failed' THEN NULL ELSE DATE_ADD(NOW(), INTERVAL ? SECOND) END,
                 error_message = ?,
                 updated_at = NOW()
             WHERE id = ?`,
            [nextStatus, attempts, nextStatus, backoffSeconds, errorMessage, row.id]
        )
    }
}

async function recoverStaleJobs(connection, dbType, config) {
    const staleMinutes = config.staleProcessingMinutes

    if (dbType === 'postgresql') {
        const result = await connection.query(
            `UPDATE ${config.table}
             SET status = 'received',
                 claimed_at = NULL,
                 claimed_by = NULL,
                 updated_at = NOW()
             WHERE status = 'processing'
               AND claimed_at < NOW() - ($1 || ' minutes')::INTERVAL
             RETURNING id`,
            [staleMinutes]
        )
        return result?.rows?.length || 0
    }

    if (dbType === 'mysql') {
        const [result] = await connection.execute(
            `UPDATE ${config.table}
             SET status = 'received',
                 claimed_at = NULL,
                 claimed_by = NULL,
                 updated_at = NOW()
             WHERE status = 'processing'
               AND claimed_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [staleMinutes]
        )
        return result?.affectedRows || 0
    }

    return 0
}

async function claimPendingBatch(connection, dbType, config, workerId) {
    if (dbType === 'postgresql') {
        const result = await connection.query(
            `WITH pending AS (
                SELECT id
                FROM ${config.table}
                WHERE status IN ('received', 'queued')
                  AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
                ORDER BY created_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
             )
             UPDATE ${config.table} t
             SET status = 'processing',
                 claimed_at = NOW(),
                 claimed_by = $2,
                 updated_at = NOW()
             FROM pending
             WHERE t.id = pending.id
             RETURNING t.*`,
            [config.batchSize, workerId]
        )
        return result?.rows || []
    }

    if (dbType === 'mysql') {
        const [rows] = await connection.execute(
            `SELECT id, status, from_email, to_email, domain, subject, text_body, html_body, payload_json, category, attempts, max_attempts, provider, provider_message_id
             FROM ${config.table}
             WHERE status IN ('received', 'queued')
               AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
             ORDER BY created_at ASC
             LIMIT ?
             FOR UPDATE`,
            [config.batchSize]
        )
        if (!rows.length) return []

        const ids = rows.map((r) => r.id)
        const placeholders = ids.map(() => '?').join(',')
        await connection.execute(
            `UPDATE ${config.table}
             SET status = 'processing', claimed_at = NOW(), claimed_by = ?, updated_at = NOW()
             WHERE id IN (${placeholders})`,
            [workerId, ...ids]
        )
        return rows
    }

    return []
}

/**
 * Sync / backfill recent emails from Resend inbox into inbound_messages table
 */
export async function syncResendInbox(connection, dbType, config) {
    const apiKey = process.env.EMAIL_RESEND_API_KEY || process.env.RESEND_API_KEY
    if (!apiKey) return { synced: 0 }

    let rawEmails = []
    const endpoints = [
        'https://api.resend.com/emails/receiving',
        'https://api.resend.com/emails'
    ]

    for (const endpoint of endpoints) {
        try {
            const res = await fetch(endpoint, {
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                }
            })
            if (res.ok) {
                const data = await res.json()
                const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data) ? data : [])
                if (list.length > 0) {
                    rawEmails = list
                    break
                }
            }
        } catch (err) {
            console.warn(`[inbound-email] Failed to list emails from ${endpoint}: ${err.message}`)
        }
    }

    if (!rawEmails.length) return { synced: 0 }

    let synced = 0
    for (const item of rawEmails) {
        const emailId = item?.id || item?.email_id
        if (!emailId) continue

        let fullItem = item
        if (!item.text && !item.text_body && !item.html && !item.html_body) {
            const detail = await fetchResendInboundEmailContent(emailId)
            if (detail) {
                fullItem = { ...item, ...detail }
            }
        }

        const fromEmail = String(fullItem.from || fullItem.from_email || fullItem.sender || '').trim().toLowerCase()
        const toEmail = String(
            Array.isArray(fullItem.to) ? fullItem.to[0] : (fullItem.to || fullItem.to_email || '')
        ).trim().toLowerCase()
        const subject = String(fullItem.subject || '').trim()
        const textBody = String(fullItem.text || fullItem.text_body || fullItem.body || '').trim()
        const htmlBody = String(fullItem.html || fullItem.html_body || '').trim()

        const domain = FALLBACK_INBOUND_DOMAIN

        let category = 'inbound_email'
        const subLower = subject.toLowerCase()
        if (subLower.includes('quote') || textBody.toLowerCase().includes('quotation')) category = 'quote_response'
        else if (subLower.startsWith('re:')) category = 'email_reply'

        if (dbType === 'postgresql') {
            const result = await connection.query(
                `INSERT INTO ${config.table} (
                    status, from_email, to_email, domain, subject, text_body, html_body, payload_json, category, provider, provider_message_id, attempts, max_attempts, created_at, updated_at
                 ) VALUES ('received', $1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'resend', $9, 0, 5, NOW(), NOW())
                 ON CONFLICT (provider, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
                 RETURNING id`,
                [fromEmail, toEmail, domain, subject || null, textBody || null, htmlBody || null, JSON.stringify(fullItem), category, emailId]
            )
            if (result?.rows?.[0]?.id) synced += 1
        }
    }

    return { synced }
}

export async function runInboundEmailWorkerCycle() {
    const config = getConfig()
    if (!config.enabled) {
        return { skipped: true, reason: 'disabled' }
    }

    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') {
        return { skipped: true, reason: 'unsupported-db' }
    }

    let connection = null
    const workerId = `inbound-worker-${process.pid}-${Date.now()}`

    try {
        connection = await getDatabaseConnection()
        await ensureInboundEmailTable(connection, dbType, config.table)

        // Sync fresh/existing emails from Resend inbox if API key is present
        await syncResendInbox(connection, dbType, config).catch((err) => {
            console.warn('[inbound-email] Resend inbox sync warning:', err.message)
        })

        const reclaimed = await recoverStaleJobs(connection, dbType, config)
        const batch = await claimPendingBatch(connection, dbType, config, workerId)

        if (!batch.length) {
            return {
                skipped: reclaimed === 0,
                reason: reclaimed > 0 ? 'reclaimed-only' : 'empty-queue',
                reclaimed,
                claimed: 0,
                processed: 0,
                failed: 0
            }
        }

        let processed = 0
        let failed = 0

        for (const row of batch) {
            try {
                await processInboundMessage(connection, dbType, row, config)
                processed += 1
            } catch (err) {
                console.error(`[inbound-email] Error processing message #${row.id}:`, err)
                await markFailed(connection, dbType, row, err, config)
                failed += 1
            }
        }

        return {
            skipped: false,
            reclaimed,
            claimed: batch.length,
            processed,
            failed
        }
    } catch (error) {
        console.error('[inbound-email] Cycle error:', error)
        throw error
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export function startInboundEmailWorker() {
    const config = getConfig()
    if (!config.enabled) {
        return
    }

    let running = false

    const poll = async () => {
        if (running) return
        running = true
        try {
            const result = await runInboundEmailWorkerCycle()
            if (!result.skipped && result.claimed > 0) {
                console.log(`[inbound-email] Cycle completed: claimed=${result.claimed}, processed=${result.processed}, failed=${result.failed}`)
            }
        } catch (error) {
            console.error('[inbound-email] Worker cycle failed:', error.message)
        } finally {
            running = false
        }
    }

    // Initial run
    setTimeout(poll, 1000)
    // Recurring interval
    setInterval(poll, config.pollSeconds * 1000)
}
