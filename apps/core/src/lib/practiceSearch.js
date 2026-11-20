/**
 * Practice-wide search behind the admin header "Practice search" box.
 *
 * Scope today: Patients, Providers and Suppliers (see
 * `src/lib/practiceSearchCatalog.js`). Each entity is queried in its own
 * try/catch so a missing table (for a practice that has not turned an entity on
 * yet) degrades to "no results for that type" instead of failing the whole
 * search.
 *
 * Domain scoping mirrors the existing admin directories:
 *   - Patients are owned by a domain (`patients.domain`), so they are filtered by
 *     the active practice domain.
 *   - Providers/Suppliers are shared published directories, so only the
 *     `admin_added` records are domain-scoped — exactly like `listProviders` and
 *     `listEquipmentSuppliers`.
 *   - Records this admin soft-deleted from their own view are excluded.
 */

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { getEquipmentAdminKey } from '@/lib/equipmentStore'
import { getProviderAdminKey } from '@/lib/providersStore'
import {
    PRACTICE_SEARCH_ENTITY_KEYS,
    PRACTICE_SEARCH_MAX_RESULTS_PER_TYPE,
    buildPracticeSearchHref,
    normalizePracticeSearchLimit,
} from '@/lib/practiceSearchCatalog'

function normalizeText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

/** Directory descriptions can be paragraphs long; typeahead rows show one line. */
const MAX_SUBTITLE_LENGTH = 120

