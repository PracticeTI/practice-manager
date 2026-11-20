// Shared helpers for the patient "Cases" feature (funding/allocation tracking).
// Used by the /api/database/cases* route handlers. Kept DB-agnostic so the same
// validation & row normalisation logic works for PostgreSQL.
//
// The CSV mapping at the bottom of this file is what the case import uses. Like
// the other entity libs it is free of Node-only APIs (the parser comes from
// `./csv.js`), so the admin page can run the same mapping in the browser for an
// import preview.

import { normalizeCsvHeader, parseCsv } from './csv.js'

export const CASE_TYPES = new Set(['budget', 'hours', 'sessions'])
export const CASE_STATUSES = new Set(['open', 'closed'])

export const DEFAULT_EXTERNAL_SOURCE = 'splose'

// Upper bound on a single import, matching the other import features.
export const MAX_IMPORT_ROWS = 5000

// The reference export renders its date-only columns as instants pinned to
// local midnight ("2026-08-12T14:00:00.000Z" is 13 Aug 00:00 in Melbourne), so
// the calendar date has to be read in the practice time zone rather than UTC.
// Same convention as the note/form timestamp formatters.
export const CASE_EXPORT_TIME_ZONE = 'Australia/Melbourne'

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

function padTwo(value) {
    return String(value).padStart(2, '0')
}

// The driver may return DATE columns as JS Date objects; normalise them back to
// the YYYY-MM-DD string form PostgreSQL already returns via to_char().
export function formatDateValue(value) {
    if (value === null || value === undefined || value === '') return null
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return `${value.getFullYear()}-${padTwo(value.getMonth() + 1)}-${padTwo(value.getDate())}`
    }
    return String(value)
}

export function normalizeCaseRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
        disable_exceeding: toBool(row.disable_exceeding),
        is_expired: toBool(row.is_expired),
        total_allocation: toFinite(row.total_allocation),
        used_quantity: toFinite(row.used_quantity),
        issue_date: formatDateValue(row.issue_date),
        expiry_date: formatDateValue(row.expiry_date),
        referral_issue_date: formatDateValue(row.referral_issue_date),
    }
}

