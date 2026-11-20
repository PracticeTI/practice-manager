/**
 * Catalogue for the admin header "Practice search" box.
 *
 * This module is deliberately free of Node-only imports so the same registry can
 * drive both the search route (`src/lib/practiceSearch.js`) and the header UI
 * (`src/admin-ui/components/PracticeSearchBox.jsx`).
 *
 * Adding a new searchable entity = add one entry here (plus a matching query in
 * `src/lib/practiceSearch.js`).
 */

/** Shortest query the header search will act on. */
export const PRACTICE_SEARCH_MIN_QUERY_LENGTH = 2

/** Maximum results returned per entity type. */
export const PRACTICE_SEARCH_MAX_RESULTS_PER_TYPE = 5

/**
 * Maximum results returned per entity type for the full results page
 * (`/admin/search`), which lists every match for a term rather than a
 * typeahead preview.
 */
export const PRACTICE_SEARCH_PAGE_MAX_RESULTS_PER_TYPE = 50

/**
 * Maximum results shown per entity type in the header results panel.
 *
 * The API may return more than this (`PRACTICE_SEARCH_MAX_RESULTS_PER_TYPE`);
 * the panel only surfaces the top few per category to stay compact.
 */
export const PRACTICE_SEARCH_MAX_VISIBLE_PER_TYPE = 3

/** Debounce applied to typing before the header search hits the API. */
export const PRACTICE_SEARCH_DEBOUNCE_MS = 250

/**
 * Admin page listing every match for a practice search term. It is the
 * destination of the header search box's "See all results" action.
 */
export const PRACTICE_SEARCH_RESULTS_PATH = '/admin/search'

/**
 * The entities the Practice search box looks up, in the order they are grouped
 * in the results panel.
 *
 * `featureFlagKey` names the domain settings field that must be on for the
 * entity to be searched at all.
 *
 * `buildHref(id, title)` is the admin destination for one result row. A directory that is
 * itself a searchable listing links to that listing filtered by the row's title, rather than
 * deep-linking straight to the record, so a result always lands on a results page.
 */
export const PRACTICE_SEARCH_ENTITY_TYPES = [
    {
        key: 'patients',
        label: 'Patients',
        featureFlagKey: 'patientsEnabled',
        buildHref: (id) => `/admin/patients?patientId=${encodeURIComponent(String(id))}`,
    },
    {
        key: 'providers',
        label: 'Providers',
        featureFlagKey: 'providersEnabled',
        // The provider directory is a searchable listing, so a result opens it filtered to that
        // provider's name — the same destination the admin dashboard's Providers card uses. This
        // replaces the old `?provider=<id>` link, which opened the record's editor instead.
        buildHref: (id, title) => {
            const name = String(title || '').trim()
            if (!name) return '/admin/providers'
            return `/admin/providers?q=${encodeURIComponent(name)}`
        },
    },
    {
        key: 'suppliers',
        label: 'Suppliers',
        featureFlagKey: 'suppliersEnabled',
        buildHref: (id) => `/admin/suppliers?supplier=${encodeURIComponent(String(id))}`,
    },
]

/** Entity type keys in display order. */
export const PRACTICE_SEARCH_ENTITY_KEYS = PRACTICE_SEARCH_ENTITY_TYPES.map((entityType) => entityType.key)

/**
 * Look up an entity type definition by key.
 *
 * @param {string} key
 * @returns {object|null}
 */
export function getPracticeSearchEntityType(key) {
    const normalized = String(key || '').trim().toLowerCase()
    if (!normalized) return null
    return PRACTICE_SEARCH_ENTITY_TYPES.find((entityType) => entityType.key === normalized) || null
}

/**
 * Human-readable label for an entity type key (falls back to the raw key).
 *
 * @param {string} key
 * @returns {string}
 */
export function getPracticeSearchEntityLabel(key) {
    return getPracticeSearchEntityType(key)?.label || String(key || '')
}

/**
 * Build the admin deep link for a search result. Returns an empty string when
 * the entity type is unknown so callers can skip the result.
 *
 * @param {string} key
 * @param {string|number} id
 * @param {string} [title] - The result's display title. Entity types whose destination is a
 *   filtered listing (rather than a record) use it to seed that listing's search.
 * @returns {string}
 */
export function buildPracticeSearchHref(key, id, title = '') {
    const entityType = getPracticeSearchEntityType(key)
    if (!entityType || id === null || id === undefined || id === '') return ''
    return entityType.buildHref(id, title)
}

/**
 * True when the query is long enough to search for.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isPracticeSearchQueryReady(value) {
    return String(value || '').trim().length >= PRACTICE_SEARCH_MIN_QUERY_LENGTH
}

/**
 * Clamp a caller-supplied per-type result limit to what the API serves.
 *
 * The header box relies on the default (a short typeahead preview); the full
 * results page asks for more and is capped at
 * `PRACTICE_SEARCH_PAGE_MAX_RESULTS_PER_TYPE`.
 *
 * @param {string|number|null|undefined} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function normalizePracticeSearchLimit(value, fallback = PRACTICE_SEARCH_MAX_RESULTS_PER_TYPE) {
    const parsed = Number.parseInt(String(value === undefined || value === null ? '' : value), 10)
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback
    return Math.min(parsed, PRACTICE_SEARCH_PAGE_MAX_RESULTS_PER_TYPE)
}

/**
 * Deep link to the full practice search results page for a term.
 *
 * @param {string} query
 * @returns {string}
 */
export function buildPracticeSearchResultsHref(query) {
    const term = String(query || '').trim()
    if (!term) return PRACTICE_SEARCH_RESULTS_PATH
    return `${PRACTICE_SEARCH_RESULTS_PATH}?q=${encodeURIComponent(term)}`
}
