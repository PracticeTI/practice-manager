// Shared helpers for the native scheduling layer.
//
// Kept free of Node-only APIs and database access so the API routes, the admin
// UI, the migration script and the tests all validate the same way.
//
// `appointments` still carries the legacy Splose-shaped columns for import
// provenance. These helpers describe the native model that will replace them:
// practitioners, practice locations, services, availability and a first-class
// appointment status lifecycle.

export const DEFAULT_TIMEZONE = 'Australia/Sydney'

export const APPOINTMENT_STATUSES = [
    'tentative',
    'confirmed',
    'arrived',
    'completed',
    'cancelled',
    'no_show',
]

export const LOCATION_TYPES = ['clinic', 'telehealth', 'mobile', 'community']

export const AVAILABILITY_EXCEPTION_TYPES = ['leave', 'training', 'extra', 'other']

export const CONFIRMATION_STATUSES = [
    'pending',
    'confirmed',
    'declined',
    'reschedule_requested',
    'not_required',
]

export const WAITLIST_STATUSES = [
    'waiting',
    'offered',
    'booked',
    'expired',
    'withdrawn',
    'paused',
]

const CONFIRMATION_STATUS_ALIASES = new Map([
    ['pending', 'pending'],
    ['awaiting', 'pending'],
    ['confirmed', 'confirmed'],
    ['confirm', 'confirmed'],
    ['declined', 'declined'],
    ['decline', 'declined'],
    ['reschedule', 'reschedule_requested'],
    ['reschedule requested', 'reschedule_requested'],
    ['reschedule_requested', 'reschedule_requested'],
    ['not required', 'not_required'],
    ['not_required', 'not_required'],
])

export function normalizeConfirmationStatus(value) {
    const text = cleanText(value)
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
    if (!text) return null
    return CONFIRMATION_STATUS_ALIASES.get(text) || null
}

export const TRAVEL_FEE_RULES = ['none', 'flat', 'per_km', 'hourly']

// 0 = Sunday to match PostgreSQL `EXTRACT(DOW ...)` and JavaScript `getDay()`.
export const WEEKDAY_LABELS = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
]

// Status values arrive from CSV exports and hand-written payloads in several
// spellings ("No Show", "DNA", "no_show"). Normalise them onto one vocabulary.
const APPOINTMENT_STATUS_ALIASES = new Map([
    ['tentative', 'tentative'],
    ['pending', 'tentative'],
    ['unconfirmed', 'tentative'],
    ['provisional', 'tentative'],
    ['waitlist', 'tentative'],
    ['waitlisted', 'tentative'],
    ['hold', 'tentative'],
    ['confirmed', 'confirmed'],
    ['booked', 'confirmed'],
    ['scheduled', 'confirmed'],
    ['active', 'confirmed'],
    ['arrived', 'arrived'],
    ['checked in', 'arrived'],
    ['check in', 'arrived'],
    ['in clinic', 'arrived'],
    ['in progress', 'arrived'],
    ['completed', 'completed'],
    ['complete', 'completed'],
    ['attended', 'completed'],
    ['finished', 'completed'],
    ['done', 'completed'],
    ['cancelled', 'cancelled'],
    ['canceled', 'cancelled'],
    ['cancellation', 'cancelled'],
    ['void', 'cancelled'],
    ['voided', 'cancelled'],
    ['deleted', 'cancelled'],
    ['no show', 'no_show'],
    ['noshow', 'no_show'],
    ['dna', 'no_show'],
    ['did not attend', 'no_show'],
    ['didnt attend', 'no_show'],
    ['missed', 'no_show'],
])

export function normalizeAppointmentStatus(value) {
    const text = cleanText(value)
        .toLowerCase()
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
    if (!text) return null
    return APPOINTMENT_STATUS_ALIASES.get(text) || null
}

/**
 * Resolve the native status for an appointment.
 *
 * An explicit native status always wins. Otherwise the imported patient status
 * is mapped onto the lifecycle, and anything unrecognised is treated as
 * confirmed rather than losing the appointment from the calendar.
 */