export function normalizeUsageRow(row) {
    if (!row || typeof row !== 'object') return row
    return {
        ...row,
        metadata: parseMetadataValue(row.metadata),
        quantity: toFinite(row.quantity),
        entry_date: formatDateValue(row.entry_date),
    }
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

export function parseDateOnly(value) {
    const text = cleanString(value)
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

export function parseNonNegativeNumber(value) {
    const text = cleanString(value)
    if (text === '') return 0
    const number = Number(text)
    return Number.isFinite(number) && number >= 0 ? number : 0
}

// Parses and validates the mutable case fields shared by create/update.
// Returns { value, error }. `case_number` is only validated here, never
// auto-generated (that happens in the create route).
export function parseCaseFields(payload) {
    const caseType = cleanString(payload?.case_type).toLowerCase()
    const status = cleanString(payload?.status).toLowerCase()

    if (caseType && !CASE_TYPES.has(caseType)) {
        return { value: null, error: 'case_type must be one of: budget, hours, sessions' }
    }
    if (status && !CASE_STATUSES.has(status)) {
        return { value: null, error: 'status must be one of: open, closed' }
    }

    return {
        value: {
            case_number: cleanNullableString(payload?.case_number, 120),
            status: status || 'open',
            case_type: caseType || 'budget',
            total_allocation: parseNonNegativeNumber(payload?.total_allocation),
            practitioner: cleanNullableString(payload?.practitioner, 255),
            issue_date: parseDateOnly(payload?.issue_date),
            expiry_date: parseDateOnly(payload?.expiry_date),
            disable_exceeding: toBool(payload?.disable_exceeding),
            referral_contact: cleanNullableString(payload?.referral_contact, 255),
            referral_issue_date: parseDateOnly(payload?.referral_issue_date),
            referral_period: cleanNullableString(payload?.referral_period, 120),
            notes: cleanOptionalText(payload?.notes),
            metadata: payload?.metadata === undefined ? null : payload?.metadata,
        },
        error: null,
    }
}

export async function patientExists(connection, dbType, patientId, domain) {
    if (!validateId(patientId) || !domain) return false

    const result = await connection.query(
        'SELECT id FROM patients WHERE id = $1 AND domain = $2 LIMIT 1',
        [patientId, domain]
    )
    return (result?.rowCount || 0) > 0
}

// Builds the SELECT fragment for the allocation "used" total and an expiry flag
// so callers get a consistent, ready-to-read case projection.
export function buildCaseTotalsSelect(dbType) {
    return {
        dateExpr: (column) => `to_char(${column}, 'YYYY-MM-DD')`,
        usedExpr: `COALESCE((SELECT SUM(cu.quantity) FROM case_usage cu WHERE cu.case_id = pc.id AND cu.domain = pc.domain), 0) AS used_quantity`,
        expiredExpr: `(pc.expiry_date IS NOT NULL AND pc.expiry_date < CURRENT_DATE) AS is_expired`,
    }
}

// ---------------------------------------------------------------------------
// CSV import mapping
// ---------------------------------------------------------------------------

// Columns written straight to patient_cases. `used_quantity` is deliberately
// absent: usage lives in case_usage as dated line items, so the importer records
// the upstream "Used" figure as a single imported usage entry instead.
export const CASE_COLUMN_KEYS = [
    'external_id',
    'external_source',
    'external_patient_id',
    'case_number',
    'status',
    'case_type',
    'total_allocation',
    'practitioner',
    'issue_date',
    'expiry_date',
    'referral_contact',
    'referral_period',
    'notes',
    'metadata',
]

// Maps both the raw export headers and friendlier header names onto canonical
// case field names. Keys are the output of `normalizeCsvHeader`, so the "(s)"
// suffix on "Appointment ID(s)" / "Support Activity ID(s)" is already gone.
const CSV_HEADER_ALIASES = new Map([
    ['id', 'external_id'],
    ['case id', 'external_id'],
    ['external id', 'external_id'],
    ['status', 'status'],
    ['case status', 'status'],
    ['case number', 'case_number'],
    ['case no', 'case_number'],
    ['case', 'case_number'],
    ['track type', 'case_type'],
    ['case type', 'case_type'],
    ['type', 'case_type'],
    ['used', 'used_quantity'],
    ['used quantity', 'used_quantity'],
    ['total', 'total_allocation'],
    ['allocation', 'total_allocation'],
    ['total allocation', 'total_allocation'],
    ['patient id', 'external_patient_id'],
    ['client id', 'external_patient_id'],
    ['patient name', 'patient_name'],
    ['client name', 'patient_name'],
    ['patient', 'patient_name'],
    ['referral contact name', 'referral_contact'],
    ['referral contact', 'referral_contact'],
    ['referrer', 'referral_contact'],
    ['referral period', 'referral_period'],
    ['issue date', 'issue_date'],
    ['start date', 'issue_date'],
    ['expiry date', 'expiry_date'],
    ['expiry', 'expiry_date'],
    ['notes', 'notes'],
    ['note', 'notes'],
    ['practitioner name', 'practitioner'],
    ['practitioner', 'practitioner'],
    ['archived', 'archived'],
    // Provenance columns: kept in `metadata`, never their own column.
    ['provider number', 'external_provider_id'],
    ['referral contact id', 'external_referral_contact_id'],
    ['practitioner id', 'external_practitioner_id'],
    ['appointment id', 'external_appointment_ids'],
    ['support activity id', 'external_support_activity_ids'],
    ['invoice recipient id', 'external_invoice_recipient_id'],
    ['invoice recipient name', 'invoice_recipient_name'],
    ['files', 'files'],
])

const PASSTHROUGH_FIELDS = {
    external_provider_id: 'providerNumber',
    external_referral_contact_id: 'externalReferralContactId',
    external_practitioner_id: 'externalPractitionerId',
    external_appointment_ids: 'externalAppointmentIds',
    external_support_activity_ids: 'externalSupportActivityIds',
    external_invoice_recipient_id: 'externalInvoiceRecipientId',
    invoice_recipient_name: 'invoiceRecipientName',
    files: 'files',
}

const PASSTHROUGH_MAX_LENGTH = {
    files: 500,
    external_appointment_ids: 500,
    external_support_activity_ids: 500,
}

const CASE_TYPE_ALIASES = new Map([
    ['budget', 'budget'],
    ['amount', 'budget'],
    ['dollar', 'budget'],
    ['dollars', 'budget'],
    ['money', 'budget'],
    ['value', 'budget'],
    ['hours', 'hours'],
    ['hour', 'hours'],
    ['hrs', 'hours'],
    ['sessions', 'sessions'],
    ['session', 'sessions'],
])

const CLOSED_STATUS_PREFIXES = ['closed', 'archived', 'inactive', 'cancelled', 'canceled', 'completed']

function lookupHeaderAlias(rawHeader) {
    return CSV_HEADER_ALIASES.get(normalizeCsvHeader(rawHeader)) || null
}

// Accepts ISO-8601 with or without a zone, the `YYYY-MM-DD HH:MM:SS` form some
// exporters emit, and a bare `YYYY-MM-DD`. Zoneless values are treated as UTC.
function parseExportInstant(value) {
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

/**
 * Read a date-only export column as a YYYY-MM-DD calendar date in the practice
 * time zone. Falls back to the UTC date part if the time zone is unavailable.
 */
export function parseExportDate(value, timeZone = CASE_EXPORT_TIME_ZONE) {
    const text = cleanString(value)
    if (!text) return null
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

    const iso = parseExportInstant(text)
    if (!iso) return null

    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date(iso))

        const lookup = {}
        parts.forEach((part) => {
            lookup[part.type] = part.value
        })
        if (lookup.year && lookup.month && lookup.day) {
            return `${lookup.year}-${lookup.month}-${lookup.day}`
        }
    } catch {
        // Unknown time zone in this runtime - fall through to UTC.
    }

    return iso.slice(0, 10)
}

// The export can render money as "$1,200.00"; strip the decoration before
// coercing so a budget case is not silently imported as zero.
function parseImportNumber(value) {
    const text = cleanString(value).replace(/[^0-9.\-]/g, '')
    return parseNonNegativeNumber(text)
}

function mapCaseType(value) {
    const key = cleanString(value).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
    return CASE_TYPE_ALIASES.get(key) || 'budget'
}

function mapCaseStatus(value) {
    const text = cleanString(value).toLowerCase()
    if (!text) return 'open'
    return CLOSED_STATUS_PREFIXES.some((prefix) => text.startsWith(prefix)) ? 'closed' : 'open'
}

// The export spells booleans out ("Yes" / "No"), which `toBool` does not cover.
function parseYesNoCell(value) {
    const text = cleanString(value).toLowerCase()
    return text === 'yes' || text === 'y' || text === 'true' || text === '1'
}

/**
 * Parse a CSV document into case-shaped records.
 * Returns { records, unknownHeaders, rowCount }.
 */
export function parseCaseCsv(text) {
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
 * Normalise the raw CSV cells into the canonical case record shape.
 */
export function normalizeCaseRecord(raw) {
    const archived = parseYesNoCell(raw?.archived)
    const status = mapCaseStatus(raw?.status)

    return {
        external_id: cleanNullableString(raw?.external_id, 120),
        external_source: cleanNullableString(raw?.external_source, 64),
        external_patient_id: cleanNullableString(raw?.external_patient_id, 120),
        patient_name: cleanNullableString(raw?.patient_name, 255),
        case_number: cleanNullableString(raw?.case_number, 120),
        // An archived case is closed whether or not the status column says so.
        status: archived ? 'closed' : status,
        case_type: mapCaseType(raw?.case_type),
        track_type: cleanNullableString(raw?.case_type, 64),
        total_allocation: parseImportNumber(raw?.total_allocation),
        used_quantity: parseImportNumber(raw?.used_quantity),
        practitioner: cleanNullableString(raw?.practitioner, 255),
        issue_date: parseExportDate(raw?.issue_date),
        expiry_date: parseExportDate(raw?.expiry_date),
        referral_contact: cleanNullableString(raw?.referral_contact, 255),
        referral_period: cleanNullableString(raw?.referral_period, 120),
        notes: cleanOptionalText(raw?.notes),
        archived,
    }
}

/**
 * Provenance for the external case, kept in the `metadata` column.
 */
export function buildCaseProvenance(record, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const normalizedSource = cleanString(source).toLowerCase() || DEFAULT_EXTERNAL_SOURCE
    const passthrough = {}

    Object.entries(PASSTHROUGH_FIELDS).forEach(([canonicalHeader, metadataKey]) => {
        const value = cleanNullableString(record?.[canonicalHeader], PASSTHROUGH_MAX_LENGTH[canonicalHeader] || 255)
        if (value) passthrough[metadataKey] = value
    })

    return {
        sploseCase: {
            externalId: record?.external_id || null,
            externalSource: normalizedSource,
            externalPatientId: record?.external_patient_id || null,
            patientName: record?.patient_name || null,
            trackType: record?.track_type || null,
            usedQuantity: toFinite(record?.used_quantity),
            archived: record?.archived === true,
            ...passthrough,
        },
    }
}

/**
 * Turn one parsed CSV row into the case shape used by the import pipeline.
 * `used_quantity` rides along on the record but is never written to
 * patient_cases - the importer turns it into a case_usage entry.
 */
export function mapCsvRowToCase(raw, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const normalizedSource = cleanString(source).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE
    const record = normalizeCaseRecord({ ...raw, external_source: normalizedSource })

    return {
        ...record,
        external_source: normalizedSource,
        patient_id: null,
        // The provenance builder also reads the passthrough columns, which are
        // carried on the raw row rather than in the canonical record shape.
        metadata: buildCaseProvenance({ ...raw, ...record }, { source: normalizedSource }),
    }
}

/**
 * Merge an imported metadata projection over the metadata already stored on a
 * case row. Untouched keys are preserved.
 */
export function mergeCaseMetadata(existing, incoming) {
    const base = parseMetadataValue(existing) || {}
    if (!incoming || typeof incoming !== 'object') return base

    return {
        ...base,
        sploseCase: {
            ...(parseMetadataValue(base.sploseCase) || {}),
            ...(parseMetadataValue(incoming.sploseCase) || {}),
        },
    }
}

function normalizeComparableCaseValue(key, value) {
    if (key === 'metadata') {
        const parsed = parseMetadataValue(value)
        return parsed ? JSON.stringify(sortCaseKeys(parsed)) : ''
    }
    if (key === 'total_allocation') {
        return String(toFinite(value))
    }
    if (key === 'status' || key === 'case_type') {
        return cleanString(value).toLowerCase()
    }
    return cleanString(value)
}

function sortCaseKeys(value) {
    if (Array.isArray(value)) return value.map(sortCaseKeys)
    if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc, key) => {
            acc[key] = sortCaseKeys(value[key])
            return acc
        }, {})
    }
    return value
}

/**
 * Compare an incoming case field set with a stored row. Only changed fields are
 * returned, so a repeat import does not touch unchanged rows (and therefore does
 * not bump updated_at).
 */
export function diffCaseFields(existing, incoming) {
    const changed = []

    CASE_COLUMN_KEYS.forEach((key) => {
        const stored = normalizeComparableCaseValue(key, existing?.[key])
        const next = normalizeComparableCaseValue(key, incoming?.[key])
        if (stored !== next) {
            changed.push({ key, value: incoming?.[key] === undefined ? null : incoming[key] })
        }
    })

    return changed
}
