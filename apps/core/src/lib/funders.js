/**
 * Funders entity — the funding bodies this platform documents its work against
 * (NDIS, TAC, DVA, WorkCover, Aged Care/HCP, ...).
 *
 * A funder is a *reference* record: a named scheme plus the published
 * documentation the platform relies on (pricing arrangements, support
 * catalogues, practice standards, legislation, forms...). Keeping those links
 * in one place means a feature can look a document up by key instead of
 * hardcoding a URL, and the admin UI can show which source a figure came from.
 *
 * This module is deliberately free of Node-only imports so the admin UI, the API
 * routes, the dashboard card and the `node --test` suite can all share it. The
 * storage layer lives in `src/lib/fundersStore.js` and the built-in seed data in
 * `src/lib/funderRegistry.js`.
 */

/** Lifecycle state of a funder record. */
export const FUNDER_STATUSES = ['published', 'draft', 'archived']

/** Lifecycle state of a funder document. */
export const FUNDER_DOCUMENT_STATUSES = ['published', 'draft', 'archived']

export const DEFAULT_FUNDER_STATUS = 'published'
export const DEFAULT_FUNDER_DOCUMENT_STATUS = 'published'

/** How a document is delivered. `link` and `file` both carry a URL; `note` need not. */
export const FUNDER_DOCUMENT_TYPES = [
    { value: 'link', label: 'Web page' },
    { value: 'file', label: 'Download' },
    { value: 'note', label: 'Note' },
]

export const FUNDER_DOCUMENT_TYPE_VALUES = FUNDER_DOCUMENT_TYPES.map((type) => type.value)

/**
 * The documentation buckets the admin UI groups documents under. The values are
 * stable keys stored on the row; `label`/`description` are presentation only.
 */
export const FUNDER_DOCUMENT_CATEGORIES = [
    { value: 'pricing', label: 'Pricing & payments', description: 'Price limits, pricing schedules and payment rules.' },
    { value: 'catalogue', label: 'Support catalogue', description: 'The support items and their codes.' },
    { value: 'registration', label: 'Registration & audits', description: 'Registration groups, audits and provider obligations.' },
    { value: 'standards', label: 'Practice standards', description: 'Quality, safeguarding and practice expectations.' },
    { value: 'policy', label: 'Policy & legislation', description: 'Acts, rules and operational policy.' },
    { value: 'guidance', label: 'Guidance & resources', description: 'Provider guides, fact sheets and templates.' },
    { value: 'forms', label: 'Forms & reports', description: 'Report templates and forms the practice submits.' },
    { value: 'reference', label: 'Reference', description: 'Anything else the platform cites.' },
]

export const FUNDER_DOCUMENT_CATEGORY_VALUES = FUNDER_DOCUMENT_CATEGORIES.map((category) => category.value)

export const DEFAULT_FUNDER_DOCUMENT_CATEGORY = 'reference'

/** A funder key is a lowercase slug (e.g. `ndis`) that links stay stable across edits. */
export const FUNDER_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/

const MAX_NAME_LENGTH = 160
const MAX_FULL_NAME_LENGTH = 255
const MAX_KEY_LENGTH = 64
const MAX_DOCUMENT_KEY_LENGTH = 120
const MAX_DOCUMENT_TITLE_LENGTH = 255
const MAX_CATEGORY_LENGTH = 64
const MAX_EFFECTIVE_PERIOD_LENGTH = 32
const MAX_URL_LENGTH = 2048

/** Coerce anything into a trimmed string (never `undefined`/`null`). */
function toText(value) {
    if (value === null || value === undefined) return ''
    return String(value).trim()
}

function clampText(value, maxLength) {
    const text = toText(value)
    return text.length > maxLength ? text.slice(0, maxLength) : text
}

function toMetadata(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    return {}
}

function toBoolean(value) {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0
    const text = toText(value).toLowerCase()
    return text === 'true' || text === '1' || text === 'yes'
}

function toInteger(value, fallback = 0) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) ? parsed : fallback
}

function pickEnum(value, values, fallback) {
    const text = toText(value).toLowerCase()
    return values.includes(text) ? text : fallback
}

/**
 * Turn a funder name into a URL/key-safe slug. `National Disability Insurance
 * Scheme (NDIS)` → `national-disability-insurance-scheme-ndis`.
 */
export function slugifyFunderKey(value) {
    return toText(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, MAX_KEY_LENGTH)
}

/** Normalise a caller-supplied key: lowercase, dash-separated, length-capped. */
export function normalizeFunderKey(value) {
    return slugifyFunderKey(value)
}

