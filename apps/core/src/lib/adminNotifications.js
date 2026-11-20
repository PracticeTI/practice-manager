/**
 * Admin notifications - persistence and lookup helpers.
 *
 * Per-admin state lives in `user_settings` (see lib/appSettings.js), keyed by
 * (domain, username, key), so it works for DB-managed admins and for the
 * env-configured superadmin alike:
 *
 *   - `notificationPreferences` which notification types the admin wants emailed
 *   - `notificationLastSeenAt`  when they last opened the notification panel,
 *                               which is all the panel needs for an unread count
 *
 * Both are per domain because the defaults and the feed are: an admin may want
 * equipment quote replies from one practice and not another. The feed spans every
 * domain when the caller has no domain scope, and the read marker then uses the
 * same reserved `*` scope so the unread count still matches the feed.
 *
 * The activity feed is derived from data the app already records (outbound and
 * inbound email queue rows, logged chat sessions), so no producer has to be told
 * about notifications. The one table this module owns beyond preferences holds
 * alerts whose email was skipped because every recipient had opted out - without
 * it, an opt-out would mean a supplier reply silently vanished.
 */

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database.js'
import { missingTables } from './pgOptionalDdl.js'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth.js'
import { resolveInboundMessagesTableName } from '@/lib/inboundMessages.js'
import {
    EQUIPMENT_QUOTE_REPLY_CATEGORY,
    buildEquipmentQuoteReplyAlert,
    describeEquipmentQuoteReplyAlert,
    findEquipmentQuoteReplyMatches,
} from '@/lib/equipmentQuoteReplies.js'
import { resolveSourcingReplyTo, resolveSourcingSender, resolveSourcingSenderEmail } from '@/lib/equipmentQuoteRequest.js'
import { deleteUserSetting, getDomainSetting, getUserSetting, setUserSetting } from '@/lib/appSettings.js'
import { getSuperAdminConnection } from '@/lib/domainScopedConnection.js'
import { enqueueOutboundEmail } from '@/lib/serviceClient.js'
import { insertOutboundMessageRow } from '@/lib/outboundMessageQueue.js'
import {
    NOTIFICATION_AUDIENCE,
    NOTIFICATION_DELIVERY,
    applyNotificationRecipientFilter,
    extractEmailAddress,
    isNotificationEnabled,
    normalizeNotificationPreferences,
    normalizeNotificationRecipients,
    notificationAudienceForCategory,
    notificationDeliveryForCategory,
    notificationTypeForCategory,
    resolveNotificationSettingsScope,
    toStoredNotificationPreferences,
} from '@/lib/notificationTypes.js'

const DEFAULT_OUTBOUND_TABLE = 'outbound_messages'
const DEFAULT_CHATS_TABLE = 'chats'
const ADMIN_SUPPRESSED_TABLE = 'admin_suppressed_notifications'
const NOTIFICATION_PREFERENCES_KEY = 'notificationPreferences'
const NOTIFICATION_LAST_SEEN_KEY = 'notificationLastSeenAt'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const OUTBOUND_NOTIFICATION_CATEGORIES = ['contact_form', EQUIPMENT_QUOTE_REPLY_CATEGORY]
const FAILED_MESSAGE_STATUSES = ['failed', 'error', 'bounced']

const NOTIFICATION_HREFS = {
    contact_form: '/admin/messages?direction=outbound',
    inbound_email: '/admin/messages?direction=inbound',
    equipment_quote_reply: '/admin/sourcing',
    email_failure: '/admin/messages?direction=outbound',
    chat_session: '/admin/chat',
}

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

