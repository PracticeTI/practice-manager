// CSV import pipeline for Patient records.
//
// Import is idempotent: the external system's patient id (stored in
// `external_id`, scoped by domain + external source) is the natural key, so
// re-importing the same file updates only the rows that actually changed. A
// record that was created by hand but matches an imported name is adopted
// (linked to the external id) instead of being duplicated.
//
// Nothing in this module touches the database unless the caller asks it to;
// routes pass a live connection in and get a summary back. Imported records are
// written straight to `patients` and deliberately do not enqueue any agent jobs.

import {
    DEFAULT_EXTERNAL_SOURCE,
    MAX_IMPORT_ROWS,
    cleanString,
    diffPatientFields,
    mapCsvRowToPatient,
    mergePatientImportMetadata,
    normalizeNameKey,
    parsePatientCsv,
} from '@/lib/patients'

const MAX_REPORTED_ERRORS = 50

function buildExistingSelect(dbType) {
    const where = 'domain = $1'
    return `SELECT id, patient_name, external_id, external_source, metadata FROM patients WHERE ${where}`
}

async function runSelect(connection, dbType, sql, params) {
    const result = await connection.query(sql, params)
    return result.rows || []
}

// Only records that are not already linked to an external system are eligible
// for adoption by name: the export can legitimately contain two patients with
// the same name and different ids.
function buildNameIndex(rows) {
    const candidates = new Map()

    rows.forEach((row) => {
        const id = Number.parseInt(String(row?.id ?? ''), 10)
        if (!Number.isFinite(id)) return
        if (cleanString(row?.external_id)) return

        const key = normalizeNameKey(row?.patient_name)
        if (!key) return

        const bucket = candidates.get(key)
        if (bucket) {
            bucket.add(id)
        } else {
            candidates.set(key, new Set([id]))
        }
    })

    // Ambiguous names are dropped rather than guessed at.
    const resolved = new Map()
    candidates.forEach((ids, key) => {
        if (ids.size === 1) resolved.set(key, [...ids][0])
    })
    return resolved
}

function buildExternalIndex(rows, source) {
    const index = new Map()

    rows.forEach((row) => {
        const externalId = cleanString(row?.external_id)
        if (!externalId) return
        if (cleanString(row?.external_source).toLowerCase() !== source) return
        index.set(externalId, row)
    })

    return index
}

async function insertPatient(connection, dbType, domain, fields) {
    const metadata = fields.metadata === null || fields.metadata === undefined
        ? null
        : JSON.stringify(fields.metadata)

    const result = await connection.query(
        `INSERT INTO patients (domain, patient_name, external_id, external_source, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [domain, fields.patient_name, fields.external_id, fields.external_source, metadata]
    )
    return result.rows?.[0]?.id ?? null
}

async function updatePatient(connection, dbType, id, changes) {
    if (changes.length === 0) return

    const values = changes.map((change) => (
        change.key === 'metadata' && change.value !== null && change.value !== undefined
            ? JSON.stringify(change.value)
            : change.value
    ))

    const setClauses = changes.map((change, index) => (
        change.key === 'metadata' ? `metadata = $${index + 1}::jsonb` : `${change.key} = $${index + 1}`
    ))
    await connection.query(
        `UPDATE patients SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1}`,
        [...values, id]
    )
}

/**
 * Import patient rows from a CSV document.
 *
 * @returns {Promise<object>} summary: { total, inserted, updated, unchanged,
 *   skipped, adopted, errors, unknownHeaders, dryRun }
 */
export async function importPatientsFromCsv(connection, dbType, {
    domain,
    csvText,
    source = DEFAULT_EXTERNAL_SOURCE,
    dryRun = false,
} = {}) {
    const errors = []
    const pushError = (row, message) => {
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, message })
    }

    const { records, unknownHeaders, rowCount } = parsePatientCsv(csvText)
    const summary = {
        total: rowCount,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        adopted: 0,
        errors,
        unknownHeaders,
        dryRun: dryRun === true,
    }

    if (rowCount === 0) {
        pushError(0, 'No data rows found in the uploaded file')
        return summary
    }
    if (rowCount > MAX_IMPORT_ROWS) {
        pushError(0, `File contains ${rowCount} rows; the maximum per import is ${MAX_IMPORT_ROWS}`)
        summary.skipped = rowCount
        return summary
    }

    const normalizedSource = cleanString(source).toLowerCase() || DEFAULT_EXTERNAL_SOURCE

    const existingRows = await runSelect(connection, dbType, buildExistingSelect(dbType), [domain])
    const existingByExternalId = buildExternalIndex(existingRows, normalizedSource)
    const nameIndex = buildNameIndex(existingRows)
    const rowsById = new Map(existingRows.map((row) => [Number.parseInt(String(row?.id ?? ''), 10), row]))

    // Guards against a file that repeats a record (which would otherwise try to
    // insert the same external id twice and trip the unique index).
    const seenExternalIds = new Set()
    const claimedRowIds = new Set()

    for (const { rowNumber, raw } of records) {
        const incoming = mapCsvRowToPatient(raw, { source: normalizedSource })

        if (!incoming.external_id) {
            pushError(rowNumber, 'Missing patient ID - row skipped')
            summary.skipped += 1
            continue
        }
        if (seenExternalIds.has(incoming.external_id)) {
            pushError(rowNumber, `Duplicate patient ID "${incoming.external_id}" in this file - row skipped`)
            summary.skipped += 1
            continue
        }
        seenExternalIds.add(incoming.external_id)

        if (!incoming.patient_name) {
            pushError(rowNumber, 'Missing patient name - row skipped')
            summary.skipped += 1
            continue
        }

        let existing = existingByExternalId.get(incoming.external_id) || null
        let adopted = false

        if (!existing) {
            const candidateId = nameIndex.get(normalizeNameKey(incoming.patient_name))
            if (candidateId && !claimedRowIds.has(candidateId)) {
                existing = rowsById.get(candidateId) || null
                if (existing) {
                    adopted = true
                    claimedRowIds.add(candidateId)
                }
            }
        }

        const next = {
            ...incoming,
            metadata: mergePatientImportMetadata(existing?.metadata, incoming.metadata),
        }

        if (!existing) {
            if (!dryRun) {
                await insertPatient(connection, dbType, domain, next)
            }
            summary.inserted += 1
            continue
        }

        const changes = diffPatientFields(existing, next)
        // Adopting a manual record still has to persist the new external id.
        const linkChanges = adopted
            ? [
                { key: 'external_id', value: next.external_id },
                { key: 'external_source', value: next.external_source },
            ].filter((change) => (
                change.key === 'external_id'
                    ? cleanString(existing.external_id) !== change.value
                    : cleanString(existing.external_source).toLowerCase() !== change.value
            ))
            : []

        if (changes.length === 0 && linkChanges.length === 0) {
            summary.unchanged += 1
            continue
        }

        if (adopted) summary.adopted += 1

        if (dryRun) {
            summary.updated += 1
            continue
        }

        await updatePatient(connection, dbType, existing.id, [...linkChanges, ...changes])
        summary.updated += 1
    }

    return summary
}