/** True when the value is a usable funder key. */
export function isValidFunderKey(value) {
    return FUNDER_KEY_PATTERN.test(normalizeFunderKey(value))
}

/**
 * Only absolute http(s) URLs are accepted. The funder documents are external
 * government/agency sources, so protocol-relative or `javascript:` values would
 * be a defect rather than a convenience.
 */
export function isValidExternalUrl(value) {
    const text = toText(value)
    if (!text || text.length > MAX_URL_LENGTH) return false
    let parsed = null
    try {
        parsed = new URL(text)
    } catch {
        return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return Boolean(parsed.hostname)
}

/** True for a provider dashboard/contact URL we are happy to store. */
export function normalizeExternalUrl(value) {
    const text = toText(value)
    return isValidExternalUrl(text) ? text : ''
}

/**
 * Normalise a funder record from a request body or a database row into the shape
 * the store and UI use. `id`/timestamps are passed through when present so a row
 * round-trips unchanged.
 *
 * @param {object} value
 * @returns {object}
 */
export function normalizeFunder(value) {
    const source = value && typeof value === 'object' ? value : {}
    const name = clampText(source.name, MAX_NAME_LENGTH)
    const key = normalizeFunderKey(source.key || source.funder_key || name)

    return {
        id: source.id ?? null,
        key,
        name,
        full_name: clampText(source.full_name ?? source.fullName, MAX_FULL_NAME_LENGTH),
        description: toText(source.description),
        jurisdiction: clampText(source.jurisdiction, MAX_NAME_LENGTH),
        website_url: normalizeExternalUrl(source.website_url ?? source.websiteUrl),
        status: pickEnum(source.status, FUNDER_STATUSES, DEFAULT_FUNDER_STATUS),
        sort_order: toInteger(source.sort_order ?? source.sortOrder, 0),
        metadata: toMetadata(source.metadata),
        created_at: source.created_at ?? null,
        updated_at: source.updated_at ?? null,
    }
}

/**
 * Normalise a single funder document.
 *
 * @param {object} value
 * @returns {object}
 */
export function normalizeFunderDocument(value) {
    const source = value && typeof value === 'object' ? value : {}
    const title = clampText(source.title, MAX_DOCUMENT_TITLE_LENGTH)
    const url = toText(source.url)
    const docType = pickEnum(source.doc_type ?? source.docType, FUNDER_DOCUMENT_TYPE_VALUES, 'link')

    return {
        id: source.id ?? null,
        funder_id: source.funder_id ?? source.funderId ?? null,
        key: normalizeFunderKey(source.key || title).slice(0, MAX_DOCUMENT_KEY_LENGTH),
        title,
        url,
        category: pickEnum(source.category, FUNDER_DOCUMENT_CATEGORY_VALUES, DEFAULT_FUNDER_DOCUMENT_CATEGORY),
        doc_type: docType,
        description: toText(source.description),
        effective_period: clampText(source.effective_period ?? source.effectivePeriod, MAX_EFFECTIVE_PERIOD_LENGTH),
        is_primary: toBoolean(source.is_primary ?? source.isPrimary),
        position: toInteger(source.position, 0),
        status: pickEnum(source.status, FUNDER_DOCUMENT_STATUSES, DEFAULT_FUNDER_DOCUMENT_STATUS),
        // Link health is written only by the funder link check (see
        // `src/lib/funderLinkCheck.js`), so it is read-only from the UI's point of view.
        link_status: toText(source.link_status ?? source.linkStatus).toLowerCase(),
        http_status: source.http_status === null || source.http_status === undefined
            ? null
            : toInteger(source.http_status, null),
        link_checked_at: source.link_checked_at ?? source.linkCheckedAt ?? null,
        metadata: toMetadata(source.metadata),
        created_at: source.created_at ?? null,
        updated_at: source.updated_at ?? null,
    }
}

/** Display label for a document category key (falls back to the raw key). */
export function getFunderDocumentCategoryLabel(value) {
    const key = toText(value).toLowerCase()
    const match = FUNDER_DOCUMENT_CATEGORIES.find((category) => category.value === key)
    return match?.label || (key || 'Reference')
}

/** Display label for a document type key (falls back to the raw key). */
export function getFunderDocumentTypeLabel(value) {
    const key = toText(value).toLowerCase()
    const match = FUNDER_DOCUMENT_TYPES.find((type) => type.value === key)
    return match?.label || 'Web page'
}

/**
 * Sort documents for display: primary first, then by explicit position, then
 * newest financial period first, then title.
 */
export function sortFunderDocuments(documents) {
    const list = Array.isArray(documents) ? documents : []
    return [...list].sort((a, b) => {
        if (Boolean(a?.is_primary) !== Boolean(b?.is_primary)) {
            return a?.is_primary ? -1 : 1
        }
        const aPosition = toInteger(a?.position, 0)
        const bPosition = toInteger(b?.position, 0)
        if (aPosition !== bPosition) return aPosition - bPosition
        const aPeriod = toText(a?.effective_period)
        const bPeriod = toText(b?.effective_period)
        if (aPeriod !== bPeriod) return bPeriod.localeCompare(aPeriod)
        return toText(a?.title).localeCompare(toText(b?.title))
    })
}

/**
 * Group documents into the category order above. Categories with no documents
 * are omitted so the UI only renders populated sections.
 *
 * @param {Array} documents
 * @returns {Array<{ category: string, label: string, documents: Array }>}
 */
export function groupFunderDocumentsByCategory(documents) {
    const sorted = sortFunderDocuments(documents)
    const byCategory = new Map()

    for (const document of sorted) {
        const normalized = normalizeFunderDocument(document)
        const category = normalized.category
        if (!byCategory.has(category)) byCategory.set(category, [])
        byCategory.get(category).push(normalized)
    }

    const grouped = []
    for (const category of FUNDER_DOCUMENT_CATEGORIES) {
        const entries = byCategory.get(category.value)
        if (!entries || entries.length === 0) continue
        grouped.push({ category: category.value, label: category.label, documents: entries })
    }
    return grouped
}

/** One-line summary used as the secondary text on a document row. */
export function describeFunderDocument(document) {
    const normalized = normalizeFunderDocument(document)
    const parts = [getFunderDocumentTypeLabel(normalized.doc_type)]
    if (normalized.effective_period) parts.push(`Effective ${normalized.effective_period}`)
    if (normalized.description) parts.push(normalized.description)
    return parts.join(' · ')
}

/** Find one document on a funder by its key. */
export function findFunderDocument(funder, documentKey) {
    const key = normalizeFunderKey(documentKey)
    if (!key) return null
    const documents = Array.isArray(funder?.documents) ? funder.documents : []
    return documents.find((document) => normalizeFunderDocument(document).key === key) || null
}

/** Count documents on a funder (unpublished included unless `publishedOnly`). */
export function countFunderDocuments(funder, { publishedOnly = false } = {}) {
    const documents = Array.isArray(funder?.documents) ? funder.documents : []
    if (!publishedOnly) return documents.length
    return documents.filter((document) => normalizeFunderDocument(document).status === 'published').length
}

/**
 * Look a document URL up by funder key + document key across a list of funders.
 * Returns an empty string when either key is unknown, so callers can fall back
 * to their own constant instead of rendering an empty link.
 *
 * @param {Array} funders
 * @param {string} funderKey
 * @param {string} documentKey
 * @returns {string}
 */
export function getFunderDocumentUrl(funders, funderKey, documentKey) {
    const funderKeyNormalized = normalizeFunderKey(funderKey)
    const list = Array.isArray(funders) ? funders : []
    const funder = list.find((candidate) => normalizeFunder(candidate).key === funderKeyNormalized)
    if (!funder) return ''
    const document = findFunderDocument(funder, documentKey)
    return document?.url || ''
}

/**
 * Validate a funder payload for create/update. Returns an array of messages; an
 * empty array means the payload is acceptable.
 *
 * @param {object} value
 * @param {{ requireKey?: boolean }} [options]
 * @returns {string[]}
 */
export function validateFunder(value, { requireKey = false } = {}) {
    const funder = normalizeFunder(value)
    const errors = []

    if (!funder.name) errors.push('A funder name is required')
    if (requireKey && !funder.key) errors.push('A funder key is required')
    if (funder.key && !isValidFunderKey(funder.key)) {
        errors.push('A funder key must use lowercase letters, numbers and dashes')
    }
    if (toText(value?.website_url ?? value?.websiteUrl) && !funder.website_url) {
        errors.push('The website URL must be an absolute http(s) address')
    }
    return errors
}

/**
 * Validate a funder document payload. A `note` is the only document type that
 * may omit a URL.
 *
 * @param {object} value
 * @returns {string[]}
 */
export function validateFunderDocument(value) {
    const document = normalizeFunderDocument(value)
    const errors = []

    if (!document.title) errors.push('A document title is required')
    if (document.doc_type !== 'note') {
        if (!document.url) {
            errors.push('A document URL is required')
        } else if (!isValidExternalUrl(document.url)) {
            errors.push('The document URL must be an absolute http(s) address')
        }
    } else if (document.url && !isValidExternalUrl(document.url)) {
        errors.push('The document URL must be an absolute http(s) address')
    }
    return errors
}