export function deriveAppointmentStatus({ patientStatus, appointmentStatus } = {}) {
    return normalizeAppointmentStatus(appointmentStatus)
        || normalizeAppointmentStatus(patientStatus)
        || 'confirmed'
}

export function isAppointmentStatus(value) {
    return APPOINTMENT_STATUSES.includes(value)
}

// ---------------------------------------------------------------------------
// Small coercions
// ---------------------------------------------------------------------------

export function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export function cleanNullableText(value, maxLength = 255) {
    const text = cleanText(value)
    return text ? text.slice(0, maxLength) : null
}

export function normalizeEntityName(value) {
    return cleanText(value).replace(/\s+/g, ' ')
}

/**
 * Stable key used by the migration to deduplicate imported practitioners,
 * locations and services. External ids win because they survive a rename.
 */
export function buildEntityDedupeKey({ domain, externalId, name } = {}) {
    const normalizedDomain = cleanText(domain).toLowerCase()
    const normalizedExternalId = cleanText(externalId)
    if (normalizedExternalId) {
        return `${normalizedDomain}::external::${normalizedExternalId.toLowerCase()}`
    }
    const normalizedName = normalizeEntityName(name).toLowerCase()
    return normalizedName ? `${normalizedDomain}::name::${normalizedName}` : null
}

export function isValidTimeZone(value) {
    const text = cleanText(value)
    if (!text) return false
    try {
        new Intl.DateTimeFormat('en-AU', { timeZone: text })
        return true
    } catch {
        return false
    }
}

// ---------------------------------------------------------------------------
// Field normalisation
// ---------------------------------------------------------------------------

function hasField(payload, key) {
    return Boolean(payload) && Object.prototype.hasOwnProperty.call(payload, key)
}

function createBuilder() {
    const fields = {}
    const errors = []

    const set = (payload, key, parse, { required = false, label = key } = {}) => {
        if (!hasField(payload, key)) {
            if (required) errors.push(`${label} is required`)
            return
        }
        const { value, error } = parse(payload[key])
        if (error) {
            errors.push(`${label} ${error}`)
            return
        }
        fields[key] = value
    }

    return { fields, errors, set }
}

function requiredText(maxLength) {
    return (raw) => {
        const value = cleanText(raw)
        if (!value) return { error: 'must not be empty' }
        return { value: value.slice(0, maxLength) }
    }
}

function optionalText(maxLength) {
    return (raw) => ({ value: cleanNullableText(raw, maxLength) })
}

function optionalEmail() {
    return (raw) => {
        const value = cleanText(raw)
        if (!value) return { value: null }
        if (value.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            return { error: 'must be a valid email address' }
        }
        return { value }
    }
}

function optionalInteger(min, max) {
    return (raw) => {
        const text = cleanText(raw)
        if (!text) return { value: null }
        const number = Number(text)
        if (!Number.isFinite(number) || !Number.isInteger(number)) {
            return { error: 'must be a whole number' }
        }
        if (number < min || number > max) {
            return { error: `must be between ${min} and ${max}` }
        }
        return { value: number }
    }
}

function requiredInteger(min, max) {
    return (raw) => {
        const text = cleanText(raw)
        if (!text) return { error: 'is required' }
        const number = Number(text)
        if (!Number.isFinite(number) || !Number.isInteger(number)) {
            return { error: 'must be a whole number' }
        }
        if (number < min || number > max) {
            return { error: `must be between ${min} and ${max}` }
        }
        return { value: number }
    }
}

function optionalNumber(min, max, { scale = null } = {}) {
    return (raw) => {
        const text = cleanText(raw)
        if (!text) return { value: null }
        const number = Number(text)
        if (!Number.isFinite(number)) return { error: 'must be a number' }
        if (number < min || number > max) {
            return { error: `must be between ${min} and ${max}` }
        }
        return { value: scale === null ? number : Number(number.toFixed(scale)) }
    }
}

