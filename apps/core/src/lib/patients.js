// Shared helpers for importing Patient records from an external
// practice-management system (a Splose "patients" CSV export is the reference
// format).
//
// Patients already live in the `patients` table, so an import only owns the two
// identity columns (`external_id` / `external_source`) plus the JSON `metadata`
// blob. Everything the export carries is normalised into
// `metadata.splosePatient` for provenance, and the subset the app's own intake
// fields understand is also written to `metadata.sploseAnswers` /
// `metadata.sploseLabelledAnswers` so imported records render in the admin UI
// exactly like a record created through the intake form.
//
// Kept DB-agnostic and free of Node-only APIs so the CSV
// parser can also run in the browser for import previews.

import { normalizeCsvHeader, parseCsv } from './csv.js'

export const DEFAULT_EXTERNAL_SOURCE = 'splose'

export const MAX_IMPORT_ROWS = 5000

// Free-text values land in a JSON column, so they only need a sanity cap.
const MAX_FACT_LENGTH = 4000

// ---------------------------------------------------------------------------
// Small shared coercions (mirrors the helpers used by other feature libs)
// ---------------------------------------------------------------------------
export function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function cleanNullableString(value, maxLength = 255) {
    const text = cleanString(value)
    return text ? text.slice(0, maxLength) : null
}

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

function cleanFactValue(value) {
    return cleanNullableString(value, MAX_FACT_LENGTH)
}

// ---------------------------------------------------------------------------
// Field shape
// ---------------------------------------------------------------------------

// Every canonical field the importer recognises. `external_id` and
// `patient_name` are identity; the rest are stored on the record.
export const PATIENT_IMPORT_FIELD_KEYS = [
    'external_id',
    'patient_name',
    'title',
    'first_name',
    'last_name',
    'preferred_name',
    'date_of_birth',
    'sex',
    'gender_identity',
    'pronouns',
    'email',
    'mobile_phone',
    'home_phone',
    'work_phone',
    'fax_phone',
    'other_phones',
    'address_line_1',
    'address_line_2',
    'address_line_3',
    'city',
    'state',
    'postal_code',
    'country',
    'privacy_policy_consent',
    'timezone',
    'medications',
    'allergies',
    'intolerances',
    'other_details',
    'other_invoice_details',
    'medicare_card_number',
    'medicare_reference_number',
    'medicare_expiry_date',
    'dva_file_number',
    'dva_gender',
    'private_health_fund',
    'ndis_number',
    'diagnosis',
    'fund_management',
    'plan_manager',
    'plan_start_date',
    'plan_end_date',
    'nominee_first_name',
    'nominee_last_name',
    'nominee_mobile_code',
    'nominee_mobile_number',
    'nominee_email',
    'emergency_contact_name',
    'emergency_contact_relationship',
    'emergency_contact_phone',
    'related_patients',
    'referral_type',
    'referral_name',
    'referral_id',
    'referral_information',
    'occupation',
    'alert',
    'archived',
    'tags',
    'ndis_goals',
    'tac_number',
    'tac_email_contact',
]

