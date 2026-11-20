import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { BUILT_IN_FUNDER_SEEDS } from '@/lib/funderRegistry'
import {
    DEFAULT_FUNDER_DOCUMENT_STATUS,
    DEFAULT_FUNDER_STATUS,
    normalizeFunder,
    normalizeFunderDocument,
    normalizeFunderKey,
    sortFunderDocuments,
    validateFunder,
    validateFunderDocument,
} from '@/lib/funders'
import { ensureFundersTables } from '@/lib/fundersTable'

const FUNDER_COLUMNS = 'id, key, name, full_name, description, jurisdiction, website_url, status, sort_order, metadata, created_at, updated_at'
const DOCUMENT_COLUMNS = 'id, funder_id, key, title, url, category, doc_type, description, effective_period, is_primary, position, status, link_status, http_status, link_checked_at, metadata, created_at, updated_at'

/** Funder keys are unique per row; documents are unique per funder. */
function toNumericId(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function toMetadataParam(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return JSON.stringify(value)
}

function rowToFunder(row) {
    if (!row) return null
    return normalizeFunder({
        ...row,
        id: toNumericId(row.id),
        metadata: row.metadata || {},
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    })
}

function rowToDocument(row) {
    if (!row) return null
    return normalizeFunderDocument({
        ...row,
        id: toNumericId(row.id),
        funder_id: toNumericId(row.funder_id),
        metadata: row.metadata || {},
        created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
        updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    })
}

async function loadDocuments(connection, funderId, { includeUnpublished = true } = {}) {
    const params = [funderId]
    let query = `SELECT ${DOCUMENT_COLUMNS} FROM funder_documents WHERE funder_id = $1`
    if (!includeUnpublished) query += " AND status = 'published'"
    query += ' ORDER BY position ASC, id ASC'

    const result = await connection.query(query, params)
    return sortFunderDocuments((result.rows || []).map(rowToDocument))
}

/**
 * Insert the built-in funders/documents when they are missing.
 *
 * Additive only, and deliberately *not* re-run for a funder that already has
 * documents: an admin edit or a deleted document must survive a restart. The one
 * exception is a funder row that exists with no documents at all (e.g. a row
 * created directly in the database), which is backfilled from the registry.
 */
async function seedBuiltInFunders(connection) {
    for (const seed of BUILT_IN_FUNDER_SEEDS) {
        const existing = await connection.query('SELECT id FROM funders WHERE key = $1 LIMIT 1', [seed.key])
        let funderId = toNumericId(existing.rows?.[0]?.id)

        if (!funderId) {
            const funder = normalizeFunder(seed)
            const inserted = await connection.query(
                `INSERT INTO funders (key, name, full_name, description, jurisdiction, website_url, status, sort_order, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id`,
                [
                    funder.key,
                    funder.name,
                    funder.full_name,
                    funder.description,
                    funder.jurisdiction,
                    funder.website_url,
                    funder.status || DEFAULT_FUNDER_STATUS,
                    funder.sort_order,
                    toMetadataParam(funder.metadata),
                ]
            )
            funderId = toNumericId(inserted.rows?.[0]?.id)
            if (!funderId) continue
        }

        const documentCount = await connection.query(
            'SELECT COUNT(*)::int AS count FROM funder_documents WHERE funder_id = $1',
            [funderId]
        )
        if (Number(documentCount.rows?.[0]?.count || 0) > 0) continue

        for (const [index, seedDocument] of (seed.documents || []).entries()) {
            const document = normalizeFunderDocument({ ...seedDocument, position: seedDocument.position ?? index })
            await connection.query(
                `INSERT INTO funder_documents
                    (funder_id, key, title, url, category, doc_type, description, effective_period, is_primary, position, status, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
                [
                    funderId,
                    document.key,
                    document.title,
                    document.url,
                    document.category,
                    document.doc_type,
                    document.description,
                    document.effective_period,
                    document.is_primary,
                    document.position,
                    document.status || DEFAULT_FUNDER_DOCUMENT_STATUS,
                    toMetadataParam(document.metadata),
                ]
            )
        }
    }
}

/**
 * Seeding is idempotent but pointless on every request, so it runs once per
 * process. A failure clears the memo so the next request retries, and a change to
 * the registry is picked up on the next dev reload / deploy restart.
 */
let seedOncePromise = null

function closeConnection(connection) {
    if (connection?.end) return connection.end().catch(() => { })
    if (connection?.close) return connection.close().catch(() => { })
    return undefined
}

function ensureSeededOnce() {
    if (!seedOncePromise) {
        seedOncePromise = (async () => {
            const connection = await getDatabaseConnection()
            try {
                await seedBuiltInFunders(connection)
            } finally {
                await closeConnection(connection)
            }
        })().catch((error) => {
            seedOncePromise = null
            throw error
        })
    }
    return seedOncePromise
}

async function withConnection(callback) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') throw new Error('Relational database required')

    await ensureFundersTables()
    await ensureSeededOnce()

    const connection = await getDatabaseConnection()
    try {
        return await callback(connection, dbType)
    } finally {
        await closeConnection(connection)
    }
}

async function loadFunder(connection, funderId, { includeUnpublished = true } = {}) {
    const result = await connection.query(
        `SELECT ${FUNDER_COLUMNS} FROM funders WHERE id = $1 LIMIT 1`,
        [funderId]
    )
    const funder = rowToFunder(result.rows?.[0] || null)
    if (!funder) return null
    funder.documents = await loadDocuments(connection, funderId, { includeUnpublished })
    return funder
}

/**
 * Every funder, each with its documents, in display order. The funders list is
 * small (a handful of schemes), so documents are loaded eagerly rather than in a
 * second round trip.
 */
export async function listFunders({ includeUnpublished = true } = {}) {
    return withConnection(async (connection) => {
        let query = `SELECT ${FUNDER_COLUMNS} FROM funders`
        if (!includeUnpublished) query += " WHERE status = 'published'"
        query += ' ORDER BY sort_order ASC, name ASC'

        const result = await connection.query(query)
        const funders = []
        for (const row of result.rows || []) {
            const funder = rowToFunder(row)
            if (!funder) continue
            funder.documents = await loadDocuments(connection, funder.id, { includeUnpublished })
            funders.push(funder)
        }
        return funders
    })
}

/** One funder, with its documents, by numeric id. */
export async function getFunderById(funderId, options = {}) {
    const id = toNumericId(funderId)
    if (!id) return null
    return withConnection((connection) => loadFunder(connection, id, options))
}

/** One funder, with its documents, by stable key (e.g. `ndis`). */
export async function getFunderByKey(funderKey, options = {}) {
    const key = normalizeFunderKey(funderKey)
    if (!key) return null
    return withConnection(async (connection) => {
        const result = await connection.query('SELECT id FROM funders WHERE key = $1 LIMIT 1', [key])
        const id = toNumericId(result.rows?.[0]?.id)
        if (!id) return null
        return loadFunder(connection, id, options)
    })
}

/** Create a funder. The key defaults to a slug of the name and must be unique. */
export async function createFunder(input) {
    const funder = normalizeFunder(input)
    const errors = validateFunder(funder, { requireKey: false })
    if (errors.length > 0) throw new Error(errors.join('. '))
    if (!funder.key) throw new Error('A funder key could not be derived from the name')

    return withConnection(async (connection) => {
        const clash = await connection.query('SELECT id FROM funders WHERE key = $1 LIMIT 1', [funder.key])
        if (clash.rows?.length) throw new Error(`A funder with the key "${funder.key}" already exists`)

        const inserted = await connection.query(
            `INSERT INTO funders (key, name, full_name, description, jurisdiction, website_url, status, sort_order, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
                funder.key,
                funder.name,
                funder.full_name,
                funder.description,
                funder.jurisdiction,
                funder.website_url,
                funder.status || DEFAULT_FUNDER_STATUS,
                funder.sort_order,
                toMetadataParam(funder.metadata),
            ]
        )
        const id = toNumericId(inserted.rows?.[0]?.id)
        return loadFunder(connection, id)
    })
}

/** Update a funder. Unspecified fields keep their stored value. */
export async function updateFunder(funderId, input) {
    const id = toNumericId(funderId)
    if (!id) throw new Error('Invalid funder id')

    return withConnection(async (connection) => {
        const existingResult = await connection.query(
            `SELECT ${FUNDER_COLUMNS} FROM funders WHERE id = $1 LIMIT 1`,
            [id]
        )
        const existing = rowToFunder(existingResult.rows?.[0] || null)
        if (!existing) throw new Error('Funder not found')

        const next = normalizeFunder({
            ...existing,
            ...(input && typeof input === 'object' ? input : {}),
            id: existing.id,
            metadata: { ...existing.metadata, ...(input?.metadata || {}) },
        })
        // The key stays stable across edits: features look documents up by it, and
        // changing it would silently break those lookups.
        next.key = existing.key

        const errors = validateFunder(next)
        if (errors.length > 0) throw new Error(errors.join('. '))

        await connection.query(
            `UPDATE funders
                SET name = $2, full_name = $3, description = $4, jurisdiction = $5, website_url = $6,
                    status = $7, sort_order = $8, metadata = $9, updated_at = NOW()
              WHERE id = $1`,
            [
                id,
                next.name,
                next.full_name,
                next.description,
                next.jurisdiction,
                next.website_url,
                next.status || DEFAULT_FUNDER_STATUS,
                next.sort_order,
                toMetadataParam(next.metadata),
            ]
        )
        return loadFunder(connection, id)
    })
}

/** Delete a funder and its documents (there is no foreign key to cascade for us). */
export async function deleteFunder(funderId) {
    const id = toNumericId(funderId)
    if (!id) throw new Error('Invalid funder id')

    return withConnection(async (connection) => {
        const existing = await connection.query('SELECT id FROM funders WHERE id = $1 LIMIT 1', [id])
        if (!existing.rows?.length) throw new Error('Funder not found')

        await connection.query('DELETE FROM funder_documents WHERE funder_id = $1', [id])
        await connection.query('DELETE FROM funders WHERE id = $1', [id])
        return { id, deleted: true }
    })
}

/** Documents for a funder, in display order. */
export async function listFunderDocuments(funderId, options = {}) {
    const id = toNumericId(funderId)
    if (!id) throw new Error('Invalid funder id')
    return withConnection((connection) => loadDocuments(connection, id, options))
}

/**
 * Derive a document key that is unique within the funder. Seeded keys are stable
 * slugs; a hand-added document falls back to a slug of its title.
 */
async function resolveUniqueDocumentKey(connection, funderId, desiredKey, ignoreDocumentId = null) {
    const base = normalizeFunderKey(desiredKey) || 'document'
    const existing = await connection.query(
        'SELECT id, key FROM funder_documents WHERE funder_id = $1',
        [funderId]
    )
    const taken = new Set(
        (existing.rows || [])
            .filter((row) => toNumericId(row.id) !== toNumericId(ignoreDocumentId))
            .map((row) => String(row.key || ''))
    )
    if (!taken.has(base)) return base

    let suffix = 2
    let candidate = `${base}-${suffix}`
    while (taken.has(candidate)) {
        suffix += 1
        candidate = `${base}-${suffix}`
    }
    return candidate
}

/** Only one document per funder can be primary. */
async function clearPrimaryDocument(connection, funderId, exceptDocumentId = null) {
    const params = [funderId]
    let query = 'UPDATE funder_documents SET is_primary = FALSE, updated_at = NOW() WHERE funder_id = $1'
    if (toNumericId(exceptDocumentId)) {
        params.push(toNumericId(exceptDocumentId))
        query += ' AND id <> $2'
    }
    await connection.query(query, params)
}

/** Add a document to a funder. */
export async function createFunderDocument(funderId, input) {
    const id = toNumericId(funderId)
    if (!id) throw new Error('Invalid funder id')

    const document = normalizeFunderDocument(input)
    const errors = validateFunderDocument(document)
    if (errors.length > 0) throw new Error(errors.join('. '))

    return withConnection(async (connection) => {
        const funder = await connection.query('SELECT id FROM funders WHERE id = $1 LIMIT 1', [id])
        if (!funder.rows?.length) throw new Error('Funder not found')

        const key = await resolveUniqueDocumentKey(connection, id, document.key || document.title)

        if (document.is_primary) await clearPrimaryDocument(connection, id)

        const inserted = await connection.query(
            `INSERT INTO funder_documents
                (funder_id, key, title, url, category, doc_type, description, effective_period, is_primary, position, status, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING ${DOCUMENT_COLUMNS}`,
            [
                id,
                key,
                document.title,
                document.url,
                document.category,
                document.doc_type,
                document.description,
                document.effective_period,
                document.is_primary,
                document.position,
                document.status || DEFAULT_FUNDER_DOCUMENT_STATUS,
                toMetadataParam(document.metadata),
            ]
        )
        return rowToDocument(inserted.rows?.[0] || null)
    })
}

/** Update a document. Unspecified fields keep their stored value. */
export async function updateFunderDocument(funderId, documentId, input) {
    const id = toNumericId(funderId)
    const docId = toNumericId(documentId)
    if (!id || !docId) throw new Error('Invalid funder or document id')

    return withConnection(async (connection) => {
        const existingResult = await connection.query(
            `SELECT ${DOCUMENT_COLUMNS} FROM funder_documents WHERE id = $1 AND funder_id = $2 LIMIT 1`,
            [docId, id]
        )
        const existing = rowToDocument(existingResult.rows?.[0] || null)
        if (!existing) throw new Error('Document not found')

        const next = normalizeFunderDocument({
            ...existing,
            ...(input && typeof input === 'object' ? input : {}),
            id: existing.id,
            funder_id: existing.funder_id,
            metadata: { ...existing.metadata, ...(input?.metadata || {}) },
        })
        const errors = validateFunderDocument(next)
        if (errors.length > 0) throw new Error(errors.join('. '))

        // The key follows the title unless a caller sets it explicitly, but stays
        // unique within the funder.
        const desiredKey = normalizeFunderKey(input?.key || existing.key || next.title)
        next.key = await resolveUniqueDocumentKey(connection, id, desiredKey, docId)

        if (next.is_primary) await clearPrimaryDocument(connection, id, docId)

        await connection.query(
            `UPDATE funder_documents
                SET key = $3, title = $4, url = $5, category = $6, doc_type = $7, description = $8,
                    effective_period = $9, is_primary = $10, position = $11, status = $12,
                    metadata = $13, updated_at = NOW()
              WHERE id = $1 AND funder_id = $2`,
            [
                docId,
                id,
                next.key,
                next.title,
                next.url,
                next.category,
                next.doc_type,
                next.description,
                next.effective_period,
                next.is_primary,
                next.position,
                next.status || DEFAULT_FUNDER_DOCUMENT_STATUS,
                toMetadataParam(next.metadata),
            ]
        )

        const updated = await connection.query(
            `SELECT ${DOCUMENT_COLUMNS} FROM funder_documents WHERE id = $1 LIMIT 1`,
            [docId]
        )
        return rowToDocument(updated.rows?.[0] || null)
    })
}

/** Remove a document from a funder. */
export async function deleteFunderDocument(funderId, documentId) {
    const id = toNumericId(funderId)
    const docId = toNumericId(documentId)
    if (!id || !docId) throw new Error('Invalid funder or document id')

    return withConnection(async (connection) => {
        const result = await connection.query(
            'DELETE FROM funder_documents WHERE id = $1 AND funder_id = $2',
            [docId, id]
        )
        if (!result.rowCount) throw new Error('Document not found')
        return { id: docId, funder_id: id, deleted: true }
    })
}

/**
 * Persist funder link-check results (see `src/lib/funderLinkCheck.js`) onto the
 * documents they belong to. Only the three link-health columns are touched, so an
 * admin edit made while a check was running is never overwritten.
 *
 * @param {Array<{ documentId: number, status: string, httpStatus?: number|null, checkedAt?: string }>} results
 * @returns {Promise<{ updated: number }>}
 */
export async function applyFunderLinkResults(results) {
    const list = (Array.isArray(results) ? results : [])
        .map((result) => {
            const rawHttpStatus = result?.httpStatus ?? result?.http_status
            const httpStatus = rawHttpStatus === null || rawHttpStatus === undefined || rawHttpStatus === ''
                ? null
                : Number.parseInt(String(rawHttpStatus), 10)

            return {
                documentId: toNumericId(result?.documentId ?? result?.document_id),
                status: String(result?.status || '').trim().toLowerCase(),
                httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
                checkedAt: result?.checkedAt || result?.checked_at || new Date().toISOString(),
            }
        })
        .filter((result) => result.documentId && result.status)

    if (list.length === 0) return { updated: 0 }

    return withConnection(async (connection) => {
        for (const result of list) {
            await connection.query(
                `UPDATE funder_documents
                    SET link_status = $2, http_status = $3, link_checked_at = $4
                  WHERE id = $1`,
                [result.documentId, result.status, result.httpStatus, result.checkedAt]
            )
        }
        return { updated: list.length }
    })
}