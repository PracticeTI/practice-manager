// CSV import pipeline for the patient "Cases" entity.
//
// Import is idempotent: the external system's case id (stored in `external_id`)
// is the natural key, scoped by domain + external source, so re-importing the
// same file updates only the rows that actually changed.
//
// A case always belongs to a patient, so a row whose patient cannot be matched
// is skipped and reported rather than inserted against the wrong record. The
// upstream "Used" figure is recorded as a single imported case_usage entry so
// the allocation/utilisation figures on the Cases screens match the export.
//
// Nothing in this module touches the database unless the caller asks it to;
// routes pass a live connection in and get a summary back.

import {
    CASE_COLUMN_KEYS,
    DEFAULT_EXTERNAL_SOURCE,
    MAX_IMPORT_ROWS,
    cleanString,
    diffCaseFields,
    mapCsvRowToCase,
    mergeCaseMetadata,
    parseCaseCsv,
} from '@/lib/patientCases'

const MAX_REPORTED_ERRORS = 50

// Marks the case_usage row that carries the upstream "Used" figure, so a repeat
// import updates it in place instead of stacking another entry.
const IMPORTED_USAGE_FIELD = 'importedFrom'

function buildExistingSelect() {
    return `
        SELECT id, patient_id, external_id, external_source, external_patient_id,
               case_number, status, case_type, total_allocation, practitioner,
               to_char(issue_date, 'YYYY-MM-DD') AS issue_date,
               to_char(expiry_date, 'YYYY-MM-DD') AS expiry_date,
               referral_contact, referral_period, notes, metadata
        FROM patient_cases
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
            const source = cleanString(row?.external_source).toLowerCase() || DEFAULT_EXTERNAL_SOURCE
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
        // A missing patients table or column just means nothing can be linked.
        return []
    }
}

function resolvePatientId(indexes, record, source) {
    const externalId = cleanString(record?.external_patient_id)
    if (externalId) {
        const linked = indexes.byExternalId.get(`${source}:${externalId}`)
        if (linked) return linked
    }

    for (const key of patientNameKeys(record?.patient_name)) {
        const id = indexes.byName.get(key)
        if (id) return id
    }

    return null
}

function serializeValue(key, value) {
    if (key === 'metadata') {
        return value === null || value === undefined ? null : JSON.stringify(value)
    }
    return value === undefined ? null : value
}

async function insertCase(connection, domain, fields) {
    const keys = ['domain', 'patient_id']
    const values = [domain, fields.patient_id]

    CASE_COLUMN_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) return
        keys.push(key)
        values.push(serializeValue(key, fields[key]))
    })

    const placeholders = keys.map((_key, index) => `$${index + 1}`)
    const result = await connection.query(
        `INSERT INTO patient_cases (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        values
    )
    return result.rows?.[0]?.id ?? null
}

async function updateCase(connection, id, changes) {
    if (changes.length === 0) return

    const values = changes.map((change) => serializeValue(change.key, change.value))
    const setClauses = changes.map((change, index) => `${change.key} = $${index + 1}`)

    await connection.query(
        `UPDATE patient_cases SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length + 1}`,
        [...values, id]
    )
}

function todayIsoDate() {
    return new Date().toISOString().slice(0, 10)
}

async function findImportedUsage(connection, domain, caseId, source) {
    const rows = await runSelect(
        connection,
        `SELECT id, quantity, to_char(entry_date, 'YYYY-MM-DD') AS entry_date, description
         FROM case_usage
         WHERE domain = $1 AND case_id = $2 AND metadata->>'${IMPORTED_USAGE_FIELD}' = $3
         LIMIT 1`,
        [domain, caseId, source]
    )
    return rows[0] || null
}

/**
 * Mirror the upstream "Used" figure into case_usage. A used value of zero
 * removes any entry a previous import created, so the local ledger always
 * reflects the export.
 *
 * @returns {Promise<'created'|'updated'|'removed'|'unchanged'|null>}
 */
