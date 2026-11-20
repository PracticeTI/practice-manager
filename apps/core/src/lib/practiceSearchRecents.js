/**
 * Recent-term memory for the admin header "Practice search" box.
 *
 * The header box is a typeahead rather than a form — nothing is ever submitted —
 * so a term is only remembered once the admin has actually *used* it: opened a
 * result, opened the full results page, or handed the term to the assistant.
 * Remembering every pause in someone's typing would fill the short list with
 * prefixes of one search.
 *
 * Dependency-free (and storage-agnostic) on purpose: the list is read and written
 * by a client component, `src/admin-ui/components/PracticeSearchBox.jsx`, and the
 * pure helpers here can be exercised without a browser.
 */

/** How many recent terms the header box offers. */
export const PRACTICE_SEARCH_RECENTS_LIMIT = 3

/**
 * Storage key prefix. The active admin domain is appended at runtime, because
 * which entities the box searches is decided per domain — a superadmin moving
 * between domains should not inherit another domain's terms.
 */
export const PRACTICE_SEARCH_RECENTS_STORAGE_PREFIX = 'practice_search_recents_v1'

/**
 * Storage key for one domain's term list.
 *
 * @param {string} [domainKey]
 * @returns {string}
 */
export function practiceSearchRecentsStorageKey(domainKey = '') {
    const scope = String(domainKey || '').trim().toLowerCase() || 'default'
    return `${PRACTICE_SEARCH_RECENTS_STORAGE_PREFIX}:${scope}`
}

/** Collapse whitespace so a term typed with stray spaces still dedupes. */
function normalizeTerm(value) {
    return String(value || '').replace(/\s+/g, ' ').trim()
}

/**
 * Clean a stored list: trim, drop blanks, dedupe case-insensitively (keeping the
 * first spelling seen, which is the most recent one), and cap the length.
 *
 * @param {unknown} value
 * @param {number} [limit]
 * @returns {string[]}
 */
export function normalizeRecentSearches(value, limit = PRACTICE_SEARCH_RECENTS_LIMIT) {
    if (!Array.isArray(value)) return []

    const max = Math.max(0, Number(limit) || 0)
    if (max === 0) return []

    const terms = []
    for (const entry of value) {
        const term = normalizeTerm(entry)
        if (!term) continue
        if (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) continue
        terms.push(term)
        if (terms.length >= max) break
    }
    return terms
}

/**
 * Put `term` at the front of the list, dropping any earlier spelling of it, so
 * the most recently used term is always the first offer.
 *
 * @param {unknown} value
 * @param {string} term
 * @param {number} [limit]
 * @returns {string[]}
 */
export function addRecentSearch(value, term, limit = PRACTICE_SEARCH_RECENTS_LIMIT) {
    const terms = normalizeRecentSearches(value, limit)
    const next = normalizeTerm(term)
    if (!next) return terms

    return normalizeRecentSearches(
        [next, ...terms.filter((entry) => entry.toLowerCase() !== next.toLowerCase())],
        limit
    )
}

/**
 * Read a domain's recent terms.
 *
 * Tolerant by design: storage can be absent (server render), blocked (privacy
 * mode) or hold a value written by another build, and none of that may break the
 * header box.
 *
 * @param {Storage|null|undefined} storage
 * @param {string} [domainKey]
 * @param {number} [limit]
 * @returns {string[]}
 */
export function readRecentSearches(storage, domainKey = '', limit = PRACTICE_SEARCH_RECENTS_LIMIT) {
    if (!storage) return []

    try {
        return normalizeRecentSearches(
            JSON.parse(storage.getItem(practiceSearchRecentsStorageKey(domainKey)) || '[]'),
            limit
        )
    } catch {
        return []
    }
}

/**
 * Persist a domain's recent terms and return the cleaned list that was stored, so
 * the caller's state cannot drift from storage. An empty list removes the key
 * rather than storing `[]`, so clearing leaves nothing behind.
 *
 * @param {Storage|null|undefined} storage
 * @param {string} [domainKey]
 * @param {unknown} value
 * @param {number} [limit]
 * @returns {string[]}
 */
export function writeRecentSearches(storage, domainKey = '', value, limit = PRACTICE_SEARCH_RECENTS_LIMIT) {
    const terms = normalizeRecentSearches(value, limit)
    if (!storage) return terms

    try {
        const key = practiceSearchRecentsStorageKey(domainKey)
        if (terms.length === 0) storage.removeItem(key)
        else storage.setItem(key, JSON.stringify(terms))
    } catch {
        // A full or blocked store costs the remembered list, never the search.
    }

    return terms
}
