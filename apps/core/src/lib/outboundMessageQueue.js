import { whenTablesMissing } from './pgOptionalDdl.js'

// Shared schema handling for the outbound email queue (`outbound_messages`).
//
// The queue is written by this app (contact form / domain delivery tests) and by
// the email worker in the `two` project, so the table definition has to stay
// identical in both places.

const LEGACY_TIMESTAMP_COLUMNS = [
    'next_attempt_at',
    'claimed_at',
    'sent_at',
    'created_at',
    'updated_at'
]

const DEFAULT_QUEUE_TABLE = 'outbound_messages'

function quoteColumn(column) {
    return `"${column}"`
}

// Older queue tables declared their timestamps as `timestamp without time zone`
// and filled them with `NOW()`, which stores wall-clock time in the Postgres
// session timezone. node-postgres then re-reads that wall clock in the Node
// process timezone, so the same instant came back hours off in the admin
// Messages UI. Converting to `timestamptz` keeps the instant explicit: the
// legacy wall clock is read back in the timezone it was written with.
async function upgradeLegacyTimestampColumns(connection, table) {
    const result = await connection.query(
        `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND data_type = 'timestamp without time zone'
        `,
        [table]
    )

    for (const row of result?.rows || []) {
        const column = String(row?.column_name || '').trim()
        if (!LEGACY_TIMESTAMP_COLUMNS.includes(column)) continue

        await connection.query(
            `
                ALTER TABLE ${table}
                ALTER COLUMN ${quoteColumn(column)} TYPE TIMESTAMPTZ
                USING ${quoteColumn(column)} AT TIME ZONE current_setting('TimeZone')
            `
        )
    }
}

export async function ensureOutboundMessageQueueTable(connection, table) {
    if (!connection) {
        throw new Error('Database connection is required')
    }
    if (!table) {
        throw new Error('Outbound message queue table name is required')
    }

    await whenTablesMissing(connection, [table], async () => {
        await connection.query(`
            CREATE TABLE IF NOT EXISTS ${table} (
                id BIGSERIAL PRIMARY KEY,
                status VARCHAR(32) NOT NULL DEFAULT 'queued',
                to_email VARCHAR(320) NOT NULL,
                category VARCHAR(80) NOT NULL DEFAULT 'generic',
                domain VARCHAR(100),
                subject TEXT,
                text_body TEXT,
                html_body TEXT,
                payload_json TEXT NOT NULL DEFAULT '{}',
                attempts INTEGER NOT NULL DEFAULT 0,
                max_attempts INTEGER,
                next_attempt_at TIMESTAMPTZ NULL,
                claimed_at TIMESTAMPTZ NULL,
                claimed_by VARCHAR(128),
                sent_at TIMESTAMPTZ NULL,
                provider VARCHAR(32),
                provider_message_id TEXT,
                error_message TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `)
    })
    await connection.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS domain VARCHAR(100)`).catch(() => { })
    await upgradeLegacyTimestampColumns(connection, table)
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveOutboundMessageQueueTable() {
    const table = String(process.env.EMAIL_QUEUE_TABLE || DEFAULT_QUEUE_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

/**
 * Queue a message straight into the local table. Used as the fallback when the
 * domain backend cannot be reached, so the email is still delivered by the
 * worker picking the row up later instead of being dropped.
 */
export async function insertOutboundMessageRow(connection, message) {
    if (!connection) throw new Error('Database connection is required')

    const table = resolveOutboundMessageQueueTable()
    await ensureOutboundMessageQueueTable(connection, table)

    const values = [
        message?.toEmail,
        String(message?.category || 'generic').trim() || 'generic',
        String(message?.payload?.domain || '').trim() || null,
        message?.subject || null,
        message?.text || null,
    ]
    const payloadJson = JSON.stringify(message?.payload && typeof message.payload === 'object' ? message.payload : {})

    try {
        const result = await connection.query(
            `INSERT INTO ${table} (status, to_email, category, domain, subject, text_body, html_body, payload_json, attempts, created_at, updated_at)
             VALUES ('queued', $1, $2, $3, $4, $5, $6, $7, 0, NOW(), NOW()) RETURNING id`,
            [...values, message?.html || null, payloadJson]
        )
        return result?.rows?.[0]?.id ?? null
    } catch (error) {
        const reason = String(error?.message || '').toLowerCase()
        if (!reason.includes('html_body')) throw error

        const result = await connection.query(
            `INSERT INTO ${table} (status, to_email, category, domain, subject, text_body, payload_json, attempts, created_at, updated_at)
             VALUES ('queued', $1, $2, $3, $4, $5, $6, 0, NOW(), NOW()) RETURNING id`,
            [...values, payloadJson]
        )
        return result?.rows?.[0]?.id ?? null
    }
}
