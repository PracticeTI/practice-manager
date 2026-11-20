// CSV import pipeline for the Appointments entity.
//
// Import is idempotent: the external system's appointment id (stored in
// `external_id`) is the natural key, scoped by domain + external source, so
// re-importing the same file updates only the rows that actually changed.
// Nothing in this module touches the database unless the caller asks it to;
// routes pass a live connection in and get a summary back.

import {
    APPOINTMENT_COLUMN_KEYS,
    MAX_IMPORT_ROWS,
    cleanString,
    diffAppointmentFields,
    mapCsvRowToAppointment,
    normalizeAppointmentRow,
    parseAppointmentCsv,
    timestampExpr,
} from '@/lib/appointments'
import { deriveAppointmentStatus } from '@/lib/scheduling'

const MAX_REPORTED_ERRORS = 50

// Row-level failures that should skip the row instead of aborting the whole
// import: unique violations, check violations, and the practitioner overlap
// exclusion constraint.
function isSkippableRowError(error) {
    return ['23P01', '23505', '23514', '23502'].includes(error?.code)
}

function buildExistingSelect(dbType) {
    const where = 'domain = $1 AND external_source = $2'

    return `
        SELECT id, external_id, external_source, patient_id, patient_name,
               external_patient_id, practitioner, external_practitioner_id,
               service, external_service_id, location, external_location_id,
               ${timestampExpr(dbType, 'starts_at')} AS starts_at,
               ${timestampExpr(dbType, 'ends_at')} AS ends_at,
               progress_note_status, patient_status, unavailable_block,
               is_group, is_repeating, repeating_rule, max_patients,
               price, unit, tax_type, tax_rate, notes, archived, metadata,
               appointment_status, booking_source
        FROM appointments
        WHERE ${where}
    `
}

async function runSelect(connection, dbType, sql, params) {
    const result = await connection.query(sql, params)
    return result.rows || []
}

function normalizeNameKey(value) {
    return cleanString(value).toLowerCase().replace(/\s+/g, ' ')
}

// The source export often decorates the patient name with an external
// reference ("Belinda Gauci - 431580664"). Index both the full and the base
// form so imported rows still resolve to a local patient.
function patientNameKeys(value) {
    const full = normalizeNameKey(value)
    if (!full) return []
    const base = normalizeNameKey(full.split(' - ')[0])
    return base && base !== full ? [full, base] : [full]
}

function buildPatientNameIndex(rows) {
    const candidates = new Map()

    rows.forEach((row) => {
        const id = Number.parseInt(String(row?.id ?? ''), 10)
        if (!Number.isFinite(id)) return

        patientNameKeys(row?.patient_name).forEach((key) => {
            const bucket = candidates.get(key)
            if (!bucket) {
                candidates.set(key, new Set([id]))
            } else {
                bucket.add(id)
            }
        })
    })

    // Ambiguous names are dropped rather than guessed at.
    const resolved = new Map()
    candidates.forEach((ids, key) => {
        if (ids.size === 1) {
            resolved.set(key, [...ids][0])
        }
    })
    return resolved
}

async function loadPatientNameIndex(connection, dbType, domain) {
    try {
        const rows = await runSelect(
            connection,
            dbType,
            'SELECT id, patient_name FROM patients WHERE domain = $1',
            [domain]
        )
        return buildPatientNameIndex(rows)
    } catch {
        // Patients are optional for this feature; a missing table or column
        // just means imported appointments are not linked automatically.
        return new Map()
    }
}

function resolvePatientId(nameIndex, appointment) {
    for (const key of patientNameKeys(appointment?.patient_name)) {
        const id = nameIndex.get(key)
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

async function insertAppointment(connection, dbType, domain, fields) {
    const keys = ['domain']
    const values = [domain]

    APPOINTMENT_COLUMN_KEYS.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(fields, key)) return
        keys.push(key)
        values.push(serializeValue(key, fields[key]))
    })

    // Native scheduling defaults. Imported rows are marked as such and receive
    // the lifecycle status implied by the source system's patient status.
    keys.push('booking_source', 'appointment_status')
    values.push('import', deriveAppointmentStatus({ patientStatus: fields.patient_status }))

    const placeholders = keys.map((_key, index) => `$${index + 1}`)
    const result = await connection.query(
        `INSERT INTO appointments (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING id`,
        values
    )
    return result.rows?.[0]?.id ?? null
}

