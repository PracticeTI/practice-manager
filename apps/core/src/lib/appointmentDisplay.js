// Shared presentation helpers for the Appointments entity.
//
// Pure and client-safe (no database access, no Node-only APIs) so the patient
// record panel, the Appointments admin page and the dashboard card all render
// appointment rows the same way. Do not re-add local copies of these helpers.

import { toFinite } from './appointments.js'

export const APPOINTMENT_STATUS_LABELS = {
    draft: 'Draft',
    finalised: 'Finalised',
    'no status': 'No status',
}

export const APPOINTMENT_STATUS_PILL_STYLES = {
    draft: 'border-amber-200 bg-amber-50 text-amber-700',
    finalised: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    'no status': 'border-gray-200 bg-gray-50 text-gray-600',
}

export const NO_APPOINTMENT_TIME_LABEL = 'No time set'

// The external export uses free text for this column ("Finalised", "Draft",
// "No status"), so collapse anything else onto the "no status" bucket.
export function normalizeAppointmentStatusKey(value) {
    const text = String(value === null || value === undefined ? '' : value).trim().toLowerCase()
    if (!text) return 'no status'
    if (text.startsWith('final')) return 'finalised'
    if (text.startsWith('draft')) return 'draft'
    return 'no status'
}

export function getAppointmentStatusLabel(value) {
    const text = String(value === null || value === undefined ? '' : value).trim()
    if (!text) return APPOINTMENT_STATUS_LABELS['no status']

    const key = text.toLowerCase()
    if (key.startsWith('final')) return APPOINTMENT_STATUS_LABELS.finalised
    if (key.startsWith('draft')) return APPOINTMENT_STATUS_LABELS.draft
    if (key === 'no status' || key === 'none') return APPOINTMENT_STATUS_LABELS['no status']
    // Anything else is external text we don't recognise — show it as-is rather
    // than pretending it is "No status".
    return text
}

export function getAppointmentStatusPillStyle(value) {
    return APPOINTMENT_STATUS_PILL_STYLES[normalizeAppointmentStatusKey(value)]
        || APPOINTMENT_STATUS_PILL_STYLES['no status']
}

// ---------------------------------------------------------------------------
// Dates and durations
// ---------------------------------------------------------------------------

export function toAppointmentDate(value) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

export function formatAppointmentDateTime(value, { includeYear = true } = {}) {
    const date = toAppointmentDate(value)
    if (!date) return NO_APPOINTMENT_TIME_LABEL

    return date.toLocaleString(undefined, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        ...(includeYear ? { year: 'numeric' } : {}),
        hour: '2-digit',
        minute: '2-digit',
    })
}

export function formatAppointmentDay(value) {
    const date = toAppointmentDate(value)
    if (!date) return NO_APPOINTMENT_TIME_LABEL

    return date.toLocaleDateString(undefined, {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
    })
}

export function formatAppointmentClock(value) {
    const date = toAppointmentDate(value)
    if (!date) return ''

    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatAppointmentTimeRange(startsAt, endsAt) {
    const startLabel = formatAppointmentClock(startsAt)
    if (!startLabel) return NO_APPOINTMENT_TIME_LABEL

    const endLabel = formatAppointmentClock(endsAt)
    return endLabel ? `${startLabel} – ${endLabel}` : startLabel
}

export function formatAppointmentDuration(startsAt, endsAt) {
    const start = toAppointmentDate(startsAt)
    const end = toAppointmentDate(endsAt)
    if (!start || !end) return null

    const minutes = Math.round((end.getTime() - start.getTime()) / 60000)
    if (minutes <= 0) return null

    const hours = Math.floor(minutes / 60)
    const remainder = minutes % 60
    if (hours === 0) return `${remainder}m`
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`
}

export function formatAppointmentPrice(row) {
    const rawPrice = row?.price
    if (rawPrice === null || rawPrice === undefined || rawPrice === '') return null

    const amount = `$${toFinite(rawPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    const unit = String(row?.unit || '').trim()
    return unit ? `${amount} / ${unit.toLowerCase()}` : amount
}

// ---------------------------------------------------------------------------
// Ordering / grouping
// ---------------------------------------------------------------------------

function startTimeValue(row) {
    const date = toAppointmentDate(row?.starts_at)
    return date ? date.getTime() : null
}

export function sortAppointmentsByStart(rows, direction = 'asc') {
    const sign = direction === 'desc' ? -1 : 1
    return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
        const leftTime = startTimeValue(left)
        const rightTime = startTimeValue(right)
        if (leftTime === null && rightTime === null) return 0
        if (leftTime === null) return 1
        if (rightTime === null) return -1
        return (leftTime - rightTime) * sign
    })
}

// An appointment stays "upcoming" until it ends, so a session in progress is
// still surfaced as the next one rather than dropping straight into history.
export function isUpcomingAppointment(row, now = new Date()) {
    const start = toAppointmentDate(row?.starts_at)
    const reference = toAppointmentDate(now)
    if (!start || !reference) return false

    const end = toAppointmentDate(row?.ends_at)
    const boundary = end && end.getTime() > start.getTime() ? end : start
    return boundary.getTime() >= reference.getTime()
}

export function splitAppointmentsByTime(rows, now = new Date()) {
    const upcoming = []
    const past = []

    for (const row of Array.isArray(rows) ? rows : []) {
        if (isUpcomingAppointment(row, now)) {
            upcoming.push(row)
        } else {
            past.push(row)
        }
    }

    return {
        upcoming: sortAppointmentsByStart(upcoming, 'asc'),
        past: sortAppointmentsByStart(past, 'desc'),
    }
}

export function buildAppointmentMetrics(rows, now = new Date()) {
    const { upcoming, past } = splitAppointmentsByTime(rows, now)
    const activeUpcoming = upcoming.filter((row) => !row?.archived)
    const activePast = past.filter((row) => !row?.archived)
    let archived = 0
    let missingProgressNote = 0

    for (const row of Array.isArray(rows) ? rows : []) {
        if (row?.archived) archived += 1
        if (!row?.archived && normalizeAppointmentStatusKey(row?.progress_note_status) !== 'finalised') {
            missingProgressNote += 1
        }
    }

    return {
        total: Array.isArray(rows) ? rows.length : 0,
        upcoming: upcoming.length,
        past: past.length,
        archived,
        missingProgressNote,
        // Archived sessions are hidden from the "next"/"last" hints even while
        // they are on screen, otherwise the panel advertises work that is gone.
        nextAppointment: activeUpcoming[0] || null,
        lastAppointment: activePast[0] || null,
        upcomingRows: upcoming,
        pastRows: past,
    }
}

// ---------------------------------------------------------------------------
// Compact one-liners (dashboard card rows and panel summaries)
// ---------------------------------------------------------------------------

export function describeAppointmentSummary(row) {
    const when = formatAppointmentDateTime(row?.starts_at, { includeYear: false })
    const status = String(row?.progress_note_status || '').trim()
        || APPOINTMENT_STATUS_LABELS['no status']
    const service = String(row?.service || '').trim()

    return service ? `${when} • ${status} • ${service}` : `${when} • ${status}`
}
