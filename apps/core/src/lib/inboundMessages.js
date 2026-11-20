import { DEFAULT_CONTENT_DOMAIN, VALID_DOMAIN_MODES } from './domainMode.js'
import { runOptionalDdl, whenTablesMissing } from './pgOptionalDdl.js'

const byDomainMode = VALID_DOMAIN_MODES

const DEFAULT_INBOUND_TABLE = 'inbound_messages'

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveInboundMessagesTableName() {
    const table = String(
        process.env.INBOUND_EMAIL_TABLE ||
        process.env.INBOUND_MESSAGES_TABLE ||
        DEFAULT_INBOUND_TABLE
    ).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('INBOUND_EMAIL_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

export function normalizeEmailAddress(value) {
    if (!value) return ''
    if (typeof value === 'object' && value.email) {
        return String(value.email).trim().toLowerCase()
    }
    const str = String(value).trim()
    // Extract email from "Name <email@example.com>" if present
    const angleMatch = str.match(/<([^>]+)>/)
    if (angleMatch && angleMatch[1]) {
        return angleMatch[1].trim().toLowerCase()
    }
    return str.toLowerCase()
}

export function normalizeEmailList(value) {
    if (!value) return []
    if (Array.isArray(value)) {
        return value.map(normalizeEmailAddress).filter(Boolean)
    }
    return [normalizeEmailAddress(value)].filter(Boolean)
}

export function inferDomainFromRecipient(toEmail, payloadDomain = null) {
    if (payloadDomain && String(payloadDomain).trim()) {
        return String(payloadDomain).trim().toLowerCase()
    }

    const normalized = normalizeEmailAddress(toEmail)
    if (!normalized) return DEFAULT_CONTENT_DOMAIN

    const [localPart, domainPart] = normalized.split('@')

    // Check prefix patterns like <domain>.sourcing@... or <domain>.support@...
    if (localPart) {
        const dotPrefix = localPart.split('.')[0]?.toLowerCase()
        if (byDomainMode.includes(dotPrefix)) {
            return dotPrefix
        }
        const dashPrefix = localPart.split('-')[0]?.toLowerCase()
        if (byDomainMode.includes(dashPrefix)) {
            return dashPrefix
        }
    }

    // Check domain patterns
    if (domainPart) {
        const d = domainPart.toLowerCase()
        const matched = byDomainMode.find((mode) => d.includes(mode))
        if (matched) return matched
    }

    return DEFAULT_CONTENT_DOMAIN
}

export function inferCategory(subject = '', textBody = '', headers = {}) {
    const sub = String(subject || '').toLowerCase()
    const body = String(textBody || '').toLowerCase()

    if (sub.includes('quote') || body.includes('quotation') || body.includes('pricing')) {
        return 'quote_response'
    }
    if (sub.startsWith('re:') || sub.includes('reply')) {
        return 'email_reply'
    }
    if (sub.includes('contact') || sub.includes('inquiry') || sub.includes('enquiry')) {
        return 'contact_inquiry'
    }
    if (sub.includes('patient') || sub.includes('referral') || sub.includes('intake')) {
        return 'clinical_intake'
    }

    return 'inbound_email'
}

export function parseResendInboundPayload(body) {
    if (!body || typeof body !== 'object') {
        throw new Error('Invalid inbound payload body')
    }

    // Resend webhook events have structure: { type: 'email.received', data: { ... } }
    // Direct receiving webhook may have data directly at top level
    const data = (body.type === 'email.received' && body.data) ? body.data : body

    const fromEmail = normalizeEmailAddress(data.from || data.from_email || data.sender)
    const toList = normalizeEmailList(data.to || data.to_email || data.recipient || data.recipients)
    const toEmail = toList[0] || ''
    const subject = String(data.subject || '').trim()
    const textBody = String(data.text || data.text_body || data.body || '').trim()
    const htmlBody = String(data.html || data.html_body || '').trim()
    const providerMessageId = String(data.email_id || data.id || data.message_id || data.messageId || '').trim() || null
    const domain = inferDomainFromRecipient(toEmail, data.domain || body.domain)
    const category = inferCategory(subject, textBody, data.headers || {})

    return {
        fromEmail,
        toEmail,
        toList,
        domain,
        category,
        subject: subject || null,
        textBody: textBody || null,
        htmlBody: htmlBody || null,
        provider: 'resend',
        providerMessageId,
        headers: data.headers || {},
        attachments: Array.isArray(data.attachments) ? data.attachments : [],
        rawPayload: body
    }
}

export async function ensureInboundMessagesTable(connection, dbType, table = DEFAULT_INBOUND_TABLE) {
    if (dbType === 'postgresql') {
        await whenTablesMissing(connection, [table], async () => {
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
        })
        // Optional upgrade: an existing table is not the runtime's to index, and
        // `CREATE INDEX` needs ownership even when the index is already there.
        await runOptionalDdl(connection, `CREATE UNIQUE INDEX IF NOT EXISTS ${table}_provider_msg_id_uidx ON ${table} (provider, provider_message_id) WHERE provider_message_id IS NOT NULL`)

        try {
            // Install the tenant domain policy rather than a permissive one. A
            // `USING (true)` policy here silently overrode the domain policy on
            // every boot, because RLS ORs the policies that apply to a row.
            const { tenantPolicyStatements } = await import('./rlsPolicies.js')
            const policyRole = String(process.env.POSTGRES_RLS_RUNTIME_ROLE || '').trim() || 'practice_manager_app'
            for (const statement of tenantPolicyStatements(table, { role: policyRole })) {
                await connection.query(statement)
            }
        } catch {
            // Ignore policy setup if user lacks superuser or already applied
        }
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

export async function insertInboundMessage(connection, dbType, message, table = DEFAULT_INBOUND_TABLE) {
    await ensureInboundMessagesTable(connection, dbType, table)

    const payloadString = typeof message.rawPayload === 'string'
        ? message.rawPayload
        : JSON.stringify(message.rawPayload || {})

    if (dbType === 'postgresql') {
        const result = await connection.query(
            `INSERT INTO ${table} (
        status,
        from_email,
        to_email,
        domain,
        subject,
        text_body,
        html_body,
        payload_json,
        category,
        provider,
        provider_message_id,
        attempts,
        max_attempts,
        created_at,
        updated_at
      ) VALUES (
        'received',
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::jsonb,
        $8,
        $9,
        $10,
        0,
        5,
        NOW(),
        NOW()
      )
      ON CONFLICT (provider, provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING
      RETURNING id, created_at`,
            [
                message.fromEmail,
                message.toEmail,
                message.domain,
                message.subject || null,
                message.textBody || null,
                message.htmlBody || null,
                payloadString,
                message.category || 'inbound_email',
                message.provider || 'resend',
                message.providerMessageId || null
            ]
        )

        return result.rows?.[0] || null
    }

    if (dbType === 'mysql') {
        const [result] = await connection.execute(
            `INSERT INTO ${table} (
        status,
        from_email,
        to_email,
        domain,
        subject,
        text_body,
        html_body,
        payload_json,
        category,
        provider,
        provider_message_id,
        attempts,
        max_attempts,
        created_at,
        updated_at
      ) VALUES (
        'received',
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        ?,
        0,
        5,
        NOW(),
        NOW()
      )`,
            [
                message.fromEmail,
                message.toEmail,
                message.domain,
                message.subject || null,
                message.textBody || null,
                message.htmlBody || null,
                payloadString,
                message.category || 'inbound_email',
                message.provider || 'resend',
                message.providerMessageId || null
            ]
        )

        return { id: result.insertId }
    }

    throw new Error(`Unsupported database type for inbound message insert: ${dbType}`)
}
