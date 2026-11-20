// Shared helpers for the Contacts entity.
//
// A contact is a person (or organisation) the domain deals with. The record is
// deliberately small — a name, the ways to reach them (email / phone) and the
// association they belong to — with `role` and `notes` available as optional
// extras so a contact can carry a little more detail without the list turning
// into a CRM.
//
// Kept DB-agnostic and free of Node-only APIs so the validators can also run in
// the browser (the admin page validates the form before it posts).

export const CONTACT_FIELD_LIMITS = {
    name: 255,
    email: 320,
    phone: 64,
    association: 255,
    role: 160,
    notes: 4000,
}

// Deliberately permissive: the goal is to catch obvious typos and missing
// domains, not to re-implement RFC 5322. Blank emails are allowed.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function cleanString(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function cleanBoundedString(value, maxLength) {
    return cleanString(value).slice(0, maxLength)
}

export function validateId(rawId) {
    const id = Number.parseInt(String(rawId || ''), 10)
    return Number.isFinite(id) && id > 0 ? id : null
}

/**
 * Normalise a list of patient ids coming from a form (an array, or the
 * comma-separated string a plain multi-select would submit). Duplicates collapse
 * and order is preserved; a value that is not a positive integer is an error
 * rather than something to silently drop.
 */
export function normalizePatientIds(value) {
    if (value === null || value === undefined || value === '') return { ids: [] }

    const list = Array.isArray(value) ? value : String(value).split(',')
    const ids = []

    for (const entry of list) {
        if (entry === null || entry === undefined || cleanString(entry) === '') continue
        const id = validateId(entry)
        if (!id) return { ids: [], error: 'Select a valid patient' }
        if (!ids.includes(id)) ids.push(id)
    }

    return { ids }
}

/** The patient links on a row as a clean `[{ id, name }]` list. */
export function normalizeContactPatients(value) {
    if (!Array.isArray(value)) return []

    const seen = new Set()
    const patients = []

    for (const entry of value) {
        const id = validateId(entry?.id)
        if (!id || seen.has(id)) continue
        seen.add(id)
        patients.push({ id, name: cleanString(entry?.name) || `Patient #${id}` })
    }

    return patients
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

export function normalizeContactEmail(value) {
    return cleanBoundedString(value, CONTACT_FIELD_LIMITS.email).toLowerCase()
}

export function isValidContactEmail(value) {
    const email = cleanString(value)
    return email === '' || EMAIL_PATTERN.test(email)
}

/**
 * Validate + normalise the mutable contact fields present in a payload.
 *
 * Only keys that are actually present are returned, so the same helper serves
 * both create (full form) and patch (partial update) requests. Emails are
 * lower-cased so two spellings of the same address sort and search together.
 */
export function resolveContactFields(payload) {
    const updates = []
    const errors = []
    const has = (key) => Object.prototype.hasOwnProperty.call(payload || {}, key)

    if (has('name')) updates.push({ key: 'name', value: cleanBoundedString(payload.name, CONTACT_FIELD_LIMITS.name) })

    if (has('email')) {
        const email = normalizeContactEmail(payload.email)
        if (!isValidContactEmail(email)) errors.push('Enter a valid email address')
        updates.push({ key: 'email', value: email })
    }

    if (has('phone')) updates.push({ key: 'phone', value: cleanBoundedString(payload.phone, CONTACT_FIELD_LIMITS.phone) })
    if (has('association')) updates.push({ key: 'association', value: cleanBoundedString(payload.association, CONTACT_FIELD_LIMITS.association) })
    if (has('role')) updates.push({ key: 'role', value: cleanBoundedString(payload.role, CONTACT_FIELD_LIMITS.role) })
    if (has('notes')) updates.push({ key: 'notes', value: cleanBoundedString(payload.notes, CONTACT_FIELD_LIMITS.notes) })

    // The patient links are optional and clear to an empty list so a contact can
    // be detached without deleting it. `patient_ids` never reaches the contacts
    // table itself — callers turn it into `contact_patients` rows.
    if (has('patient_ids')) {
        const { ids, error } = normalizePatientIds(payload.patient_ids)
        if (error) errors.push(error)
        else updates.push({ key: 'patient_ids', value: ids })
    }

    if (has('metadata')) {
        const metadata = payload.metadata
        if (metadata !== null && (typeof metadata !== 'object' || Array.isArray(metadata))) {
            errors.push('metadata must be an object or null')
        } else {
            updates.push({ key: 'metadata', value: metadata })
        }
    }

    return { updates, errors }
}

/**
 * A contact needs *something* to identify it — a name or an email. Rows that
 * carry neither are almost always an accidental submit.
 */
export function isEmptyContact(fields) {
    const name = cleanString(fields?.name)
    const email = cleanString(fields?.email)
    return !name && !email
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export function buildContactSelect({ includePatient = false } = {}) {
    return `
        SELECT
            c.id, c.domain, c.name, c.email, c.phone, c.association,
            c.role, c.notes, c.metadata, c.created_at, c.updated_at
            ${includePatient ? `,
            COALESCE((
                SELECT json_agg(json_build_object('id', p.id, 'name', p.patient_name)
                                ORDER BY LOWER(NULLIF(p.patient_name, '')) ASC NULLS LAST, p.id ASC)
                  FROM contact_patients cp
                  JOIN patients p ON p.id = cp.patient_id
                 WHERE cp.contact_id = c.id
            ), '[]'::json) AS patients` : ''}
        FROM contacts c
    `
}

// A contact is linked to a patient through `contact_patients`, so every patient
// filter is an EXISTS rather than a column comparison. The patients table may not
// exist at all, which callers handle with `includePatient`.
export function buildContactPatientExistsClause(patientParam) {
    return `EXISTS (
        SELECT 1 FROM contact_patients cp
         WHERE cp.contact_id = c.id AND cp.patient_id = ${patientParam}
    )`
}

export function buildContactPatientSearchClause(searchParam) {
    return `EXISTS (
        SELECT 1
          FROM contact_patients cp
          JOIN patients p ON p.id = cp.patient_id
         WHERE cp.contact_id = c.id
           AND LOWER(COALESCE(p.patient_name, '')) LIKE ${searchParam}
    )`
}

/** Alphabetical by name, with unnamed records falling to the bottom. */
export function contactOrderExpression() {
    return `LOWER(NULLIF(c.name, '')) ASC NULLS LAST, c.id ASC`
}

export function normalizeContactRow(row) {
    if (!row || typeof row !== 'object') return row

    return {
        ...row,
        name: cleanString(row.name),
        email: cleanString(row.email),
        phone: cleanString(row.phone),
        association: cleanString(row.association),
        role: cleanString(row.role),
        notes: cleanString(row.notes),
        metadata: parseMetadataValue(row.metadata),
        patients: normalizeContactPatients(row.patients),
    }
}

/**
 * Case-insensitive match across every field a user might search by. Kept next
 * to the row shape so the admin page's client-side filter and any future
 * server-side filter agree on what "matches".
 */
export function contactMatchesQuery(row, query) {
    const needle = cleanString(query).toLowerCase()
    if (!needle) return true

    const patientNames = normalizeContactPatients(row?.patients).map((patient) => patient.name)

    return [
        row?.name,
        row?.email,
        row?.phone,
        row?.association,
        row?.role,
        row?.notes,
        ...patientNames,
    ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ')
        .includes(needle)
}
