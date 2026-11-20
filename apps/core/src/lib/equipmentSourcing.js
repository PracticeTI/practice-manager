// Server-side equipment sourcing loader.
//
// An item is "in sourcing" once a quote request email has been queued for it
// (`sourcingStatus: quote_requested`). When a supplier replies, the inbound
// message is matched back to that request and the stored status moves on to
// `quote_received` so the patient page, the admin dashboard card and the
// sourcing page all agree.
//
// Keep the pure status/label helpers in `@/lib/equipmentSourcingStatus` - this
// module imports the database helpers, so it must never be imported by a
// client component.

import { getSupplierDomain, getSupplierLogoUrl } from './equipmentDirectory.js'
import { normalizeEmailAddress, resolveInboundMessagesTableName } from './inboundMessages.js'
import {
    baseSourcingSubject,
    isSourcingInProgress,
    normalizeSourcingStatus,
    sourcingStatusLabel,
    SOURCING_STATUS_QUOTE_RECEIVED,
} from './equipmentSourcingStatus.js'

const DEFAULT_RESULTS_TABLE = 'patient_equipment_suggestions'
const DEFAULT_INBOUND_LIMIT = 500
const MAX_INBOUND_LIMIT = 2000

// Inbound emails that land in the sourcing mailbox are categorised by the
// inbound worker/webhook; both of these can carry a supplier's answer.
export const SOURCING_RESPONSE_CATEGORIES = new Set(['quote_response', 'email_reply'])

function isSafeSqlIdentifier(value) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(value || ''))
}

export function resolveSourcingResultsTable() {
    const table = String(process.env.EQUIPMENT_SOURCER_RESULTS_TABLE || DEFAULT_RESULTS_TABLE).trim()
    if (!isSafeSqlIdentifier(table)) {
        throw new Error('EQUIPMENT_SOURCER_RESULTS_TABLE must be a safe SQL identifier (letters, numbers, underscore)')
    }
    return table
}

