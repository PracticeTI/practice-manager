/**
 * Canonical list of the patient document types the Docs page (/admin/docs) indexes.
 *
 * The page renders an All tab that stacks one module per type, plus a sub-tab per type,
 * and the Docs dashboard card shows the newest document of each type, so the key, label,
 * blurb and list endpoint live here once instead of being copied into all three.
 */
export const PATIENT_DOCUMENT_TYPES = [
    {
        key: 'quotes',
        label: 'Quotes',
        // Singular noun for one record; the dashboard card labels a preview row with it.
        singular: 'Quote',
        blurb: 'A priced proposal for specific supports, issued before delivery.',
        // List endpoint, newest first. The Docs page loads the full window; the dashboard
        // card reads a smaller one so it can still find each type's newest row.
        endpoint: (domain, limit = 200) => `/api/database/quotes?domain=${encodeURIComponent(domain)}&limit=${limit}`,
        // Field that dates a record, so callers can order rows without knowing the table.
        timestamp: (row) => row?.updated_at || row?.created_at,
        // Human identifier for one record, when the type numbers its documents.
        identifier: (row) => row?.quote_number || '',
    },
    {
        key: 'cases',
        label: 'Cases',
        singular: 'Case',
        blurb: 'Funding allocation tracking, with usage and expiry at a glance.',
        endpoint: (domain, limit = 300) => `/api/database/cases?domain=${encodeURIComponent(domain)}&limit=${limit}`,
        timestamp: (row) => row?.updated_at || row?.created_at,
        identifier: (row) => row?.case_number || '',
    },
    {
        key: 'agreements',
        label: 'Service Agreements',
        singular: 'Service agreement',
        blurb: 'The signed contract that governs ongoing delivery.',
        endpoint: (domain, limit = 200) => `/api/database/service-agreements?domain=${encodeURIComponent(domain)}&limit=${limit}`,
        timestamp: (row) => row?.updated_at || row?.created_at,
        identifier: (row) => row?.agreement_number || '',
    },
    {
        key: 'forms',
        label: 'Forms',
        singular: 'Form',
        blurb: 'Intake and consent submissions imported from the practice management system.',
        endpoint: (domain, limit = 200) => `/api/database/forms?domain=${encodeURIComponent(domain)}&limit=${limit}`,
        // A submission is dated by when the patient sent it, not when it was imported.
        timestamp: (row) => row?.submitted_at || row?.updated_at || row?.created_at,
        identifier: (row) => row?.external_id || '',
    },
    {
        key: 'analyses',
        label: 'Analyses',
        singular: 'Analysis',
        blurb: 'The FCA Analyst evidence set a report is built from.',
        endpoint: (domain, limit = 100) => `/api/database/patients/analysis?domain=${encodeURIComponent(domain)}&limit=${limit}`,
        // The analysis and summary APIs normalise their timestamps to camelCase.
        timestamp: (row) => row?.updatedAt || row?.createdAt,
        identifier: () => '',
    },
    {
        key: 'summaries',
        label: 'Summaries',
        singular: 'Summary',
        blurb: 'One summary per transcript per style, written by the Transcript Summariser.',
        endpoint: (domain, limit = 100) => `/api/database/patients/scribe-summary?domain=${encodeURIComponent(domain)}&limit=${limit}`,
        timestamp: (row) => row?.updatedAt || row?.createdAt,
        identifier: () => '',
    },
]

/** Type key -> entry, for the Docs page deep link that already knows which type it wants. */
export const PATIENT_DOCUMENT_TYPE_BY_KEY = Object.fromEntries(
    PATIENT_DOCUMENT_TYPES.map((type) => [type.key, type])
)

/** Milliseconds for a document's timestamp, or 0 when it carries none. */
function documentTime(type, row) {
    const time = new Date(type.timestamp(row) || 0).getTime()
    return Number.isFinite(time) ? time : 0
}

/**
 * The newest document of each type, ordered newest first and capped at `limit`.
 *
 * The Docs dashboard card uses this so one busy type — quotes, typically — cannot
 * fill the whole card with a single kind of document.
 *
 * @param {Record<string, Array<object>>} rowsByType rows keyed by type key
 * @param {number} limit most rows to return
 * @returns {Array<{ type: object, row: object }>}
 */
export function selectRecentDocuments(rowsByType, limit = 3) {
    const newestPerType = PATIENT_DOCUMENT_TYPES.reduce((entries, type) => {
        const rows = Array.isArray(rowsByType?.[type.key]) ? rowsByType[type.key] : []
        if (rows.length === 0) return entries

        const newest = rows.reduce((best, row) => (
            documentTime(type, row) > documentTime(type, best) ? row : best
        ))
        entries.push({ type, row: newest })
        return entries
    }, [])

    return newestPerType
        .sort((a, b) => documentTime(b.type, b.row) - documentTime(a.type, a.row))
        .slice(0, Math.max(0, limit))
}

/**
 * Href for one document type on the Docs page, e.g. the rows of the Docs dashboard card.
 */
export function buildPatientDocumentsHref(typeKey) {
    const key = String(typeKey || '').trim()
    if (!PATIENT_DOCUMENT_TYPE_BY_KEY[key]) return '/admin/docs'
    return `/admin/docs?type=${encodeURIComponent(key)}`
}