function resolveOutboundTableName() {
    const table = String(process.env.EMAIL_QUEUE_TABLE || DEFAULT_OUTBOUND_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function resolveChatsTableName() {
    const table = String(DEFAULT_CHATS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('CHATS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function normalizeUsername(value) {
    return String(value || '').trim().toLowerCase().slice(0, 100)
}

function normalizeDomainKey(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized || null
}

function toIsoString(value) {
    if (!value) return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function parseJsonObject(value) {
    if (!value) return null
    if (typeof value === 'object' && !Array.isArray(value)) return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
        return null
    }
}

function toPreview(text, max = 140) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`
}

function resolveDatabaseTypeOrThrow() {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Database not configured or unsupported type for admin notifications')
    }
    return dbType
}

/**
 * Run a feed query, treating a missing table as "no activity yet". The outbound,
 * inbound, and chat tables are optional in a fresh environment.
 */
async function queryRows(connection, sql, params) {
    try {
        const result = await connection.query(sql, params)
        return result?.rows || []
    } catch {
        return []
    }
}

async function withConnection(run) {
    resolveDatabaseTypeOrThrow()
    const connection = await getDatabaseConnection()
    try {
        return await run(connection)
    } finally {
        try {
            await connection.end()
        } catch {
            // Ignore close errors
        }
    }
}

function readRequestedDomain(request) {
    try {
        return normalizeDomainKey(new URL(request.url).searchParams.get('domain'))
    } catch {
        return null
    }
}

/**
 * Resolve who is asking and which domain's activity they may see.
 *
 * A domain-scoped admin is pinned to their own domain. A superadmin sees the
 * whole fleet unless they ask for one domain explicitly, which is why `domain`
 * comes back as null rather than erroring the way the domain-settings scope does.
 */
export async function resolveAdminNotificationScope(request) {
    const authHeader = request.headers.get('authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
    const adminUser = token ? await verifyAdminToken(token) : null

    if (!adminUser) {
        return { error: 'Unauthorized: valid admin token required', status: 401 }
    }

    const username = normalizeUsername(adminUser.username)
    if (!username) {
        return { error: 'Forbidden: admin username is missing', status: 403 }
    }

    const adminDomain = normalizeDomainKey(adminUser.domain)
    if (isSuperAdmin(adminUser)) {
        return { adminUser, username, domain: readRequestedDomain(request) || null }
    }

    if (!adminDomain) {
        return { error: 'Forbidden: admin domain scope is missing', status: 403 }
    }

    return { adminUser, username, domain: adminDomain }
}

/**
 * Read one admin's notification preferences, always returned as a complete
 * id -> boolean map so callers never have to reason about missing keys. The
 * domain supplies the defaults an admin has not overridden, and also selects
 * which stored overrides apply.
 */
export async function getAdminNotificationPreferences(username, { domain = null } = {}) {
    const normalizedUsername = normalizeUsername(username)
    if (!normalizedUsername) return normalizeNotificationPreferences(null, domain)

    const stored = await getUserSetting(
        resolveNotificationSettingsScope(domain),
        normalizedUsername,
        NOTIFICATION_PREFERENCES_KEY
    )
    return normalizeNotificationPreferences(parseJsonObject(stored), domain)
}

/**
 * Merge a preferences patch over the stored values and return the full map.
 * Only the values that differ from the domain's defaults are written, so
 * enabling a type that is on by default drops its stored entry — and a map with
 * no differences left removes the row, letting later default changes apply.
 */
export async function updateAdminNotificationPreferences(username, patch, { domain = null } = {}) {
    const normalizedUsername = normalizeUsername(username)
    if (!normalizedUsername) {
        throw new Error('A username is required to store notification preferences')
    }

    const scope = resolveNotificationSettingsScope(domain)
    const patchObject = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}

    const existing = await getUserSetting(scope, normalizedUsername, NOTIFICATION_PREFERENCES_KEY)
    const merged = {
        ...normalizeNotificationPreferences(parseJsonObject(existing), domain),
        ...patchObject,
    }
    const stored = toStoredNotificationPreferences(merged, domain)

    if (Object.keys(stored).length === 0) {
        await deleteUserSetting(scope, normalizedUsername, NOTIFICATION_PREFERENCES_KEY)
    } else if (!(await setUserSetting(scope, normalizedUsername, NOTIFICATION_PREFERENCES_KEY, stored))) {
        throw new Error('Failed to store notification preferences')
    }

    return normalizeNotificationPreferences(stored, domain)
}

/**
 * When the admin last opened the notification panel for this feed scope. Null
 * means they have never looked, so the whole feed counts as unread.
 */
export async function getAdminNotificationLastSeenAt(username, { domain = null } = {}) {
    const normalizedUsername = normalizeUsername(username)
    if (!normalizedUsername) return null

    const stored = await getUserSetting(
        resolveNotificationSettingsScope(domain),
        normalizedUsername,
        NOTIFICATION_LAST_SEEN_KEY
    )
    return toIsoString(stored)
}

export async function markAdminNotificationsSeen(username, seenAt = new Date(), { domain = null } = {}) {
    const normalizedUsername = normalizeUsername(username)
    if (!normalizedUsername) {
        throw new Error('A username is required to record the notification read position')
    }

    const timestamp = seenAt instanceof Date ? seenAt : new Date(seenAt)
    const isoValue = Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : new Date().toISOString()

    const saved = await setUserSetting(
        resolveNotificationSettingsScope(domain),
        normalizedUsername,
        NOTIFICATION_LAST_SEEN_KEY,
        isoValue
    )
    if (!saved) {
        throw new Error('Failed to record the notification read position')
    }
    return isoValue
}

/**
 * The email address notifications would be delivered to for this admin, or null
 * when the account has none (the env-configured superadmin never does).
 */
export async function getAdminNotificationEmail(username) {
    const normalizedUsername = normalizeUsername(username)
    if (!normalizedUsername) return null

    return withConnection(async (connection) => {
        const result = await connection.query(
            'SELECT lower(email) AS email FROM admin_users WHERE lower(username) = $1',
            [normalizedUsername]
        )
        const email = String(result.rows[0]?.email || '').trim()
        return EMAIL_PATTERN.test(email) ? email : null
    }).catch(() => null)
}

function buildNotification({ id, type, title, summary, domain, timestamp, severity = 'info', source = 'activity', emailSuppressed = false }) {
    return {
        id: `${type}:${source}:${id}`,
        type,
        title,
        summary: summary || '',
        domain: domain || '',
        timestamp: toIsoString(timestamp),
        severity,
        emailSuppressed,
        href: NOTIFICATION_HREFS[type] || '/admin',
    }
}

/**
 * Notifications whose email was skipped because every recipient had opted out.
 * Keeping them here is what makes an opt-out safe: the alert leaves the inbox
 * but stays visible in the panel.
 */
// Exported for the owner schema pass: recordSuppressedNotification() is the only
// other caller, and it writes a row.
export async function ensureAdminSuppressedNotificationsTable(connection) {
    if ((await missingTables(connection, [ADMIN_SUPPRESSED_TABLE])).length === 0) return

    await connection.query(`
        CREATE TABLE IF NOT EXISTS ${ADMIN_SUPPRESSED_TABLE} (
            id BIGSERIAL PRIMARY KEY,
            domain VARCHAR(100),
            notification_type VARCHAR(80) NOT NULL,
            category VARCHAR(80),
            title TEXT,
            summary TEXT,
            recipients TEXT,
            payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `)
    await connection.query(
        `CREATE INDEX IF NOT EXISTS ${ADMIN_SUPPRESSED_TABLE}_domain_created_idx ON ${ADMIN_SUPPRESSED_TABLE} (domain, created_at)`
    )
}

/**
 * Record a notification email that was not sent because the recipients had all
 * opted out of that notification type.
 */
export async function recordSuppressedNotification({ domain, category, title, summary, recipients, payload = {} } = {}) {
    const notificationTypeId = notificationTypeForCategory(category)
    if (!notificationTypeId) return null

    const normalizedRecipients = normalizeNotificationRecipients(recipients).join(', ')

    return withConnection(async (connection) => {
        await ensureAdminSuppressedNotificationsTable(connection)
        const result = await connection.query(
            `INSERT INTO ${ADMIN_SUPPRESSED_TABLE}
                (domain, notification_type, category, title, summary, recipients, payload_json, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
             RETURNING id`,
            [
                normalizeDomainKey(domain),
                notificationTypeId,
                String(category || '').trim().toLowerCase() || null,
                String(title || '').trim() || null,
                String(summary || '').trim() || null,
                normalizedRecipients || null,
                JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
            ]
        )
        return result.rows[0]?.id ?? null
    }).catch(() => null)
}

/**
 * Recent admin-relevant activity, newest first. `domain` scopes the feed to one
 * domain; pass null for the fleet-wide view a superadmin sees.
 */
export async function listAdminNotifications({ domain = null, limit = 25 } = {}) {
    const normalizedDomain = normalizeDomainKey(domain)
    const boundedLimit = Math.min(Math.max(Number(limit) || 25, 1), 100)
    // Over-fetch per source so the merged list still fills `boundedLimit` when
    // one source is quiet, while keeping each query bounded on large tables.
    const scopedLimit = Math.min(Math.max(boundedLimit * 2, 50), 200)

    return withConnection(async (connection) => {
        const outboundTable = resolveOutboundTableName()
        const inboundTable = resolveInboundMessagesTableName()
        const chatsTable = resolveChatsTableName()

        const [outboundRows, failureRows, inboundRows, chatRows, suppressedRows] = await Promise.all([
            queryRows(
                connection,
                `SELECT id, domain, category, status, to_email, subject, payload_json, created_at
                 FROM ${outboundTable}
                 WHERE ($1::text IS NULL OR domain = $1)
                   AND category = ANY($2::text[])
                 ORDER BY created_at DESC
                 LIMIT $3`,
                [normalizedDomain, OUTBOUND_NOTIFICATION_CATEGORIES, scopedLimit]
            ),
            queryRows(
                connection,
                `SELECT id, domain, category, status, to_email, subject, error_message, updated_at
                 FROM ${outboundTable}
                 WHERE ($1::text IS NULL OR domain = $1)
                   AND status = ANY($2::text[])
                 ORDER BY updated_at DESC
                 LIMIT $3`,
                [normalizedDomain, FAILED_MESSAGE_STATUSES, scopedLimit]
            ),
            queryRows(
                connection,
                `SELECT id, domain, category, from_email, to_email, subject, created_at
                 FROM ${inboundTable}
                 WHERE ($1::text IS NULL OR domain = $1)
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [normalizedDomain, scopedLimit]
            ),
            queryRows(
                connection,
                `SELECT id, domain, role, session_id, status, metadata, created_at
                 FROM ${chatsTable}
                 WHERE ($1::text IS NULL OR domain = $1)
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [normalizedDomain, scopedLimit]
            ),
            queryRows(
                connection,
                `SELECT id, domain, notification_type, title, summary, created_at
                 FROM ${ADMIN_SUPPRESSED_TABLE}
                 WHERE ($1::text IS NULL OR domain = $1)
                 ORDER BY created_at DESC
                 LIMIT $2`,
                [normalizedDomain, scopedLimit]
            ),
        ])

        const notifications = []
        // One alert email is queued per admin inbox, so the same supplier reply
        // arrives in several rows: the panel lists the reply itself once.
        const listedQuoteReplies = new Set()

        for (const row of outboundRows) {
            if (String(row.category || '').trim().toLowerCase() === EQUIPMENT_QUOTE_REPLY_CATEGORY) {
                const payload = parseJsonObject(row.payload_json) || {}
                const replyId = String(payload.inboundMessageId ?? row.id).trim()
                if (listedQuoteReplies.has(replyId)) continue
                listedQuoteReplies.add(replyId)

                const { title, summary } = describeEquipmentQuoteReplyAlert(payload)

                notifications.push(buildNotification({
                    id: replyId,
                    type: EQUIPMENT_QUOTE_REPLY_CATEGORY,
                    title,
                    summary,
                    domain: row.domain,
                    timestamp: row.created_at,
                }))
                continue
            }

            notifications.push(buildNotification({
                id: row.id,
                type: 'contact_form',
                title: 'New contact form enquiry',
                summary: String(row.subject || '').trim() || `Sent to ${String(row.to_email || '').trim()}`,
                domain: row.domain,
                timestamp: row.created_at,
            }))
        }

        for (const row of failureRows) {
            notifications.push(buildNotification({
                id: row.id,
                type: 'email_failure',
                title: `Email to ${String(row.to_email || 'recipient').trim()} failed`,
                summary: String(row.error_message || row.subject || `Category: ${String(row.category || 'generic')}`).trim(),
                domain: row.domain,
                timestamp: row.updated_at || row.created_at,
                severity: 'error',
            }))
        }

        for (const row of inboundRows) {
            notifications.push(buildNotification({
                id: row.id,
                type: 'inbound_email',
                title: `New email from ${String(row.from_email || 'unknown sender').trim()}`,
                summary: String(row.subject || toPreview(row.category) || '').trim(),
                domain: row.domain,
                timestamp: row.created_at,
            }))
        }

        for (const row of chatRows) {
            const metadata = parseJsonObject(row.metadata) || {}
            const contact = String(metadata.contactName || metadata.contactEmail || '').trim()
            const role = String(row.role || 'Visitor').trim()

            notifications.push(buildNotification({
                id: row.id,
                type: 'chat_session',
                title: `Website chat · ${role}`,
                summary: contact || `Session ${String(row.session_id || '').trim() || 'unavailable'}`,
                domain: row.domain,
                timestamp: row.created_at,
            }))
        }

        for (const row of suppressedRows) {
            const type = String(row.notification_type || '').trim()
            if (!type) continue

            notifications.push(buildNotification({
                id: row.id,
                type,
                title: String(row.title || '').trim() || 'Notification email suppressed',
                summary: String(row.summary || '').trim(),
                domain: row.domain,
                timestamp: row.created_at,
                source: 'suppressed',
                emailSuppressed: true,
            }))
        }

        return notifications
            .filter((item) => Boolean(item.timestamp))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, boundedLimit)
    })
}

/**
 * Recipient addresses that belong to an admin who has opted out of this
 * notification type in this domain. Addresses without a matching admin account
 * are never suppressed - notification preferences only govern admin inboxes.
 *
 * This reads every matching admin's row, which the per-user policy forbids for a
 * browser session, so it runs as an operator (superadmin) connection. Delivery is
 * a system process acting for the whole domain, not on behalf of one admin.
 */
async function findSuppressedNotificationRecipients(addresses, notificationTypeId, domain) {
    const normalizedDomain = normalizeDomainKey(domain)
    if (addresses.length === 0 || !normalizedDomain) return []

    const connection = await getSuperAdminConnection()
    try {
        const result = await connection.query(
            `SELECT lower(u.email) AS email, s.value AS preferences
             FROM admin_users u
             LEFT JOIN user_settings s
               ON s.username = lower(u.username)
              AND s.domain = $2
              AND s.key = $3
             WHERE lower(u.email) = ANY($1::text[])`,
            [addresses, normalizedDomain, NOTIFICATION_PREFERENCES_KEY]
        )

        return (result.rows || [])
            .filter((row) => !isNotificationEnabled(parseJsonObject(row.preferences), notificationTypeId, normalizedDomain))
            .map((row) => String(row.email || '').trim().toLowerCase())
            .filter(Boolean)
    } finally {
        await connection.end?.().catch(() => { })
    }
}

/**
 * Apply notification preferences to an admin-addressed recipient list that the
 * caller has already chosen.
 *
 * Most producers want `resolveNotificationRecipients`, which picks the list from
 * the type's audience first, skips preferences for alerts that are not addressed
 * to admins, and then lands here.
 *
 * Returns the recipients that may still be emailed plus the ones dropped, and
 * `allSuppressed` when nobody is left to email - the caller then records the
 * notification instead of sending it. Preference storage being unavailable, or
 * no domain to look preferences up in, is treated as "no opt-outs" so a database
 * hiccup never blocks delivery.
 */
export async function resolveNotificationEmailRecipients({ recipients, category, domain = null }) {
    const list = normalizeNotificationRecipients(recipients)
    if (list.length === 0) {
        return { recipients: [], suppressed: [], allSuppressed: false }
    }

    const notificationTypeId = notificationTypeForCategory(category)
    if (!notificationTypeId) {
        return { recipients: list, suppressed: [], allSuppressed: false }
    }

    const addresses = [...new Set(list.map(extractEmailAddress).filter(Boolean))]
    if (addresses.length === 0) {
        return { recipients: list, suppressed: [], allSuppressed: false }
    }

    let suppressed = []
    try {
        suppressed = await findSuppressedNotificationRecipients(addresses, notificationTypeId, domain)
    } catch {
        return { recipients: list, suppressed: [], allSuppressed: false }
    }

    return applyNotificationRecipientFilter({ recipients: list, suppressedAddresses: suppressed })
}

/**
 * The addresses a notification type is addressed to, before any preference is
 * applied: the inbox the domain configured for a domain-addressed type, or every
 * admin of the domain for an admin-addressed one.
 *
 * `connection` is optional and only saves opening a second one when the caller
 * already holds a connection, as the inbound webhook does.
 */
export async function resolveNotificationAudienceRecipients({ domain, category, domainRecipients = [], connection = null } = {}) {
    const audience = notificationAudienceForCategory(category)

    if (audience !== NOTIFICATION_AUDIENCE.ADMINS) {
        return { audience, recipients: normalizeNotificationRecipients(domainRecipients) }
    }

    const normalizedDomain = normalizeDomainKey(domain)
    if (!normalizedDomain) return { audience, recipients: [] }

    const recipients = connection
        ? await findDomainAdminEmails(connection, normalizedDomain)
        : await withConnection((opened) => findDomainAdminEmails(opened, normalizedDomain))

    return { audience, recipients }
}

/**
 * The whole recipient decision for a notification: who the type is addressed to,
 * then that list minus the admins who opted out of it.
 *
 * `addressedTo` is the pre-filter list, so a caller recording a fully suppressed
 * notification can name everyone it meant to reach rather than an empty result.
 *
 * Two kinds of type have no preference to apply. A panel-only type has no email
 * side at all, so it resolves to no recipients however the caller asks. A
 * domain-addressed alert goes to the inbox the domain configured, which is a
 * domain setting - a per-admin preference must not veto the site's own copy, so
 * those recipients come back untouched.
 */
export async function resolveNotificationRecipients({ domain, category, domainRecipients = [], connection = null } = {}) {
    const delivery = notificationDeliveryForCategory(category)

    if (delivery !== NOTIFICATION_DELIVERY.EMAIL) {
        return { delivery, audience: null, addressedTo: [], recipients: [], suppressed: [], allSuppressed: false }
    }

    const { audience, recipients: addressedTo } = await resolveNotificationAudienceRecipients({
        domain,
        category,
        domainRecipients,
        connection,
    })

    if (audience !== NOTIFICATION_AUDIENCE.ADMINS) {
        return { delivery, audience, addressedTo, recipients: addressedTo, suppressed: [], allSuppressed: false }
    }

    const { recipients, suppressed, allSuppressed } = await resolveNotificationEmailRecipients({
        recipients: addressedTo,
        category,
        domain,
    })

    return { delivery, audience, addressedTo, recipients, suppressed, allSuppressed }
}

/**
 * The inbox a domain configured for its contact form alerts, or null when the
 * site has none. This is the address a domain-addressed alert email goes to, and
 * the one the notification panel names so an admin is not left guessing where
 * their alerts land.
 */
export async function getDomainContactRecipient(domain) {
    const normalizedDomain = normalizeDomainKey(domain)
    if (!normalizedDomain) return null

    const entry = (await getDomainSetting(normalizedDomain, 'management')) || {}
    const recipient = extractEmailAddress(entry?.contactEmailDelivery?.recipient || entry?.emailContact)

    return EMAIL_PATTERN.test(recipient) ? recipient : null
}

/**
 * Every admin inbox for a domain. These are the addresses notification
 * preferences are stored against, so each admin's own opt-out applies and an
 * admin without an email simply cannot be reached.
 */
async function findDomainAdminEmails(connection, domain) {
    try {
        const result = await connection.query(
            `SELECT lower(email) AS email
             FROM admin_users
             WHERE lower(domain) = $1 AND email IS NOT NULL`,
            [domain]
        )

        return [...new Set((result?.rows || [])
            .map((row) => String(row.email || '').trim().toLowerCase())
            .filter((email) => EMAIL_PATTERN.test(email)))]
    } catch (error) {
        console.warn('Failed to load domain admin emails:', error?.message || error)
        return []
    }
}

/**
 * Who a quote reply alert comes from: the domain's sourcing mailbox, with the
 * configured reply-to so an admin can answer straight from the alert.
 */
async function loadEquipmentQuoteReplyAlertSender(domain) {
    const entry = (await getDomainSetting(domain, 'management')) || {}
    const displayName = String(entry?.displayName || '').trim() || domain
    const replyToAddress = extractEmailAddress(entry?.sourcingReplyToEmail) || resolveSourcingSenderEmail(displayName)

    return {
        senderEmail: resolveSourcingSender(displayName),
        replyToEmail: resolveSourcingReplyTo(entry?.sourcingReplyToName, replyToAddress),
    }
}

/**
 * Alert a domain's admins that a supplier answered an equipment quote request.
 *
 * Each admin is emailed at their own address, so one admin turning the type off
 * does not silence the others. The alerts are queued as outbound emails, which
 * are also the rows the feed reads, so a domain where everyone opted out still
 * sees the reply in the panel marked `Email off` instead of losing it.
 */
export async function notifyEquipmentQuoteReplies({
    connection,
    domain,
    sourcingItems = [],
    inboundMessageId = null,
    origin = '',
} = {}) {
    const normalizedDomain = normalizeDomainKey(domain)
    if (!normalizedDomain) return null

    const matches = findEquipmentQuoteReplyMatches(sourcingItems, inboundMessageId)
    if (matches.length === 0) return null

    // The alert type is admin-addressed, so the domain's own admins are who it
    // is addressed to - resolved the same way as any other type, and each one
    // filtered against their own preference.
    const { addressedTo, recipients } = await resolveNotificationRecipients({
        connection,
        domain: normalizedDomain,
        category: EQUIPMENT_QUOTE_REPLY_CATEGORY,
    })
    if (addressedTo.length === 0) return { delivered: false, reason: 'no-admin-email' }

    const { senderEmail, replyToEmail } = await loadEquipmentQuoteReplyAlertSender(normalizedDomain)
    const alert = buildEquipmentQuoteReplyAlert({
        domain: normalizedDomain,
        matches,
        senderEmail,
        replyToEmail,
        sourcingUrl: origin ? `${origin}/admin/sourcing` : '',
    })
    if (!alert) return null

    if (recipients.length === 0) {
        await recordSuppressedNotification({
            domain: normalizedDomain,
            category: EQUIPMENT_QUOTE_REPLY_CATEGORY,
            title: alert.title,
            summary: alert.summary,
            recipients: addressedTo,
            payload: alert.payload,
        })
        return { delivered: false, reason: 'suppressed' }
    }

    const queued = []

    for (const recipient of recipients) {
        const outboundMessage = {
            toEmail: recipient,
            category: EQUIPMENT_QUOTE_REPLY_CATEGORY,
            subject: alert.subject,
            text: alert.text,
            html: alert.html,
            payload: alert.payload,
        }

        try {
            const upstream = await enqueueOutboundEmail(outboundMessage)
            if (upstream?.success) {
                queued.push({ recipient, queueId: upstream?.id ?? null, localFallback: false })
                continue
            }
        } catch (error) {
            console.warn('Failed to queue equipment quote reply alert:', error?.message || error)
        }

        const queueId = await insertOutboundMessageRow(connection, outboundMessage)
        queued.push({ recipient, queueId, localFallback: true })
    }

    return { delivered: true, queued }
}
