// Shared presentation helpers for the patient "Quotes" feature. Pure and
// client-safe so the patient record panel and any other surface format money,
// statuses and price-limit warnings identically.

import { getNdisSupportUnit } from './ndisSupportCatalogue.js'
import { SETTLED_QUOTE_STATUSES, buildQuoteLineMetrics, toFinite } from './patientQuotes.js'

export const QUOTE_STATUS_OPTIONS = [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent to participant' },
    { value: 'accepted', label: 'Accepted' },
    { value: 'declined', label: 'Declined' },
    { value: 'expired', label: 'Expired' },
]

export const FUNDING_TYPE_OPTIONS = [
    { value: 'ndis', label: 'NDIS' },
    { value: 'private', label: 'Private' },
    { value: 'other', label: 'Other funding' },
]

export const STATUS_LABELS = {
    draft: 'Draft',
    sent: 'Sent',
    accepted: 'Accepted',
    declined: 'Declined',
    expired: 'Expired',
}

export const STATUS_PILL_STYLES = {
    draft: 'border-gray-200 bg-gray-100 text-gray-600',
    sent: 'border-sky-200 bg-sky-50 text-sky-700',
    accepted: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    declined: 'border-red-200 bg-red-50 text-red-700',
    expired: 'border-amber-200 bg-amber-50 text-amber-800',
}

const SETTLED_STATUS_SET = new Set(SETTLED_QUOTE_STATUSES)

export function formatCurrency(value) {
    const number = toFinite(value)
    return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** "6 Hours", "1 Each" — quantity plus the catalogue's unit code. */
export function formatQuantity(quantity, unit) {
    const number = toFinite(quantity)
    const meta = getNdisSupportUnit(unit)
    const label = number === 1 ? meta.label : meta.plural
    const formatted = Number.isInteger(number) ? String(number) : number.toFixed(2)
    return `${formatted} ${label}`
}

/** "6 Hours @ $193.99 = $1,163.94" */
export function describeQuoteLine(item) {
    const metrics = buildQuoteLineMetrics(item)
    const unitPrice = formatCurrency(metrics.unitPrice)
    return `${formatQuantity(metrics.quantity, item?.unit)} @ ${unitPrice} = ${formatCurrency(metrics.lineTotal)}`
}

// Validity is derived, never stored: a draft/sent quote past its validity date is
// reported as expired rather than mutating the row's status column.
export function deriveQuoteStatus(row) {
    const status = String(row?.status || 'draft').trim().toLowerCase()
    if (row?.is_expired && !SETTLED_STATUS_SET.has(status)) return 'expired'
    return STATUS_LABELS[status] ? status : 'draft'
}

export function parseQuoteDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
    if (!match) return null

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return Number.isFinite(date.getTime()) ? date : null
}

export function formatDisplayDate(value) {
    if (!value) return '-'
    const date = parseQuoteDate(value)
    return date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : String(value)
}

/** Whole days from `now` to a YYYY-MM-DD date; negative when the date has passed. */
export function daysUntilQuoteDate(value, now = new Date()) {
    const date = parseQuoteDate(value)
    if (!date) return null

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return Math.round((date.getTime() - startOfToday.getTime()) / 86400000)
}

/** Open quotes within this window of their validity date are surfaced as pending. */
export const QUOTE_ATTENTION_WINDOW_DAYS = 14

export function buildQuoteMetrics(row, now = new Date()) {
    const status = deriveQuoteStatus(row)
    const subtotal = toFinite(row?.subtotal)
    const total = toFinite(row?.total)
    const itemCount = Math.trunc(toFinite(row?.item_count))
    const overLimitCount = Math.trunc(toFinite(row?.over_limit_count))
    const daysToValidity = daysUntilQuoteDate(row?.valid_until, now)
    const awaitingDecision = status === 'draft' || status === 'sent'
    const expiringSoon = awaitingDecision
        && daysToValidity !== null
        && daysToValidity >= 0
        && daysToValidity <= QUOTE_ATTENTION_WINDOW_DAYS

    let attention = null
    if (overLimitCount > 0) {
        // Charging above an NDIS price limit is not allowed for NDIA-managed or
        // plan-managed participants, so this outranks everything else.
        attention = {
            rank: 0,
            label: overLimitCount === 1 ? 'Above price limit' : `${overLimitCount} above limit`,
            tone: 'danger',
        }
    } else if (status === 'expired') {
        attention = { rank: 1, label: 'Validity expired', tone: 'warning' }
    } else if (expiringSoon) {
        attention = {
            rank: 2,
            label: daysToValidity === 0 ? 'Expires today' : `Expires in ${daysToValidity}d`,
            tone: 'warning',
        }
    }

    return {
        status,
        subtotal,
        total,
        itemCount,
        overLimitCount,
        daysToValidity,
        expiringSoon,
        awaitingDecision,
        attention,
    }
}

/** One-line quote summary for compact surfaces. */
export function describeQuoteSummary(row, metrics) {
    const parts = []
    if (row?.quote_number) parts.push(String(row.quote_number))
    if (metrics.itemCount > 0) {
        parts.push(`${metrics.itemCount} line${metrics.itemCount === 1 ? '' : 's'} · ${formatCurrency(metrics.total)}`)
    } else {
        parts.push('No line items yet')
    }

    const attentionStatesValidity = metrics.attention?.rank === 0
    if (!attentionStatesValidity && metrics.daysToValidity !== null) {
        if (metrics.status === 'expired') {
            parts.push(`Expired ${Math.abs(metrics.daysToValidity)}d ago`)
        } else if (metrics.expiringSoon) {
            parts.push(metrics.daysToValidity === 0 ? 'Expires today' : `Expires in ${metrics.daysToValidity}d`)
        }
    }

    return parts.join(' • ')
}

// Ranks quotes by what needs attention rather than recency: price-limit breaches
// first, then expired validity, then quotes about to lapse.
export function selectQuoteAttentionItems(rows, { limit = 3, now = new Date() } = {}) {
    const ranked = (Array.isArray(rows) ? rows : [])
        .map((row) => ({ row, metrics: buildQuoteMetrics(row, now) }))
        .filter((entry) => entry.metrics.attention !== null)
        .sort((a, b) => {
            if (a.metrics.attention.rank !== b.metrics.attention.rank) {
                return a.metrics.attention.rank - b.metrics.attention.rank
            }
            if (a.metrics.attention.rank === 0) {
                return b.metrics.overLimitCount - a.metrics.overLimitCount
            }
            return (a.metrics.daysToValidity ?? 0) - (b.metrics.daysToValidity ?? 0)
        })

    return typeof limit === 'number' ? ranked.slice(0, limit) : ranked
}

/** Quote-number preview shown when the create form is left blank. */
export function formatQuoteNumberPreview(nextSequence) {
    const sequence = Number.isFinite(Number(nextSequence)) ? Math.max(Number(nextSequence), 1) : 1
    return `QTE-${String(sequence).padStart(4, '0')}`
}
