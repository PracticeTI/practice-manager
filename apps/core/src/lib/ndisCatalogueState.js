// Published snapshot of the NDIS support catalogue.
//
// Why this exists: `ndisSupportCatalogue.js` is the *seed* — it is the curated
// data someone edits when the NDIS republishes its pricing schedule. The admin
// app prices and validates quote lines against it. If a second process (the
// worker service) ever needs the same numbers, it must not carry its own copy:
// two catalogues mean two answers to "what is the limit for this support item?".
//
// So the seed is published into `system_settings` (the same key/value table that
// holds `domain_management_settings_v1`), and consumers read it from there. The
// snapshot carries a `contentHash` of its own data, which is what makes drift
// *detectable* rather than a matter of trust: the publisher recomputes the hash
// from the seed and republishes when it differs.
//
// This module is pure and browser-safe (relative imports only) so the seed, the
// publisher, the API route and the tests all compute the same hash.

import {
    NDIS_CATALOGUE_EFFECTIVE_FROM,
    NDIS_CATALOGUE_PERIOD,
    NDIS_PRICING_REGIONS,
    NDIS_PRICING_SCHEDULE_PUBLISHED,
    NDIS_QUOTE_REQUIRED_REGISTRATION_GROUPS,
    NDIS_SUPPORT_ITEMS,
    NDIS_SUPPORT_UNITS,
    NDIS_PRICE_LIMIT_NOTE,
} from './ndisSupportCatalogue.js'

/** `system_settings` key holding the published snapshot. */
export const NDIS_CATALOGUE_STATE_KEY = 'ndis_support_catalogue_v1'

/** Bumped only when the snapshot's own shape changes, so a consumer can reject it. */
export const NDIS_CATALOGUE_STATE_SCHEMA = 1

/** Rows are compared in this order, so every hash is computed over the same bytes. */
const ITEM_FIELDS = [
    'number',
    'name',
    'registrationGroupNumber',
    'registrationGroupName',
    'supportCategoryNumber',
    'supportCategoryName',
    'unit',
    'quoteRequired',
]

const REGION_FIELDS = ['national', 'remote', 'very_remote']

function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function toMoney(value) {
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0
}

/**
 * FNV-1a over two independent seeds, concatenated. Not a security hash — its job
 * is to notice that the catalogue changed, and to do so identically in Node
 * (both apps) and in the browser, with no dependency on `crypto`.
 */
