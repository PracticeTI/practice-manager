// Tests for the published NDIS catalogue snapshot.
//
// The point of this module is that a second process can read the same numbers
// the admin app prices against. So the tests are mostly about *proof*: the hash
// is stable for equal data, changes when a price changes, and a stored row whose
// data no longer matches its hash is rejected rather than used.
//
// Run with: node --test test/ndisCatalogueState.test.js

import test from 'node:test'
import assert from 'node:assert/strict'

import { NDIS_SUPPORT_ITEMS } from '../src/lib/ndisSupportCatalogue.js'
import {
    NDIS_CATALOGUE_STATE_KEY,
    NDIS_CATALOGUE_STATE_SCHEMA,
    buildNdisCatalogueSnapshot,
    canonicalNdisCataloguePayload,
    describeNdisCatalogueSnapshot,
    findPublishedItem,
    getPublishedPriceLimit,
    isNdisCatalogueSnapshotCurrent,
    isPublishedQuoteRequired,
    ndisCatalogueContentHash,
    normalizeNdisCatalogueSnapshot,
} from '../src/lib/ndisCatalogueState.js'

const OT_DIRECT_SERVICE = '15_617_0128_1_3'
const CEILING_HOIST = '06_123615401_0111_2_2'

/** Round-trips through TEXT, the way `system_state` stores and returns it. */
function throughSystemState(snapshot) {
    return JSON.parse(JSON.stringify(snapshot))
}

test('the snapshot covers the whole seed catalogue', () => {
    const snapshot = buildNdisCatalogueSnapshot()

    assert.equal(snapshot.schema, NDIS_CATALOGUE_STATE_SCHEMA)
    assert.equal(snapshot.period, '2026-27')
    assert.equal(snapshot.effectiveFrom, '2026-07-01')
    assert.equal(snapshot.items.length, NDIS_SUPPORT_ITEMS.length)
    assert.match(snapshot.contentHash, /^[0-9a-f]{16}$/)
    assert.ok(snapshot.quoteRequiredRegistrationGroups.length > 0)
    assert.ok(Object.keys(snapshot.units).length > 0)
})

test('the state key is the one both apps agree on', () => {
    assert.equal(NDIS_CATALOGUE_STATE_KEY, 'ndis_support_catalogue_v1')
})

test('the hash is stable for equal data and independent of object key order', () => {
    const first = buildNdisCatalogueSnapshot()
    const second = buildNdisCatalogueSnapshot()
    assert.equal(first.contentHash, second.contentHash)

    // Same values, keys inserted in a different order, must hash identically —
    // otherwise a cosmetic edit to the seed would look like drift.
    const scrambled = {
        items: first.items.map((item) => ({
            priceLimits: { very_remote: item.priceLimits.very_remote, remote: item.priceLimits.remote, national: item.priceLimits.national },
            quoteRequired: item.quoteRequired,
            unit: item.unit,
            supportCategoryName: item.supportCategoryName,
            supportCategoryNumber: item.supportCategoryNumber,
            registrationGroupName: item.registrationGroupName,
            registrationGroupNumber: item.registrationGroupNumber,
            name: item.name,
            number: item.number,
        })),
        units: first.units,
        regions: first.regions,
        note: first.note,
        published: first.published,
        effectiveFrom: first.effectiveFrom,
        period: first.period,
        quoteRequiredRegistrationGroups: first.quoteRequiredRegistrationGroups,
    }

    assert.deepEqual(canonicalNdisCataloguePayload(scrambled), canonicalNdisCataloguePayload(first))
    assert.equal(ndisCatalogueContentHash(scrambled), first.contentHash)
})

test('a changed price changes the hash, which is how drift is detected', () => {
    const snapshot = buildNdisCatalogueSnapshot()
    const drifted = throughSystemState(snapshot)

    const target = drifted.items.find((item) => item.number === OT_DIRECT_SERVICE)
    target.priceLimits.national = 999.99

    // Rehashed honestly, a drifted catalogue simply has a different hash.
    const driftedHash = ndisCatalogueContentHash(drifted)
    assert.notEqual(driftedHash, snapshot.contentHash)
    assert.equal(isNdisCatalogueSnapshotCurrent({ ...drifted, contentHash: driftedHash }, snapshot.contentHash), false)

    // With the seed's hash still attached the row contradicts its own data, so it
    // is rejected — which is what makes the publisher rewrite it.
    const tampered = normalizeNdisCatalogueSnapshot(drifted)
    assert.equal(tampered, null)
    assert.equal(isNdisCatalogueSnapshotCurrent(tampered, snapshot.contentHash), false)
})

