/**
 * Published NDIS support catalogue (read-only).
 *
 * The admin app owns the curated seed (`ndisSupportCatalogue.js`) and publishes
 * it to `system_state` under `ndis_support_catalogue_v1`, hash-checked against
 * the seed. This module is how the worker service reads that same data instead
 * of carrying a second copy — two catalogues would mean two answers to "what is
 * the price limit for this support item?".
 *
 * Two deliberate rules:
 *   1. An unpublished or structurally unusable row is an **error**, never a
 *      silent fallback. This service has no catalogue of its own to fall back
 *      to, and guessing a price is worse than refusing to draft.
 *   2. `contentHash` is treated as opaque. The publisher owns the canonical
 *      form; duplicating the hashing rules here is exactly the kind of copied
 *      logic this module exists to avoid. Drift against the seed is detected by
 *      the app (see `GET /api/database/ndis-catalogue`), not by us.
 */

import { detectDatabaseType, getDatabaseConnection } from './database.js'

export const NDIS_CATALOGUE_STATE_KEY = 'ndis_support_catalogue_v1'
export const SUPPORTED_NDIS_CATALOGUE_STATE_SCHEMA = 1

const PRICING_REGIONS = ['national', 'remote', 'very_remote']
const DEFAULT_PRICING_REGION = 'national'

export class NdisCatalogueUnavailableError extends Error {
    constructor(message) {
        super(message)
        this.name = 'NdisCatalogueUnavailableError'
    }
}

function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function parseInlineValue(value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null
    try {
        return JSON.parse(value)
    } catch {
        return null
    }
}

function isMissingTableError(error) {
    const message = String(error?.message || '').toLowerCase()
    return message.includes('does not exist') || message.includes("doesn't exist")
}

/** Structural validation only — see rule 2 above. */
export function normalizePublishedCatalogue(value) {
    const parsed = parseInlineValue(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    if (Number(parsed.schema) !== SUPPORTED_NDIS_CATALOGUE_STATE_SCHEMA) return null
    if (!cleanString(parsed.period)) return null
    if (!cleanString(parsed.contentHash)) return null
    if (!Array.isArray(parsed.items) || parsed.items.length === 0) return null

    return {
        schema: SUPPORTED_NDIS_CATALOGUE_STATE_SCHEMA,
        period: cleanString(parsed.period),
        effectiveFrom: cleanString(parsed.effectiveFrom),
        published: cleanString(parsed.published),
        note: cleanString(parsed.note),
        contentHash: cleanString(parsed.contentHash),
        regions: Array.isArray(parsed.regions) ? parsed.regions : [],
        units: parsed.units && typeof parsed.units === 'object' ? parsed.units : {},
        quoteRequiredRegistrationGroups: Array.isArray(parsed.quoteRequiredRegistrationGroups)
            ? parsed.quoteRequiredRegistrationGroups
            : [],
        items: parsed.items.map((item) => ({
            number: cleanString(item?.number),
            name: cleanString(item?.name),
            registrationGroupNumber: cleanString(item?.registrationGroupNumber),
            registrationGroupName: cleanString(item?.registrationGroupName),
            supportCategoryNumber: cleanString(item?.supportCategoryNumber),
            supportCategoryName: cleanString(item?.supportCategoryName),
            unit: cleanString(item?.unit),
            quoteRequired: item?.quoteRequired === true,
            priceLimits: {
                national: Number(item?.priceLimits?.national) || 0,
                remote: Number(item?.priceLimits?.remote) || 0,
                very_remote: Number(item?.priceLimits?.very_remote) || 0,
            },
        })),
    }
}

async function readSystemStateValue(connection, key) {
    const result = await connection.query(
        'SELECT value FROM system_state WHERE "key" = $1 ORDER BY updated_at DESC LIMIT 1',
        [key]
    )
    return result.rows?.[0]?.value ?? null
}

/**
 * Reads the published catalogue, throwing when it is missing or unusable.
 * Pass an existing `connection` to reuse this process's handle.
 */
export async function readPublishedNdisCatalogue({ connection = null } = {}) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        throw new NdisCatalogueUnavailableError(`The NDIS catalogue needs PostgreSQL (got ${dbType || 'none'})`)
    }

    let ownedConnection = null
    try {
        const activeConnection = connection || (ownedConnection = await getDatabaseConnection())

        let raw = null
        try {
            raw = await readSystemStateValue(activeConnection, NDIS_CATALOGUE_STATE_KEY)
        } catch (error) {
            // A database that has never stored any system state has no table yet.
            if (isMissingTableError(error)) throwUnavailable('has never been published')
            throw error
        }

        if (!raw) {
            throwUnavailable('has never been published')
        }

        const catalogue = normalizePublishedCatalogue(raw)
        if (!catalogue) {
            throwUnavailable('is present but unusable')
        }

        return catalogue
    } finally {
        if (ownedConnection?.end) await ownedConnection.end().catch(() => { })
        else if (ownedConnection?.close) await ownedConnection.close().catch(() => { })
    }
}

