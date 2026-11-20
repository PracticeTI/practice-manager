import { detectDatabaseType, getDatabaseConnection } from '../database.js'

const DEFAULT_TABLE = 'outbound_messages'
const DEFAULT_BATCH_SIZE = 10
const DEFAULT_POLL_SECONDS = 30
const DEFAULT_MAX_ATTEMPTS = 5
const DEFAULT_RETRY_BASE_SECONDS = 60
const DEFAULT_RETRY_MAX_SECONDS = 3600
const DEFAULT_STALE_PROCESSING_MINUTES = 15

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
        enabled: isTrue(process.env.EMAIL_WORKER_ENABLED || 'false'),
        table: DEFAULT_TABLE,
        batchSize: parsePositiveInt(process.env.EMAIL_BATCH_SIZE, DEFAULT_BATCH_SIZE),
        pollSeconds: parsePositiveInt(process.env.EMAIL_POLL_SECONDS, DEFAULT_POLL_SECONDS),
        defaultMaxAttempts: parsePositiveInt(process.env.EMAIL_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
        retryBaseSeconds: parsePositiveInt(process.env.EMAIL_RETRY_BASE_SECONDS, DEFAULT_RETRY_BASE_SECONDS),
        retryMaxSeconds: parsePositiveInt(process.env.EMAIL_RETRY_MAX_SECONDS, DEFAULT_RETRY_MAX_SECONDS),
        staleProcessingMinutes: parsePositiveInt(
            process.env.EMAIL_STALE_PROCESSING_MINUTES,
            DEFAULT_STALE_PROCESSING_MINUTES
        )
    }
}

function getProvider() {
    return String(process.env.EMAIL_PROVIDER || 'resend').trim().toLowerCase()
}

async function ensureRowLevelSecurityPostgres(connection, table) {
    await connection.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
}

function getQueueSchemaStatements(table, dbType) {
    if (dbType === 'postgresql') {
        return {
            create: `
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
    `,
            additions: [
                'ADD COLUMN IF NOT EXISTS status VARCHAR(32) NOT NULL DEFAULT \'queued\'',
                'ADD COLUMN IF NOT EXISTS to_email VARCHAR(320) NOT NULL',
                'ADD COLUMN IF NOT EXISTS category VARCHAR(80) NOT NULL DEFAULT \'generic\'',
                'ADD COLUMN IF NOT EXISTS domain VARCHAR(100)',
                'ADD COLUMN IF NOT EXISTS subject TEXT',
                'ADD COLUMN IF NOT EXISTS text_body TEXT',
                'ADD COLUMN IF NOT EXISTS html_body TEXT',
                'ADD COLUMN IF NOT EXISTS payload_json TEXT NOT NULL DEFAULT \'{}\'',
                'ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0',
                'ADD COLUMN IF NOT EXISTS max_attempts INTEGER',
                'ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NULL',
                'ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ NULL',
                'ADD COLUMN IF NOT EXISTS claimed_by VARCHAR(128)',
                'ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL',
                'ADD COLUMN IF NOT EXISTS provider VARCHAR(32)',
                'ADD COLUMN IF NOT EXISTS provider_message_id TEXT',
                'ADD COLUMN IF NOT EXISTS error_message TEXT',
                'ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
                'ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()'
            ]
        }
    }

    if (dbType === 'mysql') {
        return {
            create: `
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
        status VARCHAR(32) NOT NULL DEFAULT 'queued',
        to_email VARCHAR(320) NOT NULL,
        category VARCHAR(80) NOT NULL DEFAULT 'generic',
                domain VARCHAR(100) NULL,
        subject TEXT,
        text_body LONGTEXT,
        html_body LONGTEXT,
        payload_json LONGTEXT NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NULL,
        next_attempt_at DATETIME NULL,
        claimed_at DATETIME NULL,
        claimed_by VARCHAR(128) NULL,
        sent_at DATETIME NULL,
        provider VARCHAR(32) NULL,
        provider_message_id TEXT,
        error_message TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `,
            additions: [
                'ADD COLUMN status VARCHAR(32) NOT NULL DEFAULT \'queued\'',
                'ADD COLUMN to_email VARCHAR(320) NOT NULL',
                'ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT \'generic\'',
                'ADD COLUMN domain VARCHAR(100) NULL',
                'ADD COLUMN subject TEXT',
                'ADD COLUMN text_body LONGTEXT',
                'ADD COLUMN html_body LONGTEXT',
                'ADD COLUMN payload_json LONGTEXT NOT NULL',
                'ADD COLUMN attempts INT NOT NULL DEFAULT 0',
                'ADD COLUMN max_attempts INT NULL',
                'ADD COLUMN next_attempt_at DATETIME NULL',
                'ADD COLUMN claimed_at DATETIME NULL',
                'ADD COLUMN claimed_by VARCHAR(128) NULL',
                'ADD COLUMN sent_at DATETIME NULL',
                'ADD COLUMN provider VARCHAR(32) NULL',
                'ADD COLUMN provider_message_id TEXT',
                'ADD COLUMN error_message TEXT',
                'ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
                'ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'
            ]
        }
    }

    throw new Error(`Unsupported database type for email queue writes: ${dbType}`)
}