function parseJsonArray(value) {
    if (Array.isArray(value)) return value
    try {
        const parsed = JSON.parse(String(value || '[]'))
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}

function toMillis(value) {
    if (!value) return null
    const time = new Date(value).getTime()
    return Number.isFinite(time) ? time : null
}

function toIsoString(value) {
    const time = toMillis(value)
    return time === null ? null : new Date(time).toISOString()
}

function messageReceivedAtMs(message) {
    return toMillis(message?.received_at ?? message?.created_at ?? message?.createdAt ?? message?.receivedAt)
}

function messageReceivedAt(message) {
    return toIsoString(message?.received_at ?? message?.created_at ?? message?.createdAt ?? message?.receivedAt)
}

function messageFromEmail(message) {
    return normalizeEmailAddress(message?.from_email ?? message?.fromEmail)
}

function messageTextBody(message) {
    return String(message?.text_body ?? message?.textBody ?? message?.preview ?? '')
}

// Drop the quoted copy of our own request (and common signatures) so the
// preview shows only what the supplier actually wrote.
function stripQuotedReply(value) {
    const raw = String(value || '')
    const markers = [
        raw.search(/^\s*>/m),
        raw.search(/^\s*On .+wrote:\s*$/m),
        raw.search(/^\s*-{2,}\s*Original Message/im),
        raw.search(/^\s*_{5,}\s*$/m),
    ].filter((index) => index >= 0)

    const cutAt = markers.length > 0 ? Math.min(...markers) : raw.length
    return raw.slice(0, cutAt)
}

function toPreview(value, max = 240) {
    const normalized = stripQuotedReply(value).replace(/\s+/g, ' ').trim()
    if (!normalized) return ''
    return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`
}

/**
 * How strongly does one inbound message look like an answer to this item's
 * quote request? 0 = not a response.
 */
export function scoreSourcingResponse(item, message) {
    const quoteRequest = item?.quoteRequest
    if (!quoteRequest || typeof quoteRequest !== 'object') return 0

    const requestedAt = toMillis(quoteRequest.requestedAt)
    const receivedAt = messageReceivedAtMs(message)
    // A reply can never predate the request it answers.
    if (requestedAt !== null && receivedAt !== null && receivedAt < requestedAt) return 0

    const requestEmail = normalizeEmailAddress(quoteRequest.toEmail)
    const senderMatches = Boolean(requestEmail && messageFromEmail(message) === requestEmail)

    const requestSubject = baseSourcingSubject(quoteRequest.subject)
    const messageSubject = baseSourcingSubject(message?.subject)
    const subjectMatches = Boolean(requestSubject && requestSubject === messageSubject)

    if (senderMatches && subjectMatches) return 4
    if (subjectMatches) return 3
    if (!senderMatches) return 0

    // Same supplier, but their mail client rewrote the thread subject - fall
    // back to the requested item name appearing somewhere in the message.
    const itemName = String(item?.equipmentType || item?.name || '').trim().toLowerCase()
    if (itemName.length >= 4 && `${messageSubject} ${messageTextBody(message).toLowerCase()}`.includes(itemName)) {
        return 2
    }

    return 0
}

/**
 * Best matching supplier reply for an item, plus how many replies matched.
 */
export function findSourcingResponse(item, messages) {
    let best = null
    let matchCount = 0

    for (const message of messages || []) {
        const score = scoreSourcingResponse(item, message)
        if (score <= 0) continue
        matchCount += 1

        const receivedAtMs = messageReceivedAtMs(message) ?? 0
        if (!best || score > best.score || (score === best.score && receivedAtMs > best.receivedAtMs)) {
            best = { message, score, receivedAtMs }
        }
    }

    return best ? { ...best, matchCount } : null
}

export function buildSourcingItem({ domain, patientId, patientName, itemIndex, suggestion, inboundMessages }) {
    const quoteRequest = suggestion?.quoteRequest && typeof suggestion.quoteRequest === 'object'
        ? suggestion.quoteRequest
        : null
    const match = findSourcingResponse(suggestion, inboundMessages)
    const storedStatus = normalizeSourcingStatus(suggestion?.sourcingStatus)
    const status = match ? SOURCING_STATUS_QUOTE_RECEIVED : storedStatus
    const requestedAt = toIsoString(quoteRequest?.requestedAt)

    const response = match
        ? {
            id: match.message?.id ?? null,
            fromEmail: messageFromEmail(match.message) || null,
            subject: String(match.message?.subject || '').trim() || null,
            preview: toPreview(messageTextBody(match.message)) || null,
            category: String(match.message?.category || '').trim().toLowerCase() || null,
            receivedAt: messageReceivedAt(match.message),
            matchCount: match.matchCount,
        }
        : null

    // Captured from the supplier's website when the quote request was sent.
    const supplierDomain = getSupplierDomain(quoteRequest?.supplierDomain)

    return {
        key: `${domain}:${patientId}:${itemIndex}`,
        domain,
        patientId: Number(patientId),
        patientName: String(patientName || '').trim() || null,
        itemIndex,
        name: String(suggestion?.equipmentType || suggestion?.name || '').trim(),
        description: String(suggestion?.description || suggestion?.justification || '').trim(),
        status,
        statusLabel: sourcingStatusLabel(status),
        supplierId: quoteRequest?.supplierId ?? null,
        supplierName: quoteRequest?.supplierName || String(suggestion?.supplier || '').trim() || null,
        supplierEmail: quoteRequest?.toEmail || null,
        supplierDomain: supplierDomain || null,
        supplierLogoUrl: supplierDomain ? getSupplierLogoUrl(supplierDomain) : '',
        requestedAt,
        response,
        lastActivityAt: response?.receivedAt || requestedAt,
        href: `/admin/patients?patientId=${encodeURIComponent(String(patientId))}&tab=equipment`,
    }
}

async function readInboundMessages(connection, inboundTable, domain, inboundLimit) {
    const limit = Math.max(1, Math.min(Number(inboundLimit) || DEFAULT_INBOUND_LIMIT, MAX_INBOUND_LIMIT))

    try {
        const result = await connection.query(
            `SELECT id, from_email, subject, text_body, category, created_at
             FROM ${inboundTable}
             WHERE domain = $1 AND status <> 'failed'
             ORDER BY created_at DESC
             LIMIT $2`,
            [domain, limit]
        )
        return result.rows || []
    } catch (error) {
        const message = String(error?.message || '').toLowerCase()
        if (message.includes('does not exist')) return []
        throw error
    }
}

/**
 * Load every in-progress sourcing item for a domain, matched against the
 * domain's inbound email.
 *
 * With `persist: true` the stored `sourcingStatus` is moved to
 * `quote_received` (plus a `quoteResponse` snapshot) for items that have a
 * supplier reply, so the transition is durable for every other view.
 */
export async function resolveDomainSourcing(connection, domain, { persist = false, inboundLimit = DEFAULT_INBOUND_LIMIT, patientId = null } = {}) {
    const normalizedDomain = String(domain || '').trim().toLowerCase()
    if (!normalizedDomain) throw new Error('domain is required')

    const resultsTable = resolveSourcingResultsTable()
    const inboundTable = resolveInboundMessagesTableName()

    const params = [normalizedDomain]
    let whereClause = 'domain = $1'
    if (patientId !== null && patientId !== undefined && Number.isFinite(Number(patientId))) {
        params.push(Number(patientId))
        whereClause += ` AND patient_id = $${params.length}`
    }

    const rowsResult = await connection.query(
        `SELECT patient_id, patient_name, suggestions_json, updated_at FROM ${resultsTable} WHERE ${whereClause}`,
        params
    )
    const rows = rowsResult.rows || []
    if (rows.length === 0) return { items: [], changes: [] }

    const inboundMessages = await readInboundMessages(connection, inboundTable, normalizedDomain, inboundLimit)

    const items = []
    const changes = []

    for (const row of rows) {
        const suggestions = parseJsonArray(row.suggestions_json)
        let dirty = false

        suggestions.forEach((suggestion, itemIndex) => {
            const storedStatus = normalizeSourcingStatus(suggestion?.sourcingStatus)
            if (!isSourcingInProgress(storedStatus)) return

            const item = buildSourcingItem({
                domain: normalizedDomain,
                patientId: row.patient_id,
                patientName: row.patient_name,
                itemIndex,
                suggestion,
                inboundMessages,
            })
            items.push(item)

            if (item.status === SOURCING_STATUS_QUOTE_RECEIVED && storedStatus !== SOURCING_STATUS_QUOTE_RECEIVED) {
                suggestions[itemIndex] = {
                    ...suggestion,
                    sourcingStatus: SOURCING_STATUS_QUOTE_RECEIVED,
                    quoteResponse: {
                        inboundMessageId: item.response?.id ?? null,
                        fromEmail: item.response?.fromEmail ?? null,
                        subject: item.response?.subject ?? null,
                        receivedAt: item.response?.receivedAt ?? null,
                        matchedAt: new Date().toISOString(),
                    },
                }
                dirty = true
                changes.push({
                    patientId: Number(row.patient_id),
                    itemIndex,
                    name: item.name,
                    status: SOURCING_STATUS_QUOTE_RECEIVED,
                })
            }
        })

        if (dirty && persist) {
            await connection.query(
                `UPDATE ${resultsTable} SET suggestions_json = $1, updated_at = NOW() WHERE domain = $2 AND patient_id = $3`,
                [JSON.stringify(suggestions), normalizedDomain, row.patient_id]
            )
        }
    }

    items.sort((a, b) => {
        const aTime = toMillis(a.lastActivityAt) ?? 0
        const bTime = toMillis(b.lastActivityAt) ?? 0
        return bTime - aTime
    })

    return { items, changes }
}