function throwUnavailable(reason) {
    throw new NdisCatalogueUnavailableError(
        `The published NDIS support catalogue (${NDIS_CATALOGUE_STATE_KEY}) ${reason}. ` +
        'The admin app publishes it automatically on its next quote operation, ' +
        'or push it with POST /api/database/ndis-catalogue.'
    )
}

/** Non-throwing read, for logging/preflight checks. */
export async function tryReadPublishedNdisCatalogue(options = {}) {
    try {
        const catalogue = await readPublishedNdisCatalogue(options)
        return { ok: true, catalogue, error: null }
    } catch (error) {
        return { ok: false, catalogue: null, error: error?.message || String(error) }
    }
}

function resolveRegion(region) {
    const key = cleanString(region).toLowerCase()
    return PRICING_REGIONS.includes(key) ? key : DEFAULT_PRICING_REGION
}

/** Exact lookup, tolerant of the picker's "number — name" form. */
export function findNdisSupportItem(catalogue, itemNumber) {
    const items = Array.isArray(catalogue?.items) ? catalogue.items : []
    const needle = cleanString(itemNumber).toUpperCase()
    if (!needle) return null

    const direct = items.find((item) => cleanString(item.number).toUpperCase() === needle)
    if (direct) return direct

    const candidate = needle.split('—')[0].split(' - ')[0].trim()
    return items.find((item) => cleanString(item.number).toUpperCase() === candidate) || null
}

/** The published maximum for one item in one region, or null for quote-based items. */
export function getNdisCataloguePriceLimit(catalogue, itemNumber, region = DEFAULT_PRICING_REGION) {
    const item = findNdisSupportItem(catalogue, itemNumber)
    if (!item) return null

    const limit = Number(item.priceLimits?.[resolveRegion(region)]) || 0
    return limit > 0 ? limit : null
}

/** Mirrors the app's `isNdisQuoteRequired`, against the published data. */
export function isNdisQuoteRequiredInCatalogue(catalogue, itemNumber) {
    const item = findNdisSupportItem(catalogue, itemNumber)
    if (item) return item.quoteRequired === true

    const groups = Array.isArray(catalogue?.quoteRequiredRegistrationGroups)
        ? catalogue.quoteRequiredRegistrationGroups
        : []
    const groupNumber = cleanString(itemNumber).toUpperCase().split('_').find((part) => /^\d{4}$/.test(part))
    return Boolean(groupNumber && groups.some((group) => cleanString(group?.number) === groupNumber))
}

export function describeNdisCatalogue(catalogue) {
    if (!catalogue) return null
    return {
        period: catalogue.period,
        effectiveFrom: catalogue.effectiveFrom,
        itemCount: catalogue.items.length,
        contentHash: catalogue.contentHash,
    }
}

export default {
    readPublishedNdisCatalogue,
    tryReadPublishedNdisCatalogue,
    findNdisSupportItem,
    getNdisCataloguePriceLimit,
    isNdisQuoteRequiredInCatalogue,
    describeNdisCatalogue,
}