export async function ensureEmailQueueTable(connection, dbType, table) {
    const schema = getQueueSchemaStatements(table, dbType)

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

    if (dbType === 'postgresql') {
        await ensureRowLevelSecurityPostgres(connection, table)
        await upgradeLegacyTimestampColumnsPostgres(connection, table)
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

function truncateText(value, maxLength = 20000) {
    if (!value) return ''
    const text = String(value)
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength)}\n\n[truncated ${text.length - maxLength} chars]`
}

function resolveCategory(row, payload) {
    return String(row.category || payload?.category || payload?.type || 'generic').trim().toLowerCase()
}

// Web form alerts (contact form submissions) can be sent from a per-domain
// mailbox so recipients can tell which site an enquiry came from, e.g.
//   example  ->  "Example Contact Form" <example.contact@mail.example.com>
// instead of the shared EMAIL_FROM mailbox. Producers normally set
// payload.senderEmail themselves (the core resolves it from the domain's
// configured display name); this is the fallback for rows queued without one, so
// the mail domain comes from the deployment, not from a hardcoded brand.
const CONTACT_FORM_EMAIL_DOMAIN = String(process.env.FORM_ALERT_EMAIL_DOMAIN || '').trim()

function toMailboxSlug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function formatDomainKeyLabel(domainKey) {
    return String(domainKey || '')
        .split(/[^a-z0-9]+/i)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(' ')
}

export function resolveContactFormSender(domainKey) {
    if (!CONTACT_FORM_EMAIL_DOMAIN) return ''

    const slug = toMailboxSlug(domainKey)
    if (!slug) return ''

    const label = formatDomainKeyLabel(slug)
    if (!label) return ''

    return `${label} Contact Form <${slug}.contact@${CONTACT_FORM_EMAIL_DOMAIN}>`
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function renderContactForm(payload) {
    const submittedAt = payload?.submitted_at || payload?.created_at || new Date().toISOString()
    const name = payload?.name || payload?.full_name || 'Unknown'
    const fromEmail = payload?.email || payload?.from_email || 'Unknown'
    const subject = payload?.subject || 'New contact form submission'
    const message = payload?.message || payload?.body || ''

    const text = [
        'Contact Form Submission',
        `Submitted at: ${submittedAt}`,
        `Name: ${name}`,
        `Email: ${fromEmail}`,
        `Subject: ${subject}`,
        '',
        'Message:',
        truncateText(message)
    ].join('\n')

    return {
        subject,
        text,
        html: `<h2>Contact Form Submission</h2><p><strong>Submitted at:</strong> ${escapeHtml(submittedAt)}</p><p><strong>Name:</strong> ${escapeHtml(name)}</p><p><strong>Email:</strong> ${escapeHtml(fromEmail)}</p><p><strong>Subject:</strong> ${escapeHtml(subject)}</p><pre>${escapeHtml(truncateText(message))}</pre>`
    }
}

function renderChatbotLog(payload) {
    const sessionId = payload?.session_id || payload?.sessionId || 'unknown'
    const source = payload?.source || 'chatbot'
    const transcript = Array.isArray(payload?.messages)
        ? payload.messages
            .map((entry, index) => `${index + 1}. [${entry?.role || 'unknown'}] ${entry?.content || ''}`)
            .join('\n')
        : payload?.transcript || payload?.log || ''

    const summary = payload?.summary || ''
    const text = [
        'Chatbot Conversation Log',
        `Session: ${sessionId}`,
        `Source: ${source}`,
        summary ? `Summary: ${summary}` : '',
        '',
        'Transcript:',
        truncateText(transcript)
    ].filter(Boolean).join('\n')

    return {
        subject: payload?.subject || `Chatbot log: ${sessionId}`,
        text,
        html: `<h2>Chatbot Conversation Log</h2><p><strong>Session:</strong> ${escapeHtml(sessionId)}</p><p><strong>Source:</strong> ${escapeHtml(source)}</p>${summary ? `<p><strong>Summary:</strong> ${escapeHtml(summary)}</p>` : ''}<pre>${escapeHtml(truncateText(transcript))}</pre>`
    }
}

function renderBackupReport(payload) {
    const backupAt = payload?.backup_at || payload?.completed_at || new Date().toISOString()
    const status = payload?.status || 'completed'
    const location = payload?.location || payload?.url || payload?.bucket_path || 'not provided'
    const bytes = Number(payload?.size_bytes || payload?.bytes || 0)
    const sizeMb = bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(2)} MB` : 'unknown'

    const text = [
        'Website Backup Report',
        `Backup time: ${backupAt}`,
        `Status: ${status}`,
        `Size: ${sizeMb}`,
        `Location: ${location}`,
        payload?.notes ? `Notes: ${payload.notes}` : ''
    ].filter(Boolean).join('\n')

    return {
        subject: payload?.subject || `Website backup ${status}`,
        text,
        html: `<h2>Website Backup Report</h2><p><strong>Backup time:</strong> ${escapeHtml(backupAt)}</p><p><strong>Status:</strong> ${escapeHtml(status)}</p><p><strong>Size:</strong> ${escapeHtml(sizeMb)}</p><p><strong>Location:</strong> ${escapeHtml(location)}</p>${payload?.notes ? `<p><strong>Notes:</strong> ${escapeHtml(payload.notes)}</p>` : ''}`
    }
}

