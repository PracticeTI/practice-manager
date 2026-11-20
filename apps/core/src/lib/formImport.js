// CSV import pipeline for the Forms entity.
//
// Import is idempotent: the external system's submission id (stored in
// `external_id`) is the natural key, scoped by domain + external source, so
// re-importing the same file updates only the rows that actually changed.
//
// As well as storing the submission, the importer links it to the matching
// patient and copies the answers the app's intake schema understands onto that
// patient's Intake Data. Only blank answers are filled, so re-importing
// historical submissions never overwrites intake data a clinician has edited.
//
// Nothing in this module touches the database unless the caller asks it to;
// routes pass a live connection in and get a summary back.

import {
    FORM_COLUMN_KEYS,
    MAX_IMPORT_ROWS,
    applyFormAnswersToPatientMetadata,
    cleanString,
    diffFormFields,
    mapCsvRowToForm,
    mergeFormMetadata,
    normalizeFormRow,
    parseFormCsv,
    parseMetadataValue,
    timestampExpr,
} from '@/lib/forms'

const MAX_REPORTED_ERRORS = 50

function buildExistingSelect() {
    const columns = [
        'id',
        ...FORM_COLUMN_KEYS.map((key) => (key === 'submitted_at' ? `${timestampExpr('submitted_at')} AS submitted_at` : key)),
    ]

    return `
        SELECT ${columns.join(', ')}
        FROM forms
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
            'SELECT id, patient_name, external_id, external_source, metadata FROM patients WHERE domain = $1',
            [domain]
        )
    } catch {
        // Patients are optional for this feature; a missing table or column
        // just means imported forms are not linked automatically.
        return []
    }
}

function resolvePatientId(indexes, form, source) {
    const externalId = cleanString(form?.external_patient_id)
    if (externalId) {
        const linked = indexes.byExternalId.get(`${source}:${externalId}`)
        if (linked) return linked
    }

    for (const key of patientNameKeys(form?.patient_name)) {
        const id = indexes.byName.get(key)
        if (id) return id
    }

    return null
}

function serializeValue(key, value) {
    if (key === 'content' || key === 'answers' || key === 'labelled_answers' || key === 'metadata') {
        return value === null || value === undefined ? null : JSON.stringify(value)
    }
    return value === undefined ? null : value
}

async function insertForm(connection, domain, fields) {
    const keys = ['domain']
    const values = [domain]

    FORM_COLUMN_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) return
        keys.push(key)
        values.push(serializeValue(key, fields[key]))
    })

    const placeholders = keys.map((_key, index) => `$${index + 1}`)
    const result = await connection.query(
        `INSERT INTO forms (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        values
    )
    return result.rows?.[0]?.id ?? null
}

async function updateForm(connection, id, changes) {
    if (changes.length === 0) return

    const values = changes.map((change) => serializeValue(change.key, change.value))
    const setClauses = changes.map((change, index) => `${change.key} = $${index + 1}`)

    await connection.query(
        `UPDATE forms SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $${values.length + 1}`,
        [...values, id]
    )
}

async function updatePatientMetadata(connection, domain, entries) {
    let updated = 0

    for (const [patientId, metadata] of entries) {
        await connection.query(
            'UPDATE patients SET metadata = $1::jsonb, updated_at = NOW() WHERE id = $2 AND domain = $3',
            [JSON.stringify(metadata), patientId, domain]
        )
        updated += 1
    }

    return updated
}

/**
 * Import form submissions from a CSV document.
 *
 * @returns {Promise<object>} summary: { total, inserted, updated, unchanged,
 *   skipped, linked, enriched, errors, unknownHeaders, dryRun }
 */
export async function importFormsFromCsv(connection, {
    domain,
    csvText,
    source = 'splose',
    dryRun = false,
} = {}) {
    const errors = []
    const pushError = (row, message) => {
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, message })
    }

    const { records, unknownHeaders, rowCount } = parseFormCsv(csvText)
    const summary = {
        total: rowCount,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        linked: 0,
        enriched: 0,
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
        if (key) existingByExternalId.set(key, normalizeFormRow(row))
    })

    const patientRows = await loadPatients(connection, domain)
    const patientIndexes = buildPatientIndexes(patientRows)
    const patientMetadata = new Map()
    patientRows.forEach((row) => {
        const id = Number.parseInt(String(row?.id ?? ''), 10)
        if (Number.isFinite(id)) patientMetadata.set(id, parseMetadataValue(row?.metadata) || {})
    })
    const patientsToWrite = new Map()
    const seenExternalIds = new Set()

    for (const { rowNumber, raw } of records) {
        const incoming = mapCsvRowToForm(raw, { source: normalizedSource })

        if (!incoming.external_id) {
            pushError(rowNumber, 'Missing form ID - row skipped')
            summary.skipped += 1
            continue
        }
        if (seenExternalIds.has(incoming.external_id)) {
            pushError(rowNumber, `Duplicate form ID "${incoming.external_id}" in this file - row skipped`)
            summary.skipped += 1
            continue
        }
        seenExternalIds.add(incoming.external_id)

        if (!incoming.title && incoming.content.length === 0) {
            pushError(rowNumber, 'Row has neither a title nor form content - row skipped')
            summary.skipped += 1
            continue
        }

        const existing = existingByExternalId.get(incoming.external_id) || null
        const resolvedPatientId = resolvePatientId(patientIndexes, incoming, normalizedSource)

        const next = {
            ...incoming,
            // Never blank out a manually linked patient with an unresolved import.
            patient_id: resolvedPatientId ?? existing?.patient_id ?? null,
            metadata: mergeFormMetadata(existing?.metadata, incoming.metadata),
        }

        if (next.patient_id) summary.linked += 1

        const changes = existing ? diffFormFields(existing, next) : []

        if (!existing) {
            if (!dryRun) {
                await insertForm(connection, domain, next)
            }
            summary.inserted += 1
        } else if (changes.length === 0) {
            summary.unchanged += 1
        } else {
            if (!dryRun) {
                await updateForm(connection, existing.id, changes)
            }
            summary.updated += 1
        }

        // Withdrawn submissions stay on the record but must not shape intake.
        if (next.patient_id && next.archived !== true) {
            const current = patientMetadata.get(next.patient_id)
            if (current) {
                const merged = applyFormAnswersToPatientMetadata(current, {
                    answers: next.answers,
                    labelledAnswers: next.labelled_answers,
                    form: {
                        externalId: next.external_id,
                        title: next.title,
                        submittedAt: next.submitted_at,
                    },
                    source: normalizedSource,
                })

                if (merged.changed) {
                    patientMetadata.set(next.patient_id, merged.metadata)
                    patientsToWrite.set(next.patient_id, merged.metadata)
                }
            }
        }
    }

    if (!dryRun && patientsToWrite.size > 0) {
        summary.enriched = await updatePatientMetadata(connection, domain, patientsToWrite)
    } else {
        summary.enriched = patientsToWrite.size
    }

    return summary
}