export function stableHashHex(value) {
    const text = String(value === undefined || value === null ? '' : value)
    let first = 0x811c9dc5
    let second = 0x1000193

    for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index)
        first ^= code
        first = Math.imul(first, 0x01000193) >>> 0
        second = Math.imul(second ^ code, 0x85ebca6b) >>> 0
    }

    return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`
}

/**
 * The canonical, order-fixed payload the hash is taken over. Normalising and
 * hashing must use this one function, otherwise a reordering of equivalent data
 * would look like drift.
 */
export function canonicalNdisCataloguePayload(snapshot) {
    const source = snapshot && typeof snapshot === 'object' ? snapshot : {}

    const items = (Array.isArray(source.items) ? source.items : []).map((item) => {
        const row = {}
        for (const field of ITEM_FIELDS) {
            row[field] = field === 'quoteRequired' ? item?.[field] === true : cleanString(item?.[field])
        }
        const limits = item?.priceLimits && typeof item.priceLimits === 'object' ? item.priceLimits : {}
        row.priceLimits = {}
        for (const region of REGION_FIELDS) {
            row.priceLimits[region] = toMoney(limits[region])
        }
        return row
    })

    return {
        schema: NDIS_CATALOGUE_STATE_SCHEMA,
        period: cleanString(source.period),
        effectiveFrom: cleanString(source.effectiveFrom),
        published: cleanString(source.published),
        note: cleanString(source.note),
        regions: (Array.isArray(source.regions) ? source.regions : []).map((region) => ({
            value: cleanString(region?.value),
            label: cleanString(region?.label),
            description: cleanString(region?.description),
        })),
        units: Object.keys(source.units && typeof source.units === 'object' ? source.units : {})
            .sort()
            .map((code) => ({
                code,
                label: cleanString(source.units[code]?.label),
                plural: cleanString(source.units[code]?.plural),
            })),
        quoteRequiredRegistrationGroups: (Array.isArray(source.quoteRequiredRegistrationGroups)
            ? source.quoteRequiredRegistrationGroups
            : []
        ).map((group) => ({ number: cleanString(group?.number), name: cleanString(group?.name) })),
        items,
    }
}

/** The content hash of a snapshot's data (never of the wrapper or the hash itself). */
export function ndisCatalogueContentHash(snapshot) {
    return stableHashHex(JSON.stringify(canonicalNdisCataloguePayload(snapshot)))
}

/**
 * The snapshot built from the seed file. This is what gets published, and what
 * the publisher compares the stored row against.
 */
export function buildNdisCatalogueSnapshot() {
    const snapshot = {
        schema: NDIS_CATALOGUE_STATE_SCHEMA,
        period: NDIS_CATALOGUE_PERIOD,
        effectiveFrom: NDIS_CATALOGUE_EFFECTIVE_FROM,
        published: NDIS_PRICING_SCHEDULE_PUBLISHED,
        note: NDIS_PRICE_LIMIT_NOTE,
        regions: NDIS_PRICING_REGIONS.map((region) => ({ ...region })),
        units: Object.fromEntries(
            Object.entries(NDIS_SUPPORT_UNITS).map(([code, unit]) => [code, { ...unit }])
        ),
        quoteRequiredRegistrationGroups: NDIS_QUOTE_REQUIRED_REGISTRATION_GROUPS.map((group) => ({ ...group })),
        items: NDIS_SUPPORT_ITEMS.map((item) => ({
            number: item.number,
            name: item.name,
            registrationGroupNumber: item.registrationGroupNumber,
            registrationGroupName: item.registrationGroupName,
            supportCategoryNumber: item.supportCategoryNumber,
            supportCategoryName: item.supportCategoryName,
            unit: item.unit,
            quoteRequired: item.quoteRequired === true,
            priceLimits: { ...item.priceLimits },
        })),
    }

    return { ...snapshot, contentHash: ndisCatalogueContentHash(snapshot) }
}

/**
 * Validates a value read back from `system_settings`. Returns null when it cannot be
 * trusted (wrong schema, no items, or a hash that does not match its own data) —
 * a consumer must then refuse to price anything rather than guess.
 */
export function normalizeNdisCatalogueSnapshot(value) {
    let parsed = value
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed)
        } catch {
            return null
        }
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (Number(parsed.schema) !== NDIS_CATALOGUE_STATE_SCHEMA) return null

    const payload = canonicalNdisCataloguePayload(parsed)
    if (payload.items.length === 0) return null
    if (!payload.period) return null

    const storedHash = cleanString(parsed.contentHash)
    if (!storedHash) return null

    // The published row must match its own data, or it is corrupt/stale-shaped.
    const expectedHash = stableHashHex(JSON.stringify(payload))
    if (storedHash !== expectedHash) return null

    return {
        ...payload,
        units: Object.fromEntries(payload.units.map((unit) => [unit.code, { label: unit.label, plural: unit.plural }])),
        contentHash: storedHash,
    }
}

/**
 * True when a snapshot carries exactly this content hash.
 *
 * Compares the *stamped* hash, so pass a snapshot that has been through
 * `normalizeNdisCatalogueSnapshot` (which verifies the stamp against the data).
 * A tampered row normalises to null and so is never "current".
 */
export function isNdisCatalogueSnapshotCurrent(snapshot, expectedContentHash) {
    const hash = cleanString(expectedContentHash)
    if (!snapshot || !hash) return false
    return cleanString(snapshot.contentHash) === hash
}

/** Compact description for API responses, logs and the admin UI. */
export function describeNdisCatalogueSnapshot(snapshot) {
    if (!snapshot) return null
    return {
        period: cleanString(snapshot.period),
        effectiveFrom: cleanString(snapshot.effectiveFrom),
        published: cleanString(snapshot.published),
        itemCount: Array.isArray(snapshot.items) ? snapshot.items.length : 0,
        quoteRequiredRegistrationGroupCount: Array.isArray(snapshot.quoteRequiredRegistrationGroups)
            ? snapshot.quoteRequiredRegistrationGroups.length
            : 0,
        contentHash: cleanString(snapshot.contentHash),
    }
}

/** The price limit for an item in a region, from a *published* snapshot. */
export function getPublishedPriceLimit(snapshot, itemNumber, region) {
    const item = findPublishedItem(snapshot, itemNumber)
    if (!item) return null
    const key = REGION_FIELDS.includes(cleanString(region)) ? cleanString(region) : 'national'
    const limit = toMoney(item.priceLimits?.[key])
    return limit > 0 ? limit : null
}

/** Exact lookup in a published snapshot, tolerant of the picker's "number — name" form. */
export function findPublishedItem(snapshot, itemNumber) {
    const items = Array.isArray(snapshot?.items) ? snapshot.items : []
    const needle = cleanString(itemNumber).toUpperCase()
    if (!needle) return null

    const direct = items.find((item) => cleanString(item.number).toUpperCase() === needle)
    if (direct) return direct

    const candidate = needle.split('—')[0].split(' - ')[0].trim()
    return items.find((item) => cleanString(item.number).toUpperCase() === candidate) || null
}

/** Mirrors `isNdisQuoteRequired` in the seed module, for a published snapshot. */
export function isPublishedQuoteRequired(snapshot, itemNumber) {
    const item = findPublishedItem(snapshot, itemNumber)
    if (item) return item.quoteRequired === true

    const groups = Array.isArray(snapshot?.quoteRequiredRegistrationGroups)
        ? snapshot.quoteRequiredRegistrationGroups
        : []
    const groupNumber = cleanString(itemNumber).toUpperCase().split('_').find((part) => /^\d{4}$/.test(part))
    return Boolean(groupNumber && groups.some((group) => cleanString(group.number) === groupNumber))
}