export function buildMessage(row) {
    const payload = safeJsonParse(row.payload_json || row.payload || null) || {}
    const category = resolveCategory(row, payload)

    const recipient = row.to_email || row.recipient_email || payload.to || payload.email
    if (!recipient) {
        throw new Error(`Message ${row.id} is missing recipient email`)
    }

    const explicitSubject = row.subject || payload.subject || null
    const explicitText = row.text_body || payload.text || null
    const explicitHtml = row.html_body || payload.html || null

    // Per-message sender override lets domain workflows (e.g. equipment sourcing)
    // send from their own mailbox instead of the global EMAIL_FROM address.
    // Contact form alerts fall back to a mailbox derived from their domain.
    const explicitFrom = String(payload.senderEmail || payload.sender_email || '').trim()
    const domainKey = String(row.domain || payload.domain || '').trim().toLowerCase()
    const from = explicitFrom
        || (category === 'contact_form' ? resolveContactFormSender(domainKey) : '')
        || null
    const replyTo = String(payload.replyToEmail || payload.reply_to_email || '').trim() || from
    const bcc = String(payload.bccEmail || payload.bcc_email || '').trim() || null

    if (explicitSubject && (explicitText || explicitHtml)) {
        return {
            to: recipient,
            subject: explicitSubject,
            text: explicitText || '',
            html: explicitHtml || null,
            from,
            replyTo,
            bcc,
            category
        }
    }

    let rendered
    switch (category) {
        case 'contact_form':
            rendered = renderContactForm(payload)
            break
        case 'chatbot_log':
        case 'chatbot_logs':
            rendered = renderChatbotLog(payload)
            break
        case 'website_backup':
        case 'backup_report':
            rendered = renderBackupReport(payload)
            break
        default:
            rendered = {
                subject: explicitSubject || `Notification: ${category}`,
                text: explicitText || truncateText(JSON.stringify(payload, null, 2)),
                html: explicitHtml || null
            }
            break
    }

    return {
        to: recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        from,
        replyTo,
        bcc,
        category
    }
}

