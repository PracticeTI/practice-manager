// Pure equipment-sourcing status helpers, shared by the admin UI (client) and
// the sourcing API routes (server).
//
// Keep this module free of database imports: client components import the
// labels/badge classes from here, and pulling in `@/lib/database` would drag
// the Postgres drivers into the browser bundle.

export const SOURCING_STATUS_UNSOURCED = 'unsourced'
export const SOURCING_STATUS_QUOTE_REQUESTED = 'quote_requested'
// A supplier answered the quote request (inbound email matched to the request).
export const SOURCING_STATUS_QUOTE_RECEIVED = 'quote_received'

export const SOURCING_STATUS_LABELS = {
    [SOURCING_STATUS_UNSOURCED]: 'Unsourced',
    [SOURCING_STATUS_QUOTE_REQUESTED]: 'Quote requested',
    [SOURCING_STATUS_QUOTE_RECEIVED]: 'Quote received',
}

export const SOURCING_STATUS_BADGE_CLASSES = {
    [SOURCING_STATUS_UNSOURCED]: 'border-gray-200 bg-gray-50 text-gray-600',
    [SOURCING_STATUS_QUOTE_REQUESTED]: 'border-blue-200 bg-blue-50 text-blue-700',
    [SOURCING_STATUS_QUOTE_RECEIVED]: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

// A supplier has been contacted, so the item is actively being sourced.
export const SOURCING_IN_PROGRESS_STATUSES = [
    SOURCING_STATUS_QUOTE_REQUESTED,
    SOURCING_STATUS_QUOTE_RECEIVED,
]

export function normalizeSourcingStatus(value) {
    const normalized = String(value || '').trim().toLowerCase()
    return normalized || SOURCING_STATUS_UNSOURCED
}

export function isSourcingInProgress(value) {
    return SOURCING_IN_PROGRESS_STATUSES.includes(normalizeSourcingStatus(value))
}

export function sourcingStatusLabel(value) {
    const normalized = normalizeSourcingStatus(value)
    return SOURCING_STATUS_LABELS[normalized] || SOURCING_STATUS_LABELS[SOURCING_STATUS_UNSOURCED]
}

export function sourcingStatusBadgeClass(value) {
    const normalized = normalizeSourcingStatus(value)
    return SOURCING_STATUS_BADGE_CLASSES[normalized] || SOURCING_STATUS_BADGE_CLASSES[SOURCING_STATUS_UNSOURCED]
}

// Replies arrive as "Re: ..." / "Fwd: ..." chains, so compare the base subject.
export function baseSourcingSubject(value) {
    let subject = String(value || '').trim().toLowerCase()
    while (/^(re|fwd|fw|aw|sv)\s*(\[\d+\])?\s*:/.test(subject)) {
        subject = subject.replace(/^(re|fwd|fw|aw|sv)\s*(\[\d+\])?\s*:/, '').trim()
    }
    return subject.replace(/\s+/g, ' ')
}
