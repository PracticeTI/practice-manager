// Publisher/reader for the NDIS catalogue's `system_settings` copy.
//
// `one` is the author: `ndisSupportCatalogue.js` is the curated seed, and this
// module makes sure the published copy in `system_settings` always matches it. The
// worker service reads that copy instead of carrying its own, so the two apps
// cannot disagree about a price limit.
//
// The guarantee is *hash equality*, not hope:
//   * every call recomputes the seed's content hash and compares it with what is
//     stored,
//   * a row that is missing, unusable, or simply a different catalogue is
//     replaced from the seed,
//   * so after any quote operation the published row == the seed, byte for byte.
//
// Deliberately *not* memoised. An earlier version cached "already verified in
// this process", which meant drift introduced after the first verification
// survived until restart — the exact failure this module exists to prevent. Only
// the seed snapshot itself is built once per process; the check is one indexed
// SELECT on a tiny table.

import { getSystemStateValue, setSystemStateValue } from '@/lib/systemState'
import {
    NDIS_CATALOGUE_STATE_KEY,
    buildNdisCatalogueSnapshot,
    describeNdisCatalogueSnapshot,
    isNdisCatalogueSnapshotCurrent,
    ndisCatalogueContentHash,
    normalizeNdisCatalogueSnapshot,
} from '@/lib/ndisCatalogueState'

let seedSnapshot = null

/** The seed snapshot (and its hash) from `ndisSupportCatalogue.js`, built once per process. */
export function getSeedNdisCatalogueSnapshot() {
    if (!seedSnapshot) {
        seedSnapshot = buildNdisCatalogueSnapshot()
    }
    return seedSnapshot
}

export function getSeedNdisCatalogueHash() {
    return getSeedNdisCatalogueSnapshot().contentHash
}

/** The published row exactly as stored, or null when it is missing/unusable. */
export async function readPublishedNdisCatalogue() {
    const stored = await getSystemStateValue(NDIS_CATALOGUE_STATE_KEY)
    return normalizeNdisCatalogueSnapshot(stored)
}

/**
 * Publishes the seed when the stored copy is missing, unusable, or simply not the
 * same data. Safe to call on every quote operation: when it is already in step
 * this is a single SELECT and no write.
 */
export async function ensureNdisCataloguePublished({ force = false } = {}) {
    const seed = getSeedNdisCatalogueSnapshot()
    const stored = await getSystemStateValue(NDIS_CATALOGUE_STATE_KEY)
    const published = normalizeNdisCatalogueSnapshot(stored)

    if (!force && isNdisCatalogueSnapshotCurrent(published, seed.contentHash)) {
        return {
            published: false,
            reason: 'up-to-date',
            storedHash: published.contentHash,
            codeHash: seed.contentHash,
            snapshot: published,
        }
    }

    const reason = !stored
        ? 'missing'
        : !published
            ? 'unusable'
            : force
                ? 'forced'
                : 'drifted'

    const written = await setSystemStateValue(NDIS_CATALOGUE_STATE_KEY, seed)
    if (!written) {
        throw new Error('Failed to publish the NDIS support catalogue to system_settings')
    }

    return {
        published: true,
        reason,
        storedHash: published?.contentHash || null,
        codeHash: seed.contentHash,
        snapshot: seed,
    }
}

/**
 * Publish state for the admin UI / diagnostics: what the seed says, what is
 * stored, and whether they agree. `source` distinguishes "never published" from
 * "published but unusable", because those need different fixes.
 */
export async function ndisCatalogueStatus() {
    const seed = getSeedNdisCatalogueSnapshot()
    const raw = await getSystemStateValue(NDIS_CATALOGUE_STATE_KEY)
    const stored = normalizeNdisCatalogueSnapshot(raw)

    return {
        key: NDIS_CATALOGUE_STATE_KEY,
        matchesCode: isNdisCatalogueSnapshotCurrent(stored, seed.contentHash),
        source: stored ? 'system_settings' : raw ? 'unusable' : 'unpublished',
        code: { ...describeNdisCatalogueSnapshot(seed), hash: seed.contentHash },
        published: describeNdisCatalogueSnapshot(stored),
        // The stamped hash even when the row was rejected, so a drifted row is
        // visible rather than just reported as absent.
        storedContentHash: typeof raw?.contentHash === 'string' ? raw.contentHash : null,
        // Recomputed from the seed, which proves the hash was not just copied.
        seedHashRecomputed: ndisCatalogueContentHash(seed),
    }
}

/** Test seam: forget the memoised seed snapshot. */
export function resetNdisCataloguePublishMemo() {
    seedSnapshot = null
}