async function sendWithResend(message) {
    const apiKey = process.env.EMAIL_RESEND_API_KEY
    const from = message.from || process.env.EMAIL_FROM

    if (!apiKey) {
        throw new Error('EMAIL_RESEND_API_KEY is required for EMAIL_PROVIDER=resend')
    }

    if (!from) {
        throw new Error('EMAIL_FROM is required for EMAIL_PROVIDER=resend')
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to: [message.to],
            bcc: message.bcc ? [message.bcc] : undefined,
            reply_to: message.replyTo || undefined,
            subject: message.subject,
            text: message.text,
            html: message.html || undefined
        })
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
        throw new Error(`Resend send failed: ${response.status} ${data?.message || JSON.stringify(data)}`)
    }

    return {
        provider: 'resend',
        messageId: data?.id || null
    }
}

async function sendWithSmtp(message) {
    const host = process.env.EMAIL_SMTP_HOST
    const port = Number(process.env.EMAIL_SMTP_PORT || 587)
    const user = process.env.EMAIL_SMTP_USER
    const pass = process.env.EMAIL_SMTP_PASS
    const from = message.from || process.env.EMAIL_FROM

    if (!host || !from) {
        throw new Error('EMAIL_SMTP_HOST and EMAIL_FROM are required for EMAIL_PROVIDER=smtp')
    }

    // Keep nodemailer runtime-only so unrelated API routes do not fail to compile
    // when SMTP deps are unavailable in a local dev container.
    const nodemailerModuleName = ['node', 'mailer'].join('')
    const nodemailerImport = await import(nodemailerModuleName)
    const nodemailer = nodemailerImport?.default || nodemailerImport
    if (typeof nodemailer?.createTransport !== 'function') {
        throw new Error('nodemailer is installed but does not expose createTransport')
    }
    const transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined
    })

    const sent = await transport.sendMail({
        from,
        to: message.to,
        bcc: message.bcc || undefined,
        replyTo: message.replyTo || undefined,
        subject: message.subject,
        text: message.text,
        html: message.html || undefined
    })

    return {
        provider: 'smtp',
        messageId: sent?.messageId || null
    }
}

async function sendWithSmtp2Go(message) {
    const apiKey = process.env.EMAIL_SMTP2GO_API_KEY
    const from = message.from || process.env.EMAIL_FROM
    const endpoint = process.env.EMAIL_SMTP2GO_API_ENDPOINT || 'https://api.smtp2go.com/v3/email/send'

    if (!apiKey) {
        throw new Error('EMAIL_SMTP2GO_API_KEY is required for EMAIL_PROVIDER=smtp2go')
    }

    if (!from) {
        throw new Error('EMAIL_FROM is required for EMAIL_PROVIDER=smtp2go')
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            api_key: apiKey,
            sender: from,
            to: [message.to],
            bcc: message.bcc ? [message.bcc] : undefined,
            subject: message.subject,
            text_body: message.text,
            html_body: message.html || undefined,
            custom_headers: message.replyTo
                ? [{ header: 'Reply-To', value: message.replyTo }]
                : undefined
        })
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
        throw new Error(`SMTP2GO send failed: ${response.status} ${JSON.stringify(data)}`)
    }

    const accepted = Number(data?.data?.succeeded || data?.data?.accepted || 0)
    if (!accepted) {
        throw new Error(`SMTP2GO send rejected: ${JSON.stringify(data)}`)
    }

    return {
        provider: 'smtp2go',
        messageId: data?.data?.email_id || data?.request_id || null
    }
}

async function sendMessage(message) {
    const provider = getProvider()

    switch (provider) {
        case 'resend':
            return sendWithResend(message)
        case 'smtp':
            return sendWithSmtp(message)
        case 'smtp2go':
            return sendWithSmtp2Go(message)
        default:
            throw new Error(`Unsupported EMAIL_PROVIDER: ${provider}`)
    }
}

function getBackoffSeconds(attempt, config) {
    const exponent = Math.max(0, attempt - 1)
    const seconds = config.retryBaseSeconds * (2 ** exponent)
    return Math.min(seconds, config.retryMaxSeconds)
}

