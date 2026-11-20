// Shared helpers for the Appointments entity.
//
// Appointments are imported from an external practice-management system (a
// Splose "appointments" CSV export is the reference format) and can also be
// created/edited by hand in the admin UI. The external system's primary key is
// stored in `external_id`, so a repeat import updates the existing row instead
// of duplicating it.
//
// Kept DB-agnostic and free of Node-only APIs so the CSV parser can also run in
// the browser for import previews.

import { normalizeCsvHeader, parseCsv } from './csv.js'
import { APPOINTMENT_STATUSES, CONFIRMATION_STATUSES, DEFAULT_TIMEZONE, isAppointmentStatus, normalizeAppointmentStatus, normalizeConfirmationStatus } from './scheduling.js'

export const DEFAULT_EXTERNAL_SOURCE = 'splose'

export const PROGRESS_NOTE_STATUSES = ['draft', 'finalised', 'no status']

export const MAX_IMPORT_ROWS = 5000

// ---------------------------------------------------------------------------
// Small shared coercions (mirrors the helpers used by other feature libs)
// ---------------------------------------------------------------------------
export function parseMetadataValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'object') return value
    if (typeof value !== 'string') return null

    try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

export function toBool(value) {
    return value === true || value === 1 || value === '1' || value === 't' || value === 'true'
}

export function toFinite(value) {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
}

export function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function cleanNullableString(value, maxLength = 255) {
    const text = cleanString(value)
    return text ? text.slice(0, maxLength) : null
}

export function cleanOptionalText(value) {
    return cleanString(value) || null
}

export function validateId(rawId) {
    const id = Number.parseInt(String(rawId || ''), 10)
    return Number.isFinite(id) && id > 0 ? id : null
}

export async function resolveRouteParams(params) {
    if (params && typeof params.then === 'function') {
        return await params
    }
    return params || {}
}

function formatTimestampValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString()
    }
    return parseTimestamp(value)
}

// Accepts ISO-8601 with or without a zone, plus the `YYYY-MM-DD HH:MM:SS` form
// some exporters emit. Zoneless values are treated as UTC so re-imports are
// stable regardless of the server timezone.
export function parseTimestamp(value) {
    const text = cleanString(value)
    if (!text) return null

    let normalized = text
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(normalized)) {
        normalized = `${normalized.slice(0, 10)}T${normalized.slice(11)}`
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(normalized)) {
        normalized = `${normalized}Z`
    }

    const date = new Date(normalized)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

// Timestamps are handed to the DB as UTC ISO strings (PostgreSQL receives the
// ISO string and casts it to TIMESTAMPTZ).
export function toDbTimestamp(isoValue, dbType) {
    const iso = parseTimestamp(isoValue)
    if (!iso) return null
    return iso
}

function parseOptionalNumber(value) {
    const text = cleanString(value)
    if (text === '') return null
    const number = Number(text)
    return Number.isFinite(number) ? number : null
}

function parseOptionalInteger(value) {
    const number = parseOptionalNumber(value)
    return number === null ? null : Math.trunc(number)
}

function parseOptionalId(value) {
    const number = parseOptionalInteger(value)
    return number !== null && number > 0 ? number : null
}

function parseYesNo(value, fallback = false) {
    const text = cleanString(value).toLowerCase()
    if (text === '') return fallback
    return text === 'yes' || text === 'true' || text === '1' || text === 'y'
}

// Splose exports repeat the service name inside the parentheses of the same
// label ("Assessment consultation (Assessment consultation)"). Collapse that
// exact duplication so the UI shows something readable.
function cleanServiceName(value) {
    const text = cleanString(value)
    if (!text) return null

    const match = /^(.*?)\s*\((.*)\)$/.exec(text)
    if (match) {
        const outer = match[1].trim()
        const inner = match[2].trim()
        if (outer && outer.toLowerCase() === inner.toLowerCase()) {
            return outer.slice(0, 255)
        }
    }
    return text.slice(0, 255)
}

// Human-friendly label for the progress-note status filter/columns.
export function formatStatusLabel(value) {
    const text = cleanString(value).toLowerCase()
    if (!text) return 'No status'
    return text.charAt(0).toUpperCase() + text.slice(1)
}

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