function booleanValue() {
    return (raw) => {
        if (typeof raw === 'boolean') return { value: raw }
        const text = cleanText(raw).toLowerCase()
        if (['true', '1', 'yes', 'y', 't'].includes(text)) return { value: true }
        if (['false', '0', 'no', 'n', 'f'].includes(text)) return { value: false }
        return { error: 'must be true or false' }
    }
}

function enumValue(allowed) {
    return (raw) => {
        const text = cleanText(raw).toLowerCase()
        if (!text) return { error: `must be one of: ${allowed.join(', ')}` }
        if (!allowed.includes(text)) {
            return { error: `must be one of: ${allowed.join(', ')}` }
        }
        return { value: text }
    }
}

function timeValue() {
    return (raw) => {
        const text = cleanText(raw)
        const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(text)
        if (!match) return { error: 'must be a valid time (HH:MM)' }
        return { value: `${match[1]}:${match[2]}:${match[3] || '00'}` }
    }
}

function optionalDate() {
    return (raw) => {
        const text = cleanText(raw)
        if (!text) return { value: null }
        const date = text.slice(0, 10)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'must be a valid date (YYYY-MM-DD)' }
        const parsed = new Date(`${date}T00:00:00Z`)
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
            return { error: 'must be a valid date (YYYY-MM-DD)' }
        }
        return { value: date }
    }
}

function timestampValue({ required = false } = {}) {
    return (raw) => {
        const text = cleanText(raw)
        if (!text) {
            return required ? { error: 'is required' } : { value: null }
        }
        const date = new Date(text)
        if (Number.isNaN(date.getTime())) return { error: 'must be a valid date/time' }
        return { value: date.toISOString() }
    }
}

function timezoneValue() {
    return (raw) => {
        const text = cleanText(raw)
        if (!text) return { value: DEFAULT_TIMEZONE }
        if (!isValidTimeZone(text)) return { error: 'must be a valid IANA timezone' }
        return { value: text }
    }
}

function metadataValue() {
    return (raw) => {
        if (raw === null || raw === undefined) return { value: null }
        if (typeof raw !== 'object' || Array.isArray(raw)) {
            return { error: 'must be an object or null' }
        }
        return { value: raw }
    }
}

function fundingTypesValue() {
    return (raw) => {
        if (raw === null || raw === undefined) return { value: [] }
        const list = Array.isArray(raw) ? raw : String(raw).split(',')
        const values = [...new Set(list.map((item) => cleanText(item).toLowerCase()).filter(Boolean))]
        if (values.length > 12) return { error: 'must contain at most 12 values' }
        if (values.some((value) => value.length > 32)) {
            return { error: 'values must be 32 characters or fewer' }
        }
        return { value: values }
    }
}

function externalIdValue() {
    return optionalText(120)
}

function externalSourceValue() {
    return (raw) => ({ value: cleanNullableText(raw, 64)?.toLowerCase() || null })
}

// ---------------------------------------------------------------------------
// Entity parsers
//
// Each returns `{ fields, errors }`. `fields` only contains keys present in the
// payload, which lets the same parser serve create (full payload) and update
// (partial payload) routes.
// ---------------------------------------------------------------------------

export function normalizePractitionerFields(payload, { requireName = true } = {}) {
    const builder = createBuilder()
    builder.set(payload, 'display_name', requiredText(255), { required: requireName })
    builder.set(payload, 'email', optionalEmail())
    builder.set(payload, 'discipline', optionalText(120))
    builder.set(payload, 'provider_number', optionalText(64))
    builder.set(payload, 'timezone', timezoneValue())
    builder.set(payload, 'admin_user_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'default_location_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'colour', optionalText(16))
    builder.set(payload, 'active', booleanValue())
    builder.set(payload, 'external_id', externalIdValue())
    builder.set(payload, 'external_source', externalSourceValue())
    builder.set(payload, 'metadata', metadataValue())
    return { fields: builder.fields, errors: builder.errors }
}

