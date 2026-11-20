/**
 * Website enquiries and their review state.
 *
 * A contact form submission becomes one `contact_form` row in the outbound email
 * queue (see `src/app/api/contact/route.js`), which is the only place the practice
 * keeps the enquiry itself. There is no separate submissions table to read, so the
 * practice-wide Tasks view lists these rows directly.
 *
 * An enquiry is waiting until somebody opens it in Messages. Opening it writes
 * `reviewed_at` on the queue row — the same "reading it is the review" lifecycle the
 * report queue uses (see `patientReportReview.js`) — so the queue answers "has
 * anybody taken this on?" from the record rather than from a parallel state.
 *
 * Submissions queued by Settings → Domains carry their own source
 * (`one-admin-domain-settings-test`). They are routing tests, not somebody waiting
 * for a reply, and never enter the queue.
 */

import { runOptionalDdl } from './pgOptionalDdl.js'

export const CONTACT_ENQUIRY_CATEGORY = 'contact_form'
export const CONTACT_ENQUIRY_TEST_SOURCE = 'one-admin-domain-settings-test'
export const DEFAULT_OUTBOUND_TABLE = 'outbound_messages'

/** The columns the queue reads. `reviewed_at` is added separately: a queue table
 * that predates the marker still answers the query. */
const ENQUIRY_COLUMNS = 'id, domain, category, subject, payload_json, created_at'

/** The review marker's own columns, added to a queue table that predates them. */
const REVIEW_COLUMN_STATEMENTS = [
    'ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP NULL',
    'ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(128)',
]

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveOutboundTableName() {
    const table = String(process.env.EMAIL_QUEUE_TABLE || DEFAULT_OUTBOUND_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EMAIL_QUEUE_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function parseJsonObject(value) {
    if (!value) return {}
    if (typeof value === 'object' && !Array.isArray(value)) return value

    try {
        const parsed = JSON.parse(String(value))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function toIsoString(value) {
    if (!value) return null
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

/**
 * The marker's columns are created lazily, but only an owner credential can run the
 * DDL. A constrained runtime role logs the skip and carries on — the read below
 * already tolerates a table without the column.
 */
export async function ensureContactEnquiryReviewColumns(connection, table = resolveOutboundTableName()) {
    for (const statement of REVIEW_COLUMN_STATEMENTS) {
        await runOptionalDdl(connection, `ALTER TABLE ${table} ${statement}`)
    }
}

export function isTestContactEnquiryRow(row) {
    const payload = parseJsonObject(row?.payload_json ?? row?.payloadJson)
    return String(payload?.source || '').trim() === CONTACT_ENQUIRY_TEST_SOURCE
}

/**
 * One queue row as the queue reads it, or null for a row that is not an enquiry
 * waiting on a person (a routing test, or a row without an id to link to).
 */
export function normalizeContactEnquiryRow(row) {
    if (!row || typeof row !== 'object') return null
    if (row.id === null || row.id === undefined || row.id === '') return null
    if (isTestContactEnquiryRow(row)) return null

    const payload = parseJsonObject(row.payload_json ?? row.payloadJson)

    return {
        id: row.id,
        name: String(payload?.name || '').trim(),
        email: String(payload?.email || '').trim().toLowerCase(),
        subject: String(row.subject || payload?.subject || '').trim(),
        message: String(payload?.message || '').trim(),
        createdAt: toIsoString(row.created_at ?? row.createdAt),
    }
}

/**
 * Every enquiry nobody has opened yet, oldest first so the queue can age the group.
 * A queue table without `reviewed_at` has no reviewed enquiries to hide, so the
 * fallback reports all of them rather than failing the page.
 */
export async function loadUnreviewedContactEnquiries(connection, {
    domain,
    table = resolveOutboundTableName(),
    limit = 100,
} = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 100, 1), 200)
    const baseQuery = `SELECT ${ENQUIRY_COLUMNS} FROM ${table} WHERE domain = $1 AND LOWER(category) = $2`
    const orderAndLimit = 'ORDER BY created_at ASC, id ASC LIMIT $3'

    let rows
    try {
        const result = await connection.query(
            `${baseQuery} AND reviewed_at IS NULL ${orderAndLimit}`,
            [domain, CONTACT_ENQUIRY_CATEGORY, boundedLimit]
        )
        rows = result?.rows || []
    } catch (error) {
        if (String(error?.code || '') !== '42703') throw error

        const result = await connection.query(
            `${baseQuery} ${orderAndLimit}`,
            [domain, CONTACT_ENQUIRY_CATEGORY, boundedLimit]
        )
        rows = result?.rows || []
    }

    return rows.map(normalizeContactEnquiryRow).filter(Boolean)
}

/**
 * Record that a person has opened an enquiry, which is what takes it off the queue.
 * `updated_at` is deliberately left alone: it is the queue worker's bookkeeping, and
 * a review must not read as a new send attempt.
 */
export async function markContactEnquiryReviewed(connection, {
    id,
    domain = '',
    reviewedBy = null,
    table = resolveOutboundTableName(),
} = {}) {
    const messageId = Number.parseInt(String(id), 10)
    if (!Number.isFinite(messageId) || messageId <= 0) return false

    const normalizedDomain = String(domain || '').trim().toLowerCase()
    const conditions = ['id = $1', 'LOWER(category) = $2', 'reviewed_at IS NULL']
    const values = [messageId, CONTACT_ENQUIRY_CATEGORY, reviewedBy]

    if (normalizedDomain) {
        values.push(normalizedDomain)
        conditions.push(`domain = $${values.length}`)
    }

    const result = await connection.query(
        `UPDATE ${table}
         SET reviewed_at = NOW(), reviewed_by = $3
         WHERE ${conditions.join(' AND ')}
         RETURNING id`,
        values
    )

    return (result?.rows || []).length > 0
}
