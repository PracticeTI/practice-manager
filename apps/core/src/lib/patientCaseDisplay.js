// Shared presentation helpers for the patient "Cases" feature (funding/allocation
// tracking). Pure and client-safe so the patient record panel, the /admin/cases
// page and the /admin dashboard card all format allocations, dates and attention
// states the same way.

import { toFinite } from './patientCases'

export const CASE_TYPE_OPTIONS = [
    { value: 'budget', label: 'Budget ($)', allocationUnit: '$', quantityLabel: 'Amount ($)', quantityStep: '0.01', quantityHint: 'Dollar value of this line item' },
    { value: 'hours', label: 'Hours', allocationUnit: 'hrs', quantityLabel: 'Hours', quantityStep: '0.25', quantityHint: 'Hours delivered' },
    { value: 'sessions', label: 'Sessions', allocationUnit: 'sessions', quantityLabel: 'Sessions', quantityStep: '1', quantityHint: 'Number of sessions' },
]

export function getTypeConfig(caseType) {
    return CASE_TYPE_OPTIONS.find((option) => option.value === caseType) || CASE_TYPE_OPTIONS[0]
}

export function formatAllocation(caseType, value) {
    const number = Number(value || 0)
    const config = getTypeConfig(caseType)
    if (config.value === 'budget') {
        return `$${number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    if (config.value === 'sessions') {
        return `${number} ${number === 1 ? 'session' : 'sessions'}`
    }
    return `${number} hrs`
}

export function formatDisplayDate(value) {
    if (!value) return '-'
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value))
    if (!match) return String(value)
    const [, year, month, day] = match
    const date = new Date(Number(year), Number(month) - 1, Number(day))
    return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Expiry is derived, never stored: an open case whose expiry date has passed is
// reported as "expired" rather than mutating the row's status column.
export function deriveCaseStatus(row) {
    if (row?.is_expired && row?.status !== 'closed') return 'expired'
    return row?.status || 'open'
}

export const STATUS_PILL_STYLES = {
    open: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    closed: 'border-gray-200 bg-gray-100 text-gray-600',
    expired: 'border-red-200 bg-red-50 text-red-700',
}

export const STATUS_LABELS = {
    open: 'Open',
    closed: 'Closed',
    expired: 'Expired',
}

// Open cases expiring within this window are surfaced on the dashboard card.
export const CASE_ATTENTION_WINDOW_DAYS = 30

// Utilisation at or above this percentage is treated as running out.
export const CASE_ATTENTION_UTILISATION_PERCENT = 90

export function parseCaseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim())
    if (!match) return null

    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    return Number.isFinite(date.getTime()) ? date : null
}

// Whole days from `now` to a YYYY-MM-DD date; negative when the date has passed.
export function daysUntilCaseDate(value, now = new Date()) {
    const date = parseCaseDate(value)
    if (!date) return null

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return Math.round((date.getTime() - startOfToday.getTime()) / 86400000)
}

export function buildCaseMetrics(row, now = new Date()) {
    const total = toFinite(row?.total_allocation)
    const used = toFinite(row?.used_quantity)
    const remaining = Math.max(total - used, 0)
    const over = total > 0 && used > total
    const utilisation = total > 0 ? (used / total) * 100 : 0
    const status = deriveCaseStatus(row)
    const isOpen = status === 'open'
    const daysToExpiry = daysUntilCaseDate(row?.expiry_date, now)
    const expiringSoon = isOpen
        && daysToExpiry !== null
        && daysToExpiry >= 0
        && daysToExpiry <= CASE_ATTENTION_WINDOW_DAYS
    const nearlyExhausted = isOpen && total > 0 && utilisation >= CASE_ATTENTION_UTILISATION_PERCENT

    let attention = null
    if (status === 'expired') {
        attention = { rank: 0, label: 'Expired', tone: 'danger' }
    } else if (expiringSoon) {
        attention = {
            rank: 1,
            label: daysToExpiry === 0 ? 'Expires today' : `Expires in ${daysToExpiry}d`,
            tone: 'warning',
        }
    } else if (nearlyExhausted) {
        attention = { rank: 2, label: `${Math.round(utilisation)}% used`, tone: 'warning' }
    }

    return {
        total,
        used,
        remaining,
        over,
        utilisation,
        status,
        daysToExpiry,
        expiringSoon,
        nearlyExhausted,
        attention,
    }
}

// One-line case summary for compact surfaces such as the dashboard card.
export function describeCaseSummary(row, metrics) {
    const parts = []
    if (row?.case_number) parts.push(String(row.case_number))

    if (metrics.total > 0) {
        parts.push(`${formatAllocation(row.case_type, metrics.remaining)} of ${formatAllocation(row.case_type, metrics.total)} remaining`)
    } else {
        parts.push('No allocation set')
    }

    // The attention badge already states the expiry, so only repeat it when the
    // badge is showing something else (e.g. "94% used").
    const attentionStatesExpiry = metrics.attention?.rank === 0 || metrics.attention?.rank === 1
    if (!attentionStatesExpiry) {
        if (metrics.status === 'expired' && metrics.daysToExpiry !== null) {
            parts.push(`Expired ${Math.abs(metrics.daysToExpiry)}d ago`)
        } else if (metrics.expiringSoon && metrics.daysToExpiry !== null) {
            parts.push(metrics.daysToExpiry === 0 ? 'Expires today' : `Expires in ${metrics.daysToExpiry}d`)
        }
    }

    return parts.join(' • ')
}

// Ranks cases by funding risk rather than recency: expired first, then expiring
// soon, then nearly exhausted.
export function selectCaseAttentionItems(rows, { limit = 3, now = new Date() } = {}) {
    const ranked = (Array.isArray(rows) ? rows : [])
        .map((row) => ({ row, metrics: buildCaseMetrics(row, now) }))
        .filter((entry) => entry.metrics.attention !== null)
        .sort((a, b) => {
            if (a.metrics.attention.rank !== b.metrics.attention.rank) {
                return a.metrics.attention.rank - b.metrics.attention.rank
            }
            if (a.metrics.attention.rank === 1) {
                return (a.metrics.daysToExpiry ?? 0) - (b.metrics.daysToExpiry ?? 0)
            }
            if (a.metrics.attention.rank === 2) {
                return b.metrics.utilisation - a.metrics.utilisation
            }
            // Both expired: the most overdue case is the most urgent.
            return (a.metrics.daysToExpiry ?? 0) - (b.metrics.daysToExpiry ?? 0)
        })

    return typeof limit === 'number' ? ranked.slice(0, limit) : ranked
}