function truncateText(value, maxLength = MAX_SUBTITLE_LENGTH) {
    const text = normalizeText(value)
    if (text.length <= maxLength) return text
    return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

/** Escape LIKE wildcards so a literal `%` or `_` typed by an admin is matched as text. */
function escapeLikePattern(value) {
    return normalizeText(value).replace(/([\\%_])/g, '\\$1')
}

/**
 * Postgres regex matching the term at the start of a word.
 *
 * Typeahead should match from a word boundary ("physio" → "Physiotherapy")
 * rather than anywhere inside a word — otherwise short terms match unrelated
 * copy ("ling" inside "counselLING"/"handLING") and fill the panel with
 * records that do not actually match, burying the Assistant action.
 *
 * Backslash-escapes the term's regex metacharacters so typed punctuation is matched literally.
 */
function buildWordStartPattern(value) {
    const escaped = normalizeText(value).replace(/[\\.^$*+?()[\]{}|]/g, '\\$&')
    return escaped ? `\\m${escaped}` : ''
}

/** The admin key used by the directory favourites/soft-delete tables. */
export function resolvePracticeSearchAdminKey(adminUser) {
    return getProviderAdminKey(adminUser) || getEquipmentAdminKey(adminUser)
}

function buildPatientSubtitle(row) {
    const metadata = parseMetadataValue(row?.metadata) || {}
    const ndisNumber = normalizeText(metadata.ndis_number)
    if (ndisNumber) return `NDIS ${ndisNumber}`
    const dateOfBirth = normalizeText(metadata.date_of_birth)
    if (dateOfBirth) return `Date of birth ${dateOfBirth}`
    const externalId = normalizeText(row?.external_id)
    if (externalId) return `ID ${externalId}`
    return ''
}

function buildDirectorySubtitle(row) {
    const description = normalizeText(row?.description)
    if (description) return truncateText(description)
    return normalizeText(row?.ndis_status)
}

function toResult(entityTypeKey, row, title, subtitle) {
    const href = buildPracticeSearchHref(entityTypeKey, row?.id, title)
    if (!href || !title) return null

    return {
        type: entityTypeKey,
        id: row?.id ?? null,
        title,
        subtitle,
        href,
    }
}

/**
 * Per-entity type row builders. Each returns already-normalised search results;
 * the caller wraps them with error isolation.
 */
const ENTITY_SEARCHERS = {
    async patients(connection, { wordPattern, likePattern, domainKey, limit }) {
        const result = await connection.query(
            `SELECT id, patient_name, external_id, metadata
             FROM patients
             WHERE domain = $1
               AND (patient_name ~* $2 OR COALESCE(external_id, '') ILIKE $3)
             ORDER BY patient_name ASC
             LIMIT $4`,
            [domainKey, wordPattern, likePattern, limit]
        )

        return (result.rows || []).map((row) => toResult(
            'patients',
            row,
            normalizeText(row.patient_name),
            buildPatientSubtitle(row)
        ))
    },

    async providers(connection, { wordPattern, domainKey, adminKey, limit }) {
        const condition = adminKey
            ? `AND NOT EXISTS (
                   SELECT 1 FROM allied_health_provider_admin_deletions deleted_for_admin
                   WHERE deleted_for_admin.provider_id = providers.id
                     AND deleted_for_admin.admin_key = $4
               )`
            : ''
        const params = [domainKey, wordPattern, limit]
        if (adminKey) params.push(adminKey)

        const result = await connection.query(
            `SELECT providers.id, providers.provider, providers.description, providers.ndis_status
             FROM allied_health_providers providers
             WHERE providers.status <> 'hidden'
               AND (providers.status <> 'admin_added' OR providers.domain = $1)
               AND (providers.provider ~* $2 OR COALESCE(providers.description, '') ~* $2)
               ${condition}
             ORDER BY providers.provider ASC
             LIMIT $3`,
            params
        )

        return (result.rows || []).map((row) => toResult(
            'providers',
            row,
            normalizeText(row.provider),
            buildDirectorySubtitle(row)
        ))
    },

    async suppliers(connection, { wordPattern, domainKey, adminKey, limit }) {
        const condition = adminKey
            ? `AND NOT EXISTS (
                   SELECT 1 FROM equipment_supplier_admin_deletions deleted_for_admin
                   WHERE deleted_for_admin.supplier_id = suppliers.id
                     AND deleted_for_admin.admin_key = $4
               )`
            : ''
        const params = [domainKey, wordPattern, limit]
        if (adminKey) params.push(adminKey)

        const result = await connection.query(
            `SELECT suppliers.id, suppliers.supplier, suppliers.description, suppliers.ndis_status
             FROM equipment_suppliers suppliers
             WHERE suppliers.status <> 'hidden'
               AND (suppliers.status <> 'admin_added' OR suppliers.domain = $1)
               AND (suppliers.supplier ~* $2 OR COALESCE(suppliers.description, '') ~* $2)
               ${condition}
             ORDER BY suppliers.supplier ASC
             LIMIT $3`,
            params
        )

        return (result.rows || []).map((row) => toResult(
            'suppliers',
            row,
            normalizeText(row.supplier),
            buildDirectorySubtitle(row)
        ))
    },
}

/**
 * Search the practice for matching records.
 *
 * @param {object} options
 * @param {string} options.query - Raw search term typed by the admin.
 * @param {string} [options.domainKey] - Active practice domain key.
 * @param {string[]|null} [options.entityTypeKeys] - Restrict to these entity types.
 * @param {string} [options.adminKey] - Admin key used for per-admin soft deletes.
 * @param {number|string} [options.limitPerType] - Per-type result cap; defaults to the
 *   header typeahead limit and is clamped to the full-results-page maximum.
 * @returns {Promise<{ results: object[], searchedTypes: string[], typeErrors: object[] }>}
 */
export async function searchPracticeRecords({
    query,
    domainKey = '',
    entityTypeKeys = null,
    adminKey = '',
    limitPerType = PRACTICE_SEARCH_MAX_RESULTS_PER_TYPE,
} = {}) {
    const term = normalizeText(query)
    if (!term) {
        return { results: [], searchedTypes: [], typeErrors: [] }
    }

    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new Error('Practice search requires a configured PostgreSQL database')
    }

    const requestedKeys = Array.isArray(entityTypeKeys) && entityTypeKeys.length > 0
        ? entityTypeKeys
        : PRACTICE_SEARCH_ENTITY_KEYS
    const searchedTypes = requestedKeys.filter((key) => typeof ENTITY_SEARCHERS[key] === 'function')

    const context = {
        likePattern: `%${escapeLikePattern(term)}%`,
        wordPattern: buildWordStartPattern(term),
        domainKey: normalizeText(domainKey).toLowerCase(),
        adminKey: normalizeText(adminKey).toLowerCase(),
        limit: normalizePracticeSearchLimit(limitPerType),
    }

    // Preserve the catalogue's display order rather than the caller's order.
    const orderedKeys = PRACTICE_SEARCH_ENTITY_KEYS.filter((key) => searchedTypes.includes(key))

    let connection = null
    try {
        connection = await getDatabaseConnection()

        const results = []
        const typeErrors = []

        for (const key of orderedKeys) {
            try {
                const rows = await ENTITY_SEARCHERS[key](connection, context)
                results.push(...rows.filter(Boolean))
            } catch (error) {
                // A missing table/unavailable directory should not break the other types.
                typeErrors.push({ type: key, error: error?.message || 'Search failed' })
            }
        }

        return { results, searchedTypes: orderedKeys, typeErrors }
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
        else if (connection?.close) await connection.close().catch(() => { })
    }
}