async function syncImportedUsage(connection, domain, caseRow, record, { source, dryRun }) {
    const used = Number(record?.used_quantity || 0)
    const existing = await findImportedUsage(connection, domain, caseRow.id, source)

    if (!(used > 0)) {
        if (!existing) return null
        if (!dryRun) {
            await connection.query('DELETE FROM case_usage WHERE id = $1 AND domain = $2', [existing.id, domain])
        }
        return 'removed'
    }

    const entryDate = record?.issue_date || todayIsoDate()
    const description = `Imported usage total (${source})`.slice(0, 255)

    if (!existing) {
        if (!dryRun) {
            await connection.query(
                `INSERT INTO case_usage (domain, case_id, patient_id, entry_date, description, quantity, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
                [
                    domain,
                    caseRow.id,
                    caseRow.patient_id,
                    entryDate,
                    description,
                    used,
                    JSON.stringify({
                        [IMPORTED_USAGE_FIELD]: source,
                        externalId: record?.external_id || null,
                        imported: true,
                    }),
                ]
            )
        }
        return 'created'
    }

    const unchanged = Number(existing.quantity) === used
        && cleanString(existing.entry_date) === entryDate
        && cleanString(existing.description) === description
    if (unchanged) return 'unchanged'

    if (!dryRun) {
        await connection.query(
            `UPDATE case_usage SET entry_date = $1, description = $2, quantity = $3, updated_at = NOW()
             WHERE id = $4 AND domain = $5`,
            [entryDate, description, used, existing.id, domain]
        )
    }
    return 'updated'
}

/**
 * Import patient cases from a CSV document.
 *
 * @returns {Promise<object>} summary: { total, inserted, updated, unchanged,
 *   skipped, usageCreated, usageUpdated, usageRemoved, errors, unknownHeaders,
 *   dryRun }
 */
export async function importCasesFromCsv(connection, {
    domain,
    csvText,
    source = DEFAULT_EXTERNAL_SOURCE,
    dryRun = false,
} = {}) {
    const errors = []
    const pushError = (row, message) => {
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, message })
    }

    const { records, unknownHeaders, rowCount } = parseCaseCsv(csvText)
    const summary = {
        total: rowCount,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
        usageCreated: 0,
        usageUpdated: 0,
        usageRemoved: 0,
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

    const existingRows = await runSelect(connection, buildExistingSelect(), [domain, normalizedSource])
    const existingByExternalId = new Map()
    existingRows.forEach((row) => {
        const key = cleanString(row?.external_id)
        if (key) existingByExternalId.set(key, row)
    })

    const patientRows = await loadPatients(connection, domain)
    const patientIndexes = buildPatientIndexes(patientRows)
    const seenExternalIds = new Set()

    for (const { rowNumber, raw } of records) {
        const incoming = mapCsvRowToCase(raw, { source: normalizedSource })

        if (!incoming.external_id) {
            pushError(rowNumber, 'Missing case ID - row skipped')
            summary.skipped += 1
            continue
        }
        if (seenExternalIds.has(incoming.external_id)) {
            pushError(rowNumber, `Duplicate case ID "${incoming.external_id}" in this file - row skipped`)
            summary.skipped += 1
            continue
        }
        seenExternalIds.add(incoming.external_id)

        const existing = existingByExternalId.get(incoming.external_id) || null
        const resolvedPatientId = resolvePatientId(patientIndexes, incoming, normalizedSource)

        // A case cannot exist without its patient: skip rather than guess.
        if (!resolvedPatientId && !existing) {
            pushError(
                rowNumber,
                `No patient matched "${incoming.patient_name || incoming.external_patient_id || 'unknown'}" - row skipped`
            )
            summary.skipped += 1
            continue
        }

        const next = {
            ...incoming,
            // Never move an already imported case onto a different patient
            // because a name lookup failed.
            patient_id: resolvedPatientId ?? existing?.patient_id ?? null,
            metadata: mergeCaseMetadata(existing?.metadata, incoming.metadata),
        }

        if (!existing) {
            // A brand new case has no stored id yet, so a dry run reports the
            // usage entry as a creation (which is what it would be).
            const target = { ...next, id: null }
            if (!dryRun) {
                target.id = await insertCase(connection, domain, next)
            }

            const usageResult = await syncImportedUsage(
                connection, domain, target, incoming, { source: normalizedSource, dryRun }
            )
            if (usageResult === 'created') summary.usageCreated += 1
            summary.inserted += 1
            continue
        }

        const changes = diffCaseFields(existing, next)
        if (changes.length > 0) {
            if (!dryRun) {
                await updateCase(connection, existing.id, changes)
            }
            summary.updated += 1
        } else {
            summary.unchanged += 1
        }

        const usageResult = await syncImportedUsage(
            connection, domain, existing, incoming, { source: normalizedSource, dryRun }
        )
        if (usageResult === 'created') summary.usageCreated += 1
        else if (usageResult === 'updated') summary.usageUpdated += 1
        else if (usageResult === 'removed') summary.usageRemoved += 1
    }

    return summary
}