test('the snapshot survives a system_state round trip', () => {
    const snapshot = buildNdisCatalogueSnapshot()
    const stored = throughSystemState(snapshot)

    const normalized = normalizeNdisCatalogueSnapshot(stored)
    assert.ok(normalized)
    assert.equal(normalized.contentHash, snapshot.contentHash)
    assert.equal(normalized.items.length, snapshot.items.length)
    assert.equal(normalized.units.H.label, 'Hour')
})

test('a JSON-encoded value is accepted, because the column is TEXT', () => {
    const snapshot = buildNdisCatalogueSnapshot()
    const normalized = normalizeNdisCatalogueSnapshot(JSON.stringify(snapshot))
    assert.ok(normalized)
    assert.equal(normalized.contentHash, snapshot.contentHash)
})

test('an unusable stored row is rejected rather than trusted', () => {
    const snapshot = buildNdisCatalogueSnapshot()

    // Missing / wrong shape.
    assert.equal(normalizeNdisCatalogueSnapshot(null), null)
    assert.equal(normalizeNdisCatalogueSnapshot(undefined), null)
    assert.equal(normalizeNdisCatalogueSnapshot('not json'), null)
    assert.equal(normalizeNdisCatalogueSnapshot('[]'), null)
    assert.equal(normalizeNdisCatalogueSnapshot([]), null)
    assert.equal(normalizeNdisCatalogueSnapshot({}), null)

    // Wrong schema version, so a consumer cannot misread it.
    assert.equal(normalizeNdisCatalogueSnapshot({ ...snapshot, schema: 99 }), null)

    // No items, or no hash.
    assert.equal(normalizeNdisCatalogueSnapshot({ ...snapshot, items: [] }), null)
    assert.equal(normalizeNdisCatalogueSnapshot({ ...snapshot, contentHash: '' }), null)
    assert.equal(normalizeNdisCatalogueSnapshot({ ...snapshot, period: '' }), null)
})

test('a stored row whose hash does not match its own data is rejected', () => {
    const snapshot = buildNdisCatalogueSnapshot()
    const tampered = throughSystemState(snapshot)
    tampered.items[0].priceLimits.national = 1

    // The old hash is still attached, so the row is internally inconsistent.
    assert.equal(normalizeNdisCatalogueSnapshot(tampered), null)
})

test('price limits are read from the published snapshot per region', () => {
    const catalogue = normalizeNdisCatalogueSnapshot(buildNdisCatalogueSnapshot())

    assert.equal(getPublishedPriceLimit(catalogue, OT_DIRECT_SERVICE, 'national'), 193.99)
    assert.equal(getPublishedPriceLimit(catalogue, OT_DIRECT_SERVICE, 'remote'), 271.59)
    assert.equal(getPublishedPriceLimit(catalogue, OT_DIRECT_SERVICE, 'very_remote'), 290.99)
    assert.equal(getPublishedPriceLimit(catalogue, OT_DIRECT_SERVICE, 'mars'), 193.99)

    // A quoted support has no published limit, and an unknown item is unknown.
    assert.equal(getPublishedPriceLimit(catalogue, CEILING_HOIST, 'national'), null)
    assert.equal(getPublishedPriceLimit(catalogue, '99_999_9999_9_9', 'national'), null)
})

test('quote-required supports are recognised from the published data', () => {
    const catalogue = normalizeNdisCatalogueSnapshot(buildNdisCatalogueSnapshot())

    assert.equal(isPublishedQuoteRequired(catalogue, OT_DIRECT_SERVICE), false)
    assert.equal(isPublishedQuoteRequired(catalogue, CEILING_HOIST), true)
    // Falls back to the registration-group list for a number outside the items.
    assert.equal(isPublishedQuoteRequired(catalogue, '05_999999999_0105_1_2'), true)
    assert.equal(isPublishedQuoteRequired(catalogue, 'nonsense'), false)
})

test('the picker form of a support item resolves in the published snapshot', () => {
    const catalogue = normalizeNdisCatalogueSnapshot(buildNdisCatalogueSnapshot())
    const item = findPublishedItem(catalogue, `${OT_DIRECT_SERVICE} — Therapy - Occupational Therapist - Direct Service`)
    assert.ok(item)
    assert.equal(item.number, OT_DIRECT_SERVICE)
})

test('describe reports what a consumer should log', () => {
    const description = describeNdisCatalogueSnapshot(buildNdisCatalogueSnapshot())
    assert.equal(description.period, '2026-27')
    assert.equal(description.effectiveFrom, '2026-07-01')
    assert.equal(description.itemCount, NDIS_SUPPORT_ITEMS.length)
    assert.match(description.contentHash, /^[0-9a-f]{16}$/)
    assert.equal(describeNdisCatalogueSnapshot(null), null)
})