async function queueTableExistsPostgres(connection, table) {
    const result = await connection.query(
        'SELECT COALESCE(to_regclass($1), to_regclass($2)) IS NOT NULL AS exists',
        [table, `public.${table}`]
    )
    return Boolean(result?.rows?.[0]?.exists)
}

const LEGACY_TIMESTAMP_COLUMNS = ['next_attempt_at', 'claimed_at', 'sent_at', 'created_at', 'updated_at']

// Older versions of the queue table declared these columns as `timestamp
// without time zone` and filled them with NOW(), which stores wall-clock time
// in the Postgres session timezone. Readers then reinterpret that wall clock in
// whatever timezone they run in, so the same instant came back hours off.
// Convert to `timestamptz`, reading the legacy wall clock in the timezone it
// was written with.
async function upgradeLegacyTimestampColumnsPostgres(connection, table) {
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
              ALTER COLUMN "${column}" TYPE TIMESTAMPTZ
              USING "${column}" AT TIME ZONE current_setting('TimeZone')
            `
        )
    }
}

async function createQueueTablePostgres(connection, table) {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGSERIAL PRIMARY KEY,
        status VARCHAR(20) NOT NULL DEFAULT 'queued',
        to_email TEXT NOT NULL,
                domain VARCHAR(100),
        subject TEXT,
        text_body TEXT,
        html_body TEXT,
        payload_json JSONB,
        category VARCHAR(100),
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER,
        next_attempt_at TIMESTAMPTZ,
        claimed_at TIMESTAMPTZ,
        claimed_by TEXT,
        sent_at TIMESTAMPTZ,
        provider VARCHAR(100),
        provider_message_id TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ${table}_status_check CHECK (status IN ('queued', 'processing', 'sent', 'failed'))
      )
    `)

    await connection.query(`CREATE INDEX IF NOT EXISTS ${table}_status_next_attempt_idx ON ${table} (status, next_attempt_at)`)
    await connection.query(`CREATE INDEX IF NOT EXISTS ${table}_claimed_at_idx ON ${table} (claimed_at)`)
    await ensureRowLevelSecurityPostgres(connection, table)
}

async function queueTableExistsMySql(connection, table) {
    const [rows] = await connection.execute(
        `
      SELECT COUNT(*) AS table_count
      FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?
    `,
        [table]
    )

    return Number(rows?.[0]?.table_count || 0) > 0
}