export function normalizeLocationFields(payload, { requireName = true } = {}) {
    const builder = createBuilder()
    builder.set(payload, 'name', requiredText(255), { required: requireName })
    builder.set(payload, 'location_type', enumValue(LOCATION_TYPES))
    builder.set(payload, 'address_line1', optionalText(255))
    builder.set(payload, 'address_line2', optionalText(255))
    builder.set(payload, 'suburb', optionalText(120))
    builder.set(payload, 'state', optionalText(32))
    builder.set(payload, 'postcode', optionalText(16))
    builder.set(payload, 'country', optionalText(64))
    builder.set(payload, 'latitude', optionalNumber(-90, 90, { scale: 6 }))
    builder.set(payload, 'longitude', optionalNumber(-180, 180, { scale: 6 }))
    builder.set(payload, 'timezone', timezoneValue())
    builder.set(payload, 'travel_fee_rule', enumValue(TRAVEL_FEE_RULES))
    builder.set(payload, 'active', booleanValue())
    builder.set(payload, 'external_id', externalIdValue())
    builder.set(payload, 'external_source', externalSourceValue())
    builder.set(payload, 'metadata', metadataValue())
    return { fields: builder.fields, errors: builder.errors }
}

export function normalizeServiceFields(payload, { requireName = true } = {}) {
    const builder = createBuilder()
    builder.set(payload, 'name', requiredText(255), { required: requireName })
    builder.set(payload, 'code', optionalText(64))
    builder.set(payload, 'duration_minutes', optionalInteger(5, 1440))
    builder.set(payload, 'buffer_before_minutes', optionalInteger(0, 240))
    builder.set(payload, 'buffer_after_minutes', optionalInteger(0, 240))
    builder.set(payload, 'price', optionalNumber(0, 1000000, { scale: 2 }))
    builder.set(payload, 'gst_applicable', booleanValue())
    builder.set(payload, 'funding_types', fundingTypesValue())
    builder.set(payload, 'ndis_support_item_number', optionalText(48))
    builder.set(payload, 'ndis_support_item_name', optionalText(255))
    builder.set(payload, 'telehealth_allowed', booleanValue())
    builder.set(payload, 'mobile_allowed', booleanValue())
    builder.set(payload, 'colour', optionalText(16))
    builder.set(payload, 'active', booleanValue())
    builder.set(payload, 'external_id', externalIdValue())
    builder.set(payload, 'external_source', externalSourceValue())
    builder.set(payload, 'metadata', metadataValue())
    return { fields: builder.fields, errors: builder.errors }
}

export function normalizePractitionerServiceFields(payload, { requireCore = true } = {}) {
    const builder = createBuilder()
    builder.set(payload, 'practitioner_id', requiredInteger(1, 2147483647), { required: requireCore })
    builder.set(payload, 'service_id', requiredInteger(1, 2147483647), { required: requireCore })
    builder.set(payload, 'metadata', metadataValue())
    return { fields: builder.fields, errors: builder.errors }
}

