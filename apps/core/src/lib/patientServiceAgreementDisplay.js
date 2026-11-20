// Shared presentation helpers for the patient "Service Agreements" feature.
// Pure and client-safe so the patient record panel and any other surface format
// plan-management types, statuses and signing state identically.

import { ENDED_SERVICE_AGREEMENT_STATUSES, toFinite } from './patientServiceAgreements.js'
import { daysUntilQuoteDate, formatCurrency, formatDisplayDate } from './patientQuoteDisplay.js'

export const SERVICE_AGREEMENT_STATUS_OPTIONS = [
    { value: 'draft', label: 'Draft' },
    { value: 'sent', label: 'Sent for signature' },
    { value: 'active', label: 'Active' },
    { value: 'terminated', label: 'Terminated' },
    { value: 'superseded', label: 'Superseded' },
    { value: 'expired', label: 'Expired' },
]

export const PLAN_MANAGEMENT_TYPE_OPTIONS = [
    { value: 'unknown', label: 'Not recorded' },
    { value: 'self_managed', label: 'Self-managed' },
    { value: 'plan_managed', label: 'Plan-managed' },
    { value: 'ndia_managed', label: 'NDIA-managed' },
]

export const AGREEMENT_STATUS_LABELS = {
    draft: 'Draft',
    sent: 'Sent',
    active: 'Active',
    terminated: 'Terminated',
    superseded: 'Superseded',
    expired: 'Expired',
}

export const AGREEMENT_STATUS_PILL_STYLES = {
    draft: 'border-gray-200 bg-gray-100 text-gray-600',
    sent: 'border-sky-200 bg-sky-50 text-sky-700',
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    terminated: 'border-red-200 bg-red-50 text-red-700',
    superseded: 'border-gray-200 bg-gray-100 text-gray-500',
    expired: 'border-amber-200 bg-amber-50 text-amber-800',
}

const ENDED_STATUS_SET = new Set(ENDED_SERVICE_AGREEMENT_STATUSES)

/** Review and expiry reminders look this far ahead. An NDIS plan runs for a year. */
export const AGREEMENT_ATTENTION_WINDOW_DAYS = 30

export function planManagementTypeLabel(value) {
    const key = String(value || '').trim().toLowerCase()
    return PLAN_MANAGEMENT_TYPE_OPTIONS.find((option) => option.value === key)?.label || 'Not recorded'
}

// Expiry is derived, never stored: an agreement past its end date that has not
// been terminated or superseded is reported as expired rather than mutating the
// row's status column (the same convention the Quotes feature uses).
export function deriveServiceAgreementStatus(row) {
    const status = String(row?.status || 'draft').trim().toLowerCase()
    if (row?.is_expired && !ENDED_STATUS_SET.has(status)) return 'expired'
    return AGREEMENT_STATUS_LABELS[status] ? status : 'draft'
}

export function isAwaitingSignature(row) {
    return deriveServiceAgreementStatus(row) === 'sent'
}

/**
 * Who has signed. The participant may sign personally or through a nominated
 * representative, so either signature satisfies the participant side.
 */
export function resolveSignatureState(row) {
    const participantSigned = Boolean(row?.participant_signed_at)
    const representativeSigned = Boolean(row?.representative_signed_at)
    const providerSigned = Boolean(row?.provider_signed_at)
    const participantSideSigned = participantSigned || representativeSigned

    return {
        participantSigned,
        representativeSigned,
        providerSigned,
        participantSideSigned,
        anySigned: participantSideSigned || providerSigned,
        fullySigned: participantSideSigned && providerSigned,
    }
}

/**
 * Metrics for one agreement, ranked by what needs attention. Kept in one place so
 * the panel's summary and any dashboard list agree.
 */
export function buildServiceAgreementMetrics(row, now = new Date()) {
    const status = deriveServiceAgreementStatus(row)
    const itemCount = Math.trunc(toFinite(row?.item_count))
    const subtotal = toFinite(row?.subtotal)
    const daysToEnd = daysUntilQuoteDate(row?.end_date, now)
    const daysToReview = daysUntilQuoteDate(row?.review_date, now)
    const signatures = resolveSignatureState(row)
    const open = !ENDED_STATUS_SET.has(status) && status !== 'expired'

    const awaitingSignature = status === 'sent' && !signatures.fullySigned
    const expiringSoon = open
        && status !== 'sent'
        && daysToEnd !== null
        && daysToEnd >= 0
        && daysToEnd <= AGREEMENT_ATTENTION_WINDOW_DAYS
    const reviewDue = open && daysToReview !== null && daysToReview <= 0

    let attention = null
    if (status === 'expired') {
        attention = { rank: 0, label: 'Agreement expired', tone: 'danger' }
    } else if (awaitingSignature) {
        attention = { rank: 1, label: 'Awaiting signature', tone: 'warning' }
    } else if (reviewDue) {
        attention = { rank: 2, label: 'Review due', tone: 'warning' }
    } else if (expiringSoon) {
        attention = {
            rank: 3,
            label: daysToEnd === 0 ? 'Ends today' : `Ends in ${daysToEnd}d`,
            tone: 'warning',
        }
    }

    return {
        status,
        itemCount,
        subtotal,
        daysToEnd,
        daysToReview,
        awaitingSignature,
        expiringSoon,
        reviewDue,
        signatures,
        attention,
    }
}

/** One-line agreement summary for compact surfaces. */
export function describeServiceAgreementSummary(row, metrics) {
    const parts = []
    if (row?.agreement_number) parts.push(String(row.agreement_number))

    if (metrics.itemCount > 0) {
        parts.push(`${metrics.itemCount} support${metrics.itemCount === 1 ? '' : 's'} · ${formatCurrency(metrics.subtotal)}`)
    } else {
        parts.push('No supports listed yet')
    }

    parts.push(planManagementTypeLabel(row?.plan_management_type))

    if (metrics.daysToEnd !== null && !metrics.attention) {
        parts.push(metrics.daysToEnd < 0
            ? `Ended ${Math.abs(metrics.daysToEnd)}d ago`
            : `Ends ${formatDisplayDate(row?.end_date)}`)
    }

    return parts.join(' • ')
}

/** Ranks agreements by what needs attention rather than recency. */
export function selectServiceAgreementAttentionItems(rows, { limit = 3, now = new Date() } = {}) {
    const ranked = (Array.isArray(rows) ? rows : [])
        .map((row) => ({ row, metrics: buildServiceAgreementMetrics(row, now) }))
        .filter((entry) => entry.metrics.attention !== null)
        .sort((a, b) => {
            if (a.metrics.attention.rank !== b.metrics.attention.rank) {
                return a.metrics.attention.rank - b.metrics.attention.rank
            }
            return (a.metrics.daysToEnd ?? 0) - (b.metrics.daysToEnd ?? 0)
        })

    return typeof limit === 'number' ? ranked.slice(0, limit) : ranked
}

/** Agreement-number preview shown when the create form is left blank. */
export function formatAgreementNumberPreview(nextSequence) {
    const sequence = Number.isFinite(Number(nextSequence)) ? Math.max(Number(nextSequence), 1) : 1
    return `SA-${String(sequence).padStart(4, '0')}`
}