async function createQueueTableMySql(connection, table) {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS ${table} (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        status ENUM('queued', 'processing', 'sent', 'failed') NOT NULL DEFAULT 'queued',
        to_email VARCHAR(320) NOT NULL,
                domain VARCHAR(100) NULL,
        subject TEXT,
        text_body LONGTEXT,
        html_body LONGTEXT,
        payload_json JSON,
        category VARCHAR(100),
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NULL,
        next_attempt_at DATETIME NULL,
        claimed_at DATETIME NULL,
        claimed_by VARCHAR(255) NULL,
        sent_at DATETIME NULL,
        provider VARCHAR(100) NULL,
        provider_message_id VARCHAR(255) NULL,
        error_message TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX ${table}_status_next_attempt_idx (status, next_attempt_at),
        INDEX ${table}_claimed_at_idx (claimed_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
}

async function ensureQueueTableOnStartup(config) {
    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') {
        console.log(`[startup] Email queue table check skipped: unsupported db (${dbType || 'none'})`)
        return
    }

    let connection = null

    try {
        connection = await getDatabaseConnection()

        const exists = dbType === 'postgresql'
            ? await queueTableExistsPostgres(connection, config.table)
            : await queueTableExistsMySql(connection, config.table)

        if (exists) {
            if (dbType === 'postgresql') {
                await ensureRowLevelSecurityPostgres(connection, config.table)
                await upgradeLegacyTimestampColumnsPostgres(connection, config.table)
            }
            return
        }

        console.log(`[startup] Email queue table check result: ${config.table} missing, creating...`)

        if (dbType === 'postgresql') {
            await createQueueTablePostgres(connection, config.table)
        } else {
            await createQueueTableMySql(connection, config.table)
        }

        console.log(`[startup] Email queue table created: ${config.table}`)
    } catch (error) {
        console.error(`[startup] Email queue table check failed: ${error.message}`)
        throw error
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
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
    UPDATE ${table} AS m
    SET status = 'processing',
        claimed_at = NOW(),
        claimed_by = $3,
        updated_at = NOW()
    FROM candidate
    WHERE m.id = candidate.id
    RETURNING m.*
  `

    const result = await connection.query(sql, [defaultMaxAttempts, batchSize, workerId])
    return result.rows || []
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

        const ids = rows.map(row => row.id)
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

async function markSentPostgres(connection, table, id, providerMeta) {
    await connection.query(
        `
      UPDATE ${table}
      SET status = 'sent',
          sent_at = NOW(),
          provider = $2,
          provider_message_id = $3,
          error_message = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
        [id, providerMeta.provider, providerMeta.messageId]
    )
}

async function markSentMySql(connection, table, id, providerMeta) {
    await connection.execute(
        `
      UPDATE ${table}
      SET status = 'sent',
          sent_at = UTC_TIMESTAMP(),
          provider = ?,
          provider_message_id = ?,
          error_message = NULL,
          updated_at = UTC_TIMESTAMP()
      WHERE id = ?
    `,
        [providerMeta.provider, providerMeta.messageId, id]
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

export async function runEmailWorkerCycle(options = {}) {
    const forceRun = options && typeof options === 'object' && options.forceRun === true
    const config = getConfig()
    if (!config.enabled && !forceRun) {
        return { skipped: true, reason: 'disabled' }
    }

    const dbType = detectDatabaseType()
    if (!dbType || dbType === 'mongodb') {
        return { skipped: true, reason: `unsupported-db:${dbType || 'none'}` }
    }

    const workerId = `two-email-worker-${process.pid}`
    let connection = null

    try {
        connection = await getDatabaseConnection()
        await ensureEmailQueueTable(connection, dbType, config.table)

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

        let sentCount = 0
        let failedCount = 0

        for (const row of claimed) {
            const attempts = Number(row.attempts || 0) + 1
            const maxAttempts = Number(row.max_attempts || config.defaultMaxAttempts)

            try {
                const message = buildMessage(row)
                const providerMeta = await sendMessage(message)

                if (dbType === 'postgresql') {
                    await markSentPostgres(connection, config.table, row.id, providerMeta)
                } else {
                    await markSentMySql(connection, config.table, row.id, providerMeta)
                }

                sentCount += 1
            } catch (error) {
                const nextRetrySeconds = getBackoffSeconds(attempts, config)
                const safeErrorMessage = truncateText(error.message, 2000)

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
            sent: sentCount,
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

export function startEmailWorker() {
    const config = getConfig()

    if (!config.enabled) {
        console.log('EMAIL_WORKER_ENABLED=false - outbound email worker is disabled')
        return () => { }
    }

    console.log(`EMAIL_WORKER_ENABLED=true - outbound email worker started (provider=${getProvider()}, table=${config.table}, poll=${config.pollSeconds}s, batch=${config.batchSize})`)
    console.log(`Email worker stale processing timeout: ${config.staleProcessingMinutes} minute(s)`)

    let timer = null
    let stopped = false

    const run = async () => {
        try {
            const result = await runEmailWorkerCycle()
            if (!result.skipped) {
                console.log(`[${new Date().toISOString()}] Email worker cycle: reclaimed=${result.reclaimed || 0}, claimed=${result.claimed}, sent=${result.sent}, failed=${result.failed}`)
            } else if ((result.reclaimed || 0) > 0) {
                console.log(`[${new Date().toISOString()}] Email worker cycle: reclaimed=${result.reclaimed}, no new messages claimed yet`)
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Email worker cycle failed: ${error.message}`)
        }
    }

    const bootstrap = async () => {
        try {
            await ensureQueueTableOnStartup(config)

            if (stopped) {
                return
            }

            await run()
            timer = setInterval(() => {
                run().catch(() => { })
            }, config.pollSeconds * 1000)
        } catch (error) {
            console.error(`[startup] Email worker did not start cycles: ${error.message}`)
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
    startEmailWorker,
    runEmailWorkerCycle,
    ensureEmailQueueTable
}