async function updateAppointment(connection, dbType, id, changes) {
    if (changes.length === 0) return

    const values = changes.map((change) => serializeValue(change.key, change.value))

    const setClauses = changes.map((change, index) => `${change.key} = $${index + 1}`)
    await connection.query(
        `UPDATE appointments SET ${setClauses.join(', ')}, updated_at = NOW()
         WHERE id = $${values.length + 1}`,
        [...values, id]
    )
}

/**
 * Import appointment rows from a CSV document.
 *
 * @returns {Promise<object>} summary: { total, inserted, updated, unchanged,
 *   skipped, errors, unknownHeaders, dryRun }
 */
export async function importAppointmentsFromCsv(connection, dbType, {
    domain,
    csvText,
    source = 'splose',
    dryRun = false,
} = {}) {
    const errors = []
    const pushError = (row, message) => {
        if (errors.length < MAX_REPORTED_ERRORS) errors.push({ row, message })
    }

    const { records, unknownHeaders, rowCount } = parseAppointmentCsv(csvText)
    const summary = {
        total: rowCount,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        skipped: 0,
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

    const existingSelect = buildExistingSelect(dbType)
    const existingRows = await runSelect(connection, dbType, existingSelect, [domain, normalizedSource])

    const existingByExternalId = new Map()
    existingRows.forEach((row) => {
        const key = cleanString(row?.external_id)
        if (key) existingByExternalId.set(key, normalizeAppointmentRow(row))
    })

    const patientNameIndex = await loadPatientNameIndex(connection, dbType, domain)

    for (const { rowNumber, raw } of records) {
        const incoming = mapCsvRowToAppointment(raw, { source: normalizedSource })

        if (!incoming.external_id) {
            pushError(rowNumber, 'Missing appointment ID - row skipped')
            summary.skipped += 1
            continue
        }
        if (!incoming.starts_at) {
            pushError(rowNumber, `Unreadable start time "${cleanString(raw?.starts_at)}" - row skipped`)
            summary.skipped += 1
            continue
        }

        const existing = existingByExternalId.get(incoming.external_id) || null
        const resolvedPatientId = resolvePatientId(patientNameIndex, incoming)

        const next = {
            ...incoming,
            // Never blank out a manually linked patient with an unresolved import.
            patient_id: resolvedPatientId ?? existing?.patient_id ?? null,
            metadata: existing?.metadata && incoming.metadata
                ? { ...existing.metadata, ...incoming.metadata }
                : incoming.metadata ?? existing?.metadata ?? null,
        }

        if (!existing) {
            try {
                if (!dryRun) {
                    await insertAppointment(connection, dbType, domain, next)
                }
                summary.inserted += 1
            } catch (error) {
                if (!isSkippableRowError(error)) throw error
                pushError(rowNumber, error.message)
                summary.skipped += 1
            }
            continue
        }

        const changes = diffAppointmentFields(existing, next)

        // The source system's patient status is authoritative until a human
        // moves the appointment off the default `confirmed` state.
        if (existing?.appointment_status === 'confirmed') {
            const derivedStatus = deriveAppointmentStatus({ patientStatus: next.patient_status })
            if (derivedStatus !== 'confirmed') {
                changes.push({ key: 'appointment_status', value: derivedStatus })
            }
        }

        if (changes.length === 0) {
            summary.unchanged += 1
            continue
        }

        if (!dryRun) {
            try {
                await updateAppointment(connection, dbType, existing.id, changes)
            } catch (error) {
                if (!isSkippableRowError(error)) throw error
                pushError(rowNumber, error.message)
                summary.skipped += 1
                continue
            }
        }
        summary.updated += 1
    }

    return summary
}