export function normalizeWaitlistEntryFields(payload, { requireName = true } = {}) {
    const builder = createBuilder()
    builder.set(payload, 'patient_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'patient_name', requiredText(255), { required: requireName })
    builder.set(payload, 'service_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'practitioner_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'location_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'priority', optionalInteger(-1000, 1000))
    builder.set(payload, 'earliest_date', optionalDate())
    builder.set(payload, 'latest_date', optionalDate())
    builder.set(payload, 'status', enumValue(WAITLIST_STATUSES))
    builder.set(payload, 'notes', optionalText(2000))
    builder.set(payload, 'metadata', metadataValue())

    const { earliest_date: earliest, latest_date: latest } = builder.fields
    if (earliest && latest && latest < earliest) {
        builder.errors.push('latest_date must be on or after earliest_date')
    }

    return { fields: builder.fields, errors: builder.errors }
}

export function normalizeAvailabilityRuleFields(payload, { requireCore = true } = {}) {
    const builder = createBuilder()
    builder.set(payload, 'practitioner_id', requiredInteger(1, 2147483647), { required: requireCore })
    builder.set(payload, 'location_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'service_id', optionalInteger(1, 2147483647))
    builder.set(payload, 'weekday', requiredInteger(0, 6), { required: requireCore })
    builder.set(payload, 'start_time', timeValue(), { required: requireCore })
    builder.set(payload, 'end_time', timeValue(), { required: requireCore })
    builder.set(payload, 'valid_from', optionalDate())
    builder.set(payload, 'valid_to', optionalDate())
    builder.set(payload, 'rrule', optionalText(255))
    builder.set(payload, 'active', booleanValue())
    builder.set(payload, 'metadata', metadataValue())

    const { start_time: startTime, end_time: endTime, valid_from: validFrom, valid_to: validTo } = builder.fields
    if (startTime && endTime && endTime <= startTime) {
        builder.errors.push('end_time must be after start_time')
    }
    if (validFrom && validTo && validTo < validFrom) {
        builder.errors.push('valid_to must be on or after valid_from')
    }

    return { fields: builder.fields, errors: builder.errors }
}

export function normalizeAvailabilityExceptionFields(payload, { requireCore = true } = {}) {
    const builder = createBuilder()
    builder.set(payload, 'practitioner_id', requiredInteger(1, 2147483647), { required: requireCore })
    builder.set(payload, 'exception_type', enumValue(AVAILABILITY_EXCEPTION_TYPES))
    builder.set(payload, 'starts_at', timestampValue({ required: true }), { required: requireCore })
    builder.set(payload, 'ends_at', timestampValue({ required: true }), { required: requireCore })
    builder.set(payload, 'note', optionalText(2000))
    builder.set(payload, 'metadata', metadataValue())

    const { starts_at: startsAt, ends_at: endsAt } = builder.fields
    if (startsAt && endsAt && endsAt <= startsAt) {
        builder.errors.push('ends_at must be after starts_at')
    }

    return { fields: builder.fields, errors: builder.errors }
}

// ---------------------------------------------------------------------------
// Availability helpers
// ---------------------------------------------------------------------------

function rangesOverlap(startA, endA, startB, endB) {
    const aStart = startA || '0000-01-01'
    const aEnd = endA || '9999-12-31'
    const bStart = startB || '0000-01-01'
    const bEnd = endB || '9999-12-31'
    return aStart <= bEnd && bStart <= aEnd
}

/**
 * Two availability rules conflict when they describe the same practitioner on
 * the same weekday with intersecting time and date ranges. Different locations
 * are allowed to overlap because the booking flow chooses one location.
 */
export function availabilityRulesOverlap(a, b) {
    if (!a || !b) return false
    if (a.practitioner_id !== b.practitioner_id) return false
    if (a.weekday !== b.weekday) return false
    if (Boolean(a.active === false) || Boolean(b.active === false)) return false

    const locationA = a.location_id ?? null
    const locationB = b.location_id ?? null
    if (locationA !== null && locationB !== null && locationA !== locationB) return false

    if (!rangesOverlap(a.valid_from, a.valid_to, b.valid_from, b.valid_to)) return false
    return a.start_time < b.end_time && b.start_time < a.end_time
}

/**
 * Appointment durations derived from the legacy export. Used by the migration to
 * give a service a sensible default instead of leaving every row at 60 minutes.
 */
export function mostCommonDurationMinutes(durations, fallback = 60) {
    const counts = new Map()
    ;(durations || []).forEach((duration) => {
        const minutes = Math.round(Number(duration))
        if (!Number.isFinite(minutes) || minutes <= 0) return
        counts.set(minutes, (counts.get(minutes) || 0) + 1)
    })

    let best = null
    counts.forEach((count, minutes) => {
        if (best === null || count > best.count || (count === best.count && minutes < best.minutes)) {
            best = { minutes, count }
        }
    })
    return best ? best.minutes : fallback
}