export function timestampExpr(dbType, column) {
    return `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

function buildAppointmentColumns(dbType) {
    return `
        a.id, a.domain, a.external_id, a.external_source, a.patient_id,
        a.patient_name, a.external_patient_id, a.practitioner,
        a.external_practitioner_id, a.service, a.external_service_id,
        a.location, a.external_location_id,
        ${timestampExpr(dbType, 'a.starts_at')} AS starts_at,
        ${timestampExpr(dbType, 'a.ends_at')} AS ends_at,
        a.progress_note_status, a.patient_status, a.unavailable_block,
        a.is_group, a.is_repeating, a.repeating_rule, a.max_patients,
        a.price, a.unit, a.tax_type, a.tax_rate, a.notes, a.archived,
        a.practitioner_id, a.location_id, a.service_id, a.case_id,
        a.appointment_status, a.booking_source, a.booked_by,
        ${timestampExpr(dbType, 'a.arrived_at')} AS arrived_at,
        ${timestampExpr(dbType, 'a.completed_at')} AS completed_at,
        ${timestampExpr(dbType, 'a.cancelled_at')} AS cancelled_at,
        a.cancellation_reason, a.telehealth_url, a.recurrence_id, a.timezone,
        a.confirmation_status, ${timestampExpr(dbType, 'a.confirmed_at')} AS confirmed_at,
        a.confirmation_channel,
        a.metadata, a.created_at, a.updated_at
    `
}

export function buildAppointmentSelect(dbType) {
    return `
        SELECT ${buildAppointmentColumns(dbType)},
               pt.patient_name AS linked_patient_name
        FROM appointments a
        LEFT JOIN patients pt ON pt.id = a.patient_id AND pt.domain = a.domain
    `
}

export function normalizeAppointmentRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
        unavailable_block: toBool(row.unavailable_block),
        is_group: toBool(row.is_group),
        is_repeating: toBool(row.is_repeating),
        archived: toBool(row.archived),
        starts_at: formatTimestampValue(row.starts_at),
        ends_at: formatTimestampValue(row.ends_at),
        arrived_at: formatTimestampValue(row.arrived_at),
        completed_at: formatTimestampValue(row.completed_at),
        cancelled_at: formatTimestampValue(row.cancelled_at),
        confirmed_at: formatTimestampValue(row.confirmed_at),
        confirmation_status: CONFIRMATION_STATUSES.includes(row.confirmation_status)
            ? row.confirmation_status
            : 'pending',
        appointment_status: isAppointmentStatus(row.appointment_status) ? row.appointment_status : 'confirmed',
        practitioner_id: row.practitioner_id === null || row.practitioner_id === undefined
            ? null
            : parseOptionalInteger(row.practitioner_id),
        location_id: row.location_id === null || row.location_id === undefined
            ? null
            : parseOptionalInteger(row.location_id),
        service_id: row.service_id === null || row.service_id === undefined
            ? null
            : parseOptionalInteger(row.service_id),
        case_id: row.case_id === null || row.case_id === undefined
            ? null
            : parseOptionalInteger(row.case_id),
        recurrence_id: row.recurrence_id === null || row.recurrence_id === undefined
            ? null
            : parseOptionalInteger(row.recurrence_id),
        max_patients: row.max_patients === null || row.max_patients === undefined
            ? null
            : parseOptionalInteger(row.max_patients),
        price: row.price === null || row.price === undefined ? null : toFinite(row.price),
        tax_rate: row.tax_rate === null || row.tax_rate === undefined ? null : toFinite(row.tax_rate),
    }
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

// Maps both the raw Splose export headers and friendlier header names onto the
// canonical appointment field names. Keys are the output of `normalizeCsvHeader`,
// so the Splose "Patient(s)" / "Progress Note status(s)" style suffixes have
// already been reduced to their base form.
const CSV_HEADER_ALIASES = new Map([
    ['id', 'external_id'],
    ['appointment id', 'external_id'],
    ['external id', 'external_id'],
    ['start', 'starts_at'],
    ['starts at', 'starts_at'],
    ['start time', 'starts_at'],
    ['end', 'ends_at'],
    ['ends at', 'ends_at'],
    ['end time', 'ends_at'],
    ['practitioner', 'practitioner'],
    ['practitioner id', 'external_practitioner_id'],
    ['service', 'service'],
    ['service id', 'external_service_id'],
    ['location', 'location'],
    ['location id', 'external_location_id'],
    ['unavailable block', 'unavailable_block'],
    ['repeating', 'is_repeating'],
    ['repeating rule', 'repeating_rule'],
    ['price', 'price'],
    ['unit', 'unit'],
    ['tax type', 'tax_type'],
    ['tax rate', 'tax_rate'],
    ['note', 'notes'],
    ['notes', 'notes'],
    ['group appointment', 'is_group'],
    ['max patients', 'max_patients'],
    ['patient id', 'external_patient_id'],
    ['patient', 'patient_name'],
    ['patient status', 'patient_status'],
    ['progress note id', 'external_progress_note_id'],
    ['progress note status', 'progress_note_status'],
    ['patient form id', 'external_patient_form_id'],
    ['invoice id', 'external_invoice_id'],
    ['case id', 'external_case_id'],
    ['archived', 'archived'],
])

function lookupHeaderAlias(rawHeader) {
    return CSV_HEADER_ALIASES.get(normalizeCsvHeader(rawHeader)) || null
}

// Columns that only exist to preserve provenance for other external entities;
// they are kept in `metadata` rather than becoming their own column.
const PASSTHROUGH_FIELDS = {
    external_progress_note_id: 'externalProgressNoteId',
    external_patient_form_id: 'externalPatientFormId',
    external_invoice_id: 'externalInvoiceId',
    external_case_id: 'externalCaseId',
}

/**
 * Parse a CSV document into appointment-shaped records.
 * Returns { records, unknownHeaders, rowCount }.
 */
export function parseAppointmentCsv(text) {
    const rows = parseCsv(text)
    if (rows.length === 0) {
        return { records: [], unknownHeaders: [], rowCount: 0 }
    }

    const [headerRow, ...dataRows] = rows
    const columnMap = []
    const unknownHeaders = []
    const seenHeaders = new Set()

    headerRow.forEach((rawHeader) => {
        const canonicalMatch = lookupHeaderAlias(rawHeader)
        columnMap.push(canonicalMatch || null)
        const label = cleanString(rawHeader)
        if (!canonicalMatch && label && !seenHeaders.has(label)) {
            seenHeaders.add(label)
            unknownHeaders.push(label)
        }
    })

    const records = dataRows.map((cells, index) => {
        const raw = {}
        columnMap.forEach((canonicalHeader, columnIndex) => {
            if (!canonicalHeader) return
            raw[canonicalHeader] = cells[columnIndex]
        })
        return { rowNumber: index + 2, raw }
    })

    return { records, unknownHeaders, rowCount: dataRows.length }
}

/**
 * Turn one parsed CSV row into the appointment field shape used by the
 * create/update paths (the same shape `parseAppointmentFields` returns).
 */
export function mapCsvRowToAppointment(raw, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const metadata = {}
    Object.entries(PASSTHROUGH_FIELDS).forEach(([canonicalHeader, metadataKey]) => {
        const value = cleanNullableString(raw?.[canonicalHeader], 120)
        if (value) metadata[metadataKey] = value
    })

    const startsAt = parseTimestamp(raw?.starts_at)
    const endsAt = parseTimestamp(raw?.ends_at)

    return {
        external_id: cleanNullableString(raw?.external_id, 120),
        external_source: cleanString(source).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE,
        external_patient_id: cleanNullableString(raw?.external_patient_id, 120),
        patient_name: cleanNullableString(raw?.patient_name, 255),
        practitioner: cleanNullableString(raw?.practitioner, 255),
        external_practitioner_id: cleanNullableString(raw?.external_practitioner_id, 120),
        service: cleanServiceName(raw?.service),
        external_service_id: cleanNullableString(raw?.external_service_id, 120),
        location: cleanNullableString(raw?.location, 255),
        external_location_id: cleanNullableString(raw?.external_location_id, 120),
        starts_at: startsAt,
        ends_at: endsAt,
        progress_note_status: cleanNullableString(raw?.progress_note_status, 32),
        patient_status: cleanNullableString(raw?.patient_status, 32),
        unavailable_block: parseYesNo(raw?.unavailable_block),
        is_group: parseYesNo(raw?.is_group),
        is_repeating: parseYesNo(raw?.is_repeating),
        repeating_rule: cleanNullableString(raw?.repeating_rule, 255),
        max_patients: parseOptionalInteger(raw?.max_patients),
        price: parseOptionalNumber(raw?.price),
        unit: cleanNullableString(raw?.unit, 32),
        tax_type: cleanNullableString(raw?.tax_type, 64),
        tax_rate: parseOptionalNumber(raw?.tax_rate),
        notes: cleanOptionalText(raw?.notes),
        archived: parseYesNo(raw?.archived),
        metadata: Object.keys(metadata).length > 0 ? metadata : null,
    }
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

const MUTABLE_FIELD_VALIDATORS = {
    external_id: (value) => cleanNullableString(value, 120),
    external_source: (value) => cleanString(value).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE,
    patient_id: (value) => parseOptionalInteger(value),
    patient_name: (value) => cleanNullableString(value, 255),
    external_patient_id: (value) => cleanNullableString(value, 120),
    practitioner: (value) => cleanNullableString(value, 255),
    external_practitioner_id: (value) => cleanNullableString(value, 120),
    service: (value) => cleanServiceName(value),
    external_service_id: (value) => cleanNullableString(value, 120),
    location: (value) => cleanNullableString(value, 255),
    external_location_id: (value) => cleanNullableString(value, 120),
    starts_at: (value) => parseTimestamp(value),
    ends_at: (value) => parseTimestamp(value),
    progress_note_status: (value) => cleanNullableString(value, 32),
    patient_status: (value) => cleanNullableString(value, 32),
    unavailable_block: (value) => toBool(value),
    is_group: (value) => toBool(value),
    is_repeating: (value) => toBool(value),
    repeating_rule: (value) => cleanNullableString(value, 255),
    max_patients: (value) => parseOptionalInteger(value),
    price: (value) => parseOptionalNumber(value),
    unit: (value) => cleanNullableString(value, 32),
    tax_type: (value) => cleanNullableString(value, 64),
    tax_rate: (value) => parseOptionalNumber(value),
    notes: (value) => cleanOptionalText(value),
    archived: (value) => toBool(value),
    practitioner_id: (value) => parseOptionalId(value),
    location_id: (value) => parseOptionalId(value),
    service_id: (value) => parseOptionalId(value),
    case_id: (value) => parseOptionalId(value),
    booking_source: (value) => cleanNullableString(value, 32) || 'manual',
    booked_by: (value) => cleanNullableString(value, 255),
    arrived_at: (value) => parseTimestamp(value),
    completed_at: (value) => parseTimestamp(value),
    cancelled_at: (value) => parseTimestamp(value),
    cancellation_reason: (value) => cleanOptionalText(value),
    telehealth_url: (value) => cleanNullableString(value, 2048),
    recurrence_id: (value) => parseOptionalId(value),
    timezone: (value) => cleanNullableString(value, 100) || DEFAULT_TIMEZONE,
    confirmed_at: (value) => parseTimestamp(value),
    confirmation_channel: (value) => cleanNullableString(value, 32),
}

/**
 * Validate + normalise the mutable appointment fields present in a payload.
 * Returns { updates, errors } where each update is { key, value }.
 */
export function resolveAppointmentUpdates(payload) {
    const updates = []
    const errors = []

    Object.keys(MUTABLE_FIELD_VALIDATORS).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(payload || {}, key)) return
        updates.push({ key, value: MUTABLE_FIELD_VALIDATORS[key](payload[key]) })
    })

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'appointment_status')) {
        const status = normalizeAppointmentStatus(payload.appointment_status)
        if (!status) {
            errors.push(`appointment_status must be one of: ${APPOINTMENT_STATUSES.join(', ')}`)
        } else {
            updates.push({ key: 'appointment_status', value: status })
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'confirmation_status')) {
        const status = normalizeConfirmationStatus(payload.confirmation_status)
        if (!status) {
            errors.push(`confirmation_status must be one of: ${CONFIRMATION_STATUSES.join(', ')}`)
        } else {
            updates.push({ key: 'confirmation_status', value: status })
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload || {}, 'metadata')) {
        const metadata = payload.metadata
        if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
            errors.push('metadata must be an object or null')
        } else {
            updates.push({ key: 'metadata', value: metadata })
        }
    }

    return { updates, errors }
}

export const APPOINTMENT_COLUMN_KEYS = [
    'external_id',
    'external_source',
    'patient_id',
    'patient_name',
    'external_patient_id',
    'practitioner',
    'external_practitioner_id',
    'service',
    'external_service_id',
    'location',
    'external_location_id',
    'starts_at',
    'ends_at',
    'progress_note_status',
    'patient_status',
    'unavailable_block',
    'is_group',
    'is_repeating',
    'repeating_rule',
    'max_patients',
    'price',
    'unit',
    'tax_type',
    'tax_rate',
    'notes',
    'archived',
    'metadata',
]

/**
 * Compare an incoming appointment field set with a stored row. Only changed
 * fields are returned, so a repeat import does not touch unchanged rows (and
 * therefore does not bump updated_at).
 */
export function diffAppointmentFields(existing, incoming) {
    const changed = []

    APPOINTMENT_COLUMN_KEYS.forEach((key) => {
        const stored = normalizeComparableValue(key, existing?.[key])
        const next = normalizeComparableValue(key, incoming?.[key])
        if (stored !== next) {
            changed.push({ key, value: incoming?.[key] === undefined ? null : incoming[key] })
        }
    })

    return changed
}

function normalizeComparableValue(key, value) {
    if (key === 'metadata') {
        const parsed = parseMetadataValue(value)
        return parsed ? JSON.stringify(sortKeys(parsed)) : ''
    }
    if (key === 'starts_at' || key === 'ends_at') {
        const iso = parseTimestamp(value)
        return iso || ''
    }
    if (key === 'patient_id' || key === 'max_patients') {
        const number = parseOptionalInteger(value)
        return number === null ? '' : String(number)
    }
    if (key === 'price' || key === 'tax_rate') {
        const number = parseOptionalNumber(value)
        return number === null ? '' : String(number)
    }
    if (key === 'unavailable_block' || key === 'is_group' || key === 'is_repeating' || key === 'archived') {
        return toBool(value) ? 'true' : 'false'
    }
    return cleanString(value)
}

function sortKeys(value) {
    if (Array.isArray(value)) return value.map(sortKeys)
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = sortKeys(value[key])
            return acc
        }, {})
    }
    return value
}
