// CSV import pipeline for the Notes entity.
//
// Import is idempotent: the external system's note id (stored in `external_id`)
// is the natural key, scoped by domain + external source, so re-importing the
// same file updates only the rows that actually changed.
//
// As well as storing the note, the importer links it to the matching patient so
// the note shows up on that patient's record. A note that cannot be matched is
// still imported - it is simply left unlinked.
//
// A `Created At` column is optional. When the file carries one, that instant is
// written to the note instead of the import time, so the imported history keeps
// the dates the source system recorded.
//
// Nothing in this module touches the database unless the caller asks it to;
// routes pass a live connection in and get a summary back.

import {
    MAX_IMPORT_ROWS,
    NOTE_COLUMN_KEYS,
    cleanString,
    diffNoteFields,
    isEmptyNoteContent,
    mapCsvRowToNote,
    mergeNoteMetadata,
    normalizeNoteRow,
    parseNoteCsv,
} from '@/lib/notes'

const MAX_REPORTED_ERRORS = 50

function buildExistingSelect() {
    return `
        SELECT ${NOTE_COLUMN_KEYS.join(', ')}
        FROM notes
        WHERE domain = $1 AND external_source = $2
    `
}

async function runSelect(connection, sql, params) {
    const result = await connection.query(sql, params)
    return result.rows || []
}

function normalizeNameKey(value) {
    return cleanString(value).toLowerCase().replace(/\s+/g, ' ')
}

// The export can decorate the patient name with an external reference
// ("Belinda Gauci - 431580664"). Index both the full and the base form.
function patientNameKeys(value) {
    const full = normalizeNameKey(value)
    if (!full) return []
    const base = normalizeNameKey(full.split(' - ')[0])
    return base && base !== full ? [full, base] : [full]
}

function buildPatientIndexes(rows) {
    const byExternalId = new Map()
    const nameCandidates = new Map()

    rows.forEach((row) => {
        const id = Number.parseInt(String(row?.id ?? ''), 10)
        if (!Number.isFinite(id)) return

        const externalId = cleanString(row?.external_id)
        if (externalId) {
            const source = cleanString(row?.external_source).toLowerCase() || 'splose'
            byExternalId.set(`${source}:${externalId}`, id)
        }

        patientNameKeys(row?.patient_name).forEach((key) => {
            const bucket = nameCandidates.get(key)
            if (bucket) bucket.add(id)
            else nameCandidates.set(key, new Set([id]))
        })
    })

    // Ambiguous names are dropped rather than guessed at.
    const byName = new Map()
    nameCandidates.forEach((ids, key) => {
        if (ids.size === 1) byName.set(key, [...ids][0])
    })

    return { byExternalId, byName }
}

async function loadPatients(connection, domain) {
    try {
        return await runSelect(
            connection,
            'SELECT id, patient_name, external_id, external_source FROM patients WHERE domain = $1',
            [domain]
        )
    } catch {
        // Patients are optional for this feature; a missing table or column
        // just means imported notes are not linked automatically.
        return []
    }
}

function resolvePatientId(indexes, note, source) {
    const externalId = cleanString(note?.external_patient_id)
    if (externalId) {
        const linked = indexes.byExternalId.get(`${source}:${externalId}`)
        if (linked) return linked
    }

    for (const key of patientNameKeys(note?.patient_name)) {
        const id = indexes.byName.get(key)
        if (id) return id
    }

    return null
}

function serializeValue(key, value) {
    if (key === 'content' || key === 'metadata') {
        return value === null || value === undefined ? null : JSON.stringify(value)
    }
    return value === undefined ? null : value
}

async function insertNote(connection, domain, fields) {
    const keys = ['domain']
    const values = [domain]

    NOTE_COLUMN_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) return
        // Nothing to retain: let the column's DEFAULT NOW() stamp the row.
        if (key === 'created_at' && !fields[key]) return
        keys.push(key)
        values.push(serializeValue(key, fields[key]))
    })

    const placeholders = keys.map((_key, index) => `$${index + 1}`)
    const result = await connection.query(
        `INSERT INTO notes (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        values
    )
    return result.rows?.[0]?.id ?? null
}

async function updateNote(connection, id, changes) {
    if (changes.length === 0) return

    const values = changes.map((change) => serializeValue(change.key, change.value))
    const setClauses = changes.map((change, index) => `${change.key} = $${index + 1}`)

    await connection.query(
        `UPDATE notes SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1}`,
        [...values, id]
    )
}

/**
 * Import clinical notes from a CSV document.
 *
 * @returns {Promise<object>} summary: { total, inserted, updated, unchanged,
 *   skipped, linked, errors, unknownHeaders, dryRun }
 */
export async function importNotesFromCsv(connection, {
    domain,
    csvText,
    source = 'splose',
    dryRun = false,
} = {}) {
    const errors = []
    const pushError = (row, message) => {
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, message })
    }

    const { records, unknownHeaders, rowCount } = parseNoteCsv(csvText)
    const summary = {
        total: rowCount,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        linked: 0,
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

    const normalizedSource = cleanString(source).toLowerCase() || 'splose'

    const existingRows = await runSelect(connection, buildExistingSelect(), [domain, normalizedSource])
    const existingByExternalId = new Map()
    existingRows.forEach((row) => {
        const key = cleanString(row?.external_id)
        if (key) existingByExternalId.set(key, normalizeNoteRow(row))
    })

    const patientRows = await loadPatients(connection, domain)
    const patientIndexes = buildPatientIndexes(patientRows)
    const seenExternalIds = new Set()

    for (const { rowNumber, raw } of records) {
        const incoming = mapCsvRowToNote(raw, { source: normalizedSource })

        if (!incoming.external_id) {
            pushError(rowNumber, 'Missing note ID - row skipped')
            summary.skipped += 1
            continue
        }
        if (seenExternalIds.has(incoming.external_id)) {
            pushError(rowNumber, `Duplicate note ID "${incoming.external_id}" in this file - row skipped`)
            summary.skipped += 1
            continue
        }
        seenExternalIds.add(incoming.external_id)

        if (!incoming.title && isEmptyNoteContent(incoming.content)) {
            pushError(rowNumber, 'Row has neither a title nor note content - row skipped')
            summary.skipped += 1
            continue
        }

        const existing = existingByExternalId.get(incoming.external_id) || null
        const resolvedPatientId = resolvePatientId(patientIndexes, incoming, normalizedSource)

        const next = {
            ...incoming,
            // Never blank out a manually linked patient with an unresolved import.
            patient_id: resolvedPatientId ?? existing?.patient_id ?? null,
            // Keep the creation time the file carries. A file without the column
            // leaves an already-imported note's timestamp alone.
            created_at: incoming.created_at ?? existing?.created_at ?? null,
            metadata: mergeNoteMetadata(existing?.metadata, incoming.metadata),
        }

        if (next.patient_id) summary.linked += 1

        if (!existing) {
            if (!dryRun) {
                await insertNote(connection, domain, next)
            }
            summary.inserted += 1
            continue
        }

        const changes = diffNoteFields(existing, next)
        if (changes.length === 0) {
            summary.unchanged += 1
            continue
        }

        if (!dryRun) {
            await updateNote(connection, existing.id, changes)
        }
        summary.updated += 1
    }

    return summary
}