// Maps both the raw export headers and friendlier header names onto the
// canonical patient field names. Keys are the output of `normalizeCsvHeader`.
const CSV_HEADER_ALIASES = new Map([
    ['id', 'external_id'],
    ['patient id', 'external_id'],
    ['client id', 'external_id'],
    ['external id', 'external_id'],
    ['title', 'title'],
    ['first name', 'first_name'],
    ['given name', 'first_name'],
    ['last name', 'last_name'],
    ['surname', 'last_name'],
    ['family name', 'last_name'],
    ['preferred name', 'preferred_name'],
    ['nickname', 'preferred_name'],
    ['patient', 'patient_name'],
    ['patient name', 'patient_name'],
    ['client name', 'patient_name'],
    ['full name', 'patient_name'],
    ['name', 'patient_name'],
    ['date of birth', 'date_of_birth'],
    ['dob', 'date_of_birth'],
    ['birth date', 'date_of_birth'],
    ['sex', 'sex'],
    ['gender identity', 'gender_identity'],
    ['pronouns', 'pronouns'],
    ['email', 'email'],
    ['email address', 'email'],
    ['mobile phone', 'mobile_phone'],
    ['mobile', 'mobile_phone'],
    ['home phone', 'home_phone'],
    ['work phone', 'work_phone'],
    ['fax phone', 'fax_phone'],
    ['other phones', 'other_phones'],
    ['address', 'address_line_1'],
    ['address line 1', 'address_line_1'],
    ['street address', 'address_line_1'],
    ['address line 2', 'address_line_2'],
    ['address line 3', 'address_line_3'],
    ['city', 'city'],
    ['suburb', 'city'],
    ['town', 'city'],
    ['state', 'state'],
    ['postal code', 'postal_code'],
    ['postcode', 'postal_code'],
    ['zip', 'postal_code'],
    ['country', 'country'],
    ['privacy policy consent', 'privacy_policy_consent'],
    ['timezone', 'timezone'],
    ['medications', 'medications'],
    ['allergies', 'allergies'],
    ['intolerances', 'intolerances'],
    ['other details', 'other_details'],
    ['other invoice details', 'other_invoice_details'],
    ['medicare card number', 'medicare_card_number'],
    ['medicare reference number', 'medicare_reference_number'],
    ['medicare expiry date', 'medicare_expiry_date'],
    ['dva file number', 'dva_file_number'],
    ['dva gender', 'dva_gender'],
    ['private health fund', 'private_health_fund'],
    ['ndis number', 'ndis_number'],
    ['diagnosis', 'diagnosis'],
    ['fund management', 'fund_management'],
    ['plan manager', 'plan_manager'],
    ['plan start date', 'plan_start_date'],
    ['plan end date', 'plan_end_date'],
    ['nominee first name', 'nominee_first_name'],
    ['nominee last name', 'nominee_last_name'],
    ['nominee mobile code', 'nominee_mobile_code'],
    ['nominee mobile number', 'nominee_mobile_number'],
    ['nominee email', 'nominee_email'],
    ['emergency contact full name', 'emergency_contact_name'],
    ['emergency contact relationship', 'emergency_contact_relationship'],
    ['emergency contact phone number', 'emergency_contact_phone'],
    ['related patients', 'related_patients'],
    ['referral type', 'referral_type'],
    ['referral name', 'referral_name'],
    ['referral id', 'referral_id'],
    ['referral information', 'referral_information'],
    ['occupation', 'occupation'],
    ['alert', 'alert'],
    ['archived', 'archived'],
    ['tags', 'tags'],
    ['ndis goals', 'ndis_goals'],
    ['tac number', 'tac_number'],
    ['tac email contact', 'tac_email_contact'],
])

function lookupHeaderAlias(rawHeader) {
    return CSV_HEADER_ALIASES.get(normalizeCsvHeader(rawHeader)) || null
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

/**
 * Parse a CSV document into patient-shaped records.
 * Returns { records, unknownHeaders, rowCount }.
 */
export function parsePatientCsv(text) {
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
 * Normalise the raw CSV cells into the canonical patient record shape.
 */
export function normalizePatientRecord(raw) {
    const record = {}
    PATIENT_IMPORT_FIELD_KEYS.forEach((key) => {
        record[key] = cleanFactValue(raw?.[key])
    })
    record.external_id = cleanNullableString(raw?.external_id, 120)
    record.patient_name = buildPatientName(record)
    return record
}

// The export splits the name into parts, so prefer an explicit name column and
// fall back to "First Last" (which is the shape the rest of the app stores).
function buildPatientName(record) {
    const explicit = cleanNullableString(record?.patient_name, 255)
    if (explicit) return explicit

    const parts = [cleanString(record?.first_name), cleanString(record?.last_name)].filter(Boolean)
    if (parts.length > 0) return parts.join(' ').slice(0, 255)

    return cleanNullableString(record?.preferred_name, 255)
}

// ---------------------------------------------------------------------------
// Metadata projection
// ---------------------------------------------------------------------------

// Field ids + labels from the app's canonical intake field set
// (see `DEFAULT_SPLPOSE_FIELDS` in the admin patients page). Answers are stored
// under the id, and the label map is what the patient list reads for its
// "Funding" and "Referrer" columns.
const ANSWER_FIELDS = {
    patientFullName: { id: 'patient_full_name', label: 'Patient full name' },
    fundingSource: { id: 'funding_source_or_referral_type', label: 'Funding Source or Referral Type' },
    clientPhone: { id: 'client_phone', label: 'Client Phone' },
    address: { id: 'address', label: 'Address' },
    dateOfBirth: { id: 'date_of_birth', label: 'Date of birth' },
    claimNumber: {
        id: 'claim_or_reference_number',
        label: 'NDIS number/ TAC Claim Number/Work Cover Reference Number',
    },
    referralReason: { id: 'reasons_for_referral_to_ot', label: 'Reasons for Referral to OT' },
    referrerName: { id: 'referrer_full_name', label: 'Full name' },
}

const FUNDING_SOURCE_MATCHERS = [
    {
        value: 'NDIS',
        patterns: [
            'ndis',
            'ndia',
            'plan-managed',
            'plan managed',
            'self-managed',
            'self managed',
            'agency-managed',
            'agency managed',
        ],
    },
    { value: 'TAC', patterns: ['tac'] },
    { value: 'DVA', patterns: ['dva'] },
    { value: 'WorkCover', patterns: ['workcover', 'work cover'] },
    { value: 'HCP/ My Aged Care', patterns: ['hcp', 'home care', 'my aged care', 'aged care'] },
]

// The export has no dedicated funding column, so the scheme numbers are checked
// first and the tags / fund management / referral text is the fallback signal.
// Unmatched rows simply keep whatever the patient record already had.
export function deriveFundingSource(record) {
    if (cleanString(record?.ndis_number)) return 'NDIS'
    if (cleanString(record?.dva_file_number)) return 'DVA'

    const haystack = [
        record?.tags,
        record?.fund_management,
        record?.referral_type,
        record?.other_details,
    ]
        .map((value) => cleanString(value).toLowerCase())
        .join(' ')
    if (!haystack) return null

    const match = FUNDING_SOURCE_MATCHERS.find((entry) => entry.patterns.some((pattern) => haystack.includes(pattern)))
    return match ? match.value : null
}

function buildAddressAnswer(record) {
    const address = {
        addressLine1: cleanString(record?.address_line_1),
        city: cleanString(record?.city),
        state: cleanString(record?.state),
        postalCode: cleanString(record?.postal_code),
        country: cleanString(record?.country),
    }

    const hasAnyValue = Object.values(address).some(Boolean)
    if (!hasAnyValue) return null

    const isComplete = Boolean(address.addressLine1 && address.city && address.state && address.postalCode && address.country)
    return { address, isComplete }
}

/**
 * Build the `sploseAnswers` / `sploseLabelledAnswers` entries an imported
 * record contributes. Only the fields the export can fill confidently are
 * mapped; anything else stays available under `metadata.splosePatient`.
 */
export function buildPatientImportAnswers(record) {
    const answers = {}
    const labelledAnswers = {}

    const set = (field, value, labelledValue = value) => {
        if (value === null || value === undefined || value === '') return
        answers[field.id] = value
        if (labelledValue !== null && labelledValue !== undefined && labelledValue !== '') {
            labelledAnswers[field.label] = labelledValue
        }
    }

    set(ANSWER_FIELDS.patientFullName, cleanString(record?.patient_name))
    set(ANSWER_FIELDS.fundingSource, deriveFundingSource(record))
    set(ANSWER_FIELDS.clientPhone, cleanString(record?.mobile_phone) || cleanString(record?.home_phone))
    set(ANSWER_FIELDS.dateOfBirth, cleanString(record?.date_of_birth))
    set(
        ANSWER_FIELDS.claimNumber,
        cleanString(record?.ndis_number) || cleanString(record?.tac_number)
    )
    set(ANSWER_FIELDS.referralReason, cleanString(record?.referral_information))
    set(ANSWER_FIELDS.referrerName, cleanString(record?.referral_name))

    const address = buildAddressAnswer(record)
    if (address) {
        // The label map only carries a full address (same rule the patient
        // modal uses), while the answer keeps a partial one for editing.
        set(ANSWER_FIELDS.address, address.address, address.isComplete ? address.address : null)
    }

    return { answers, labelledAnswers }
}

export function buildPatientImportMetadata(record, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const { answers, labelledAnswers } = buildPatientImportAnswers(record)
    const normalizedSource = cleanString(source).toLowerCase() || DEFAULT_EXTERNAL_SOURCE

    return {
        splosePatient: {
            externalId: record.external_id,
            externalSource: normalizedSource,
            ...Object.fromEntries(
                PATIENT_IMPORT_FIELD_KEYS
                    .filter((key) => key !== 'external_id' && key !== 'patient_name')
                    .map((key) => [key, record[key]])
                    .filter(([, value]) => value !== null)
            ),
        },
        sploseAnswers: answers,
        sploseLabelledAnswers: labelledAnswers,
    }
}

/**
 * Turn one parsed CSV row into the patient shape used by the create/update
 * paths of the import pipeline.
 */
export function mapCsvRowToPatient(raw, { source = DEFAULT_EXTERNAL_SOURCE } = {}) {
    const record = normalizePatientRecord(raw)
    const normalizedSource = cleanString(source).toLowerCase().slice(0, 64) || DEFAULT_EXTERNAL_SOURCE

    return {
        external_id: record.external_id,
        external_source: normalizedSource,
        patient_name: record.patient_name,
        metadata: buildPatientImportMetadata(record, { source: normalizedSource }),
    }
}

/**
 * Merge an imported metadata projection over the metadata already stored on a
 * patient record. Untouched keys (agents, notes, intake answers the export has
 * no value for) are preserved.
 */
export function mergePatientImportMetadata(existing, incoming) {
    const base = parseMetadataValue(existing) || {}
    if (!incoming || typeof incoming !== 'object') return base

    return {
        ...base,
        splosePatient: {
            ...(parseMetadataValue(base.splosePatient) || {}),
            ...(parseMetadataValue(incoming.splosePatient) || {}),
        },
        sploseAnswers: {
            ...(parseMetadataValue(base.sploseAnswers) || {}),
            ...(parseMetadataValue(incoming.sploseAnswers) || {}),
        },
        sploseLabelledAnswers: {
            ...(parseMetadataValue(base.sploseLabelledAnswers) || {}),
            ...(parseMetadataValue(incoming.sploseLabelledAnswers) || {}),
        },
    }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

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

function serializeMetadata(value) {
    const parsed = parseMetadataValue(value)
    return parsed ? JSON.stringify(sortKeys(parsed)) : ''
}

// Patient names are compared case/whitespace-insensitively so a re-import only
// rewrites a record when something meaningful changed.
export function normalizeNameKey(value) {
    return cleanString(value).toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Compare an incoming patient field set with a stored row. Only changed fields
 * are returned, so a repeat import does not touch unchanged rows (and therefore
 * does not bump updated_at).
 */
export function diffPatientFields(existing, incoming) {
    const changed = []

    if (normalizeNameKey(existing?.patient_name) !== normalizeNameKey(incoming?.patient_name)) {
        changed.push({ key: 'patient_name', value: incoming.patient_name })
    }

    if (serializeMetadata(existing?.metadata) !== serializeMetadata(incoming?.metadata)) {
        changed.push({ key: 'metadata', value: incoming.metadata })
    }

    return changed
}
