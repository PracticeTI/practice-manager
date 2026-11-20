// Read-only ICS feed for appointments.
//
// Calendar clients cannot send the admin bearer token, so feed URLs carry an
// HMAC token scoped to one domain (and optionally one practitioner). The feed
// is privacy-first: event summaries use patient initials plus the appointment
// id rather than the full patient name.

import crypto from 'node:crypto'

const FEED_PATH = '/api/calendar/feed'
const MAX_FEED_DAYS = 366

export function getCalendarFeedSecret() {
    return String(process.env.CALENDAR_FEED_SECRET || process.env.JWT_SECRET || '').trim()
}

export function normalizeFeedDomain(value) {
    return String(value || '').trim().toLowerCase()
}

function tokenPayload({ domain, practitionerId }) {
    return `${normalizeFeedDomain(domain)}:${practitionerId || 'all'}`
}

export function buildCalendarFeedToken({ domain, practitionerId = null, secret = getCalendarFeedSecret() }) {
    if (!secret) throw new Error('Calendar feed secret is not configured')
    return crypto
        .createHmac('sha256', secret)
        .update(tokenPayload({ domain, practitionerId }))
        .digest('base64url')
}

export function verifyCalendarFeedToken({
    domain,
    practitionerId = null,
    token,
    secret = getCalendarFeedSecret(),
}) {
    if (!secret || !token) return false
    const expected = buildCalendarFeedToken({ domain, practitionerId, secret })
    const provided = String(token)
    if (provided.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

export function buildCalendarFeedUrl({
    origin,
    domain,
    practitionerId = null,
    secret = getCalendarFeedSecret(),
}) {
    const url = new URL(FEED_PATH, origin)
    url.searchParams.set('domain', normalizeFeedDomain(domain))
    if (practitionerId) url.searchParams.set('practitioner_id', String(practitionerId))
    url.searchParams.set('token', buildCalendarFeedToken({ domain, practitionerId, secret }))
    return url.toString()
}

export function patientInitials(name) {
    const words = String(name || '').trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) return ''
    if (words.length === 1) return `${words[0][0].toUpperCase()}.`
    return `${words[0][0].toUpperCase()}.${words[words.length - 1][0].toUpperCase()}.`
}

export function escapeIcsText(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n')
}

/** Fold a content line at 75 octets, using a single leading space on continuations. */
export function foldIcsLine(line) {
    const text = String(line)
    // 74 content octets leaves room for the leading space on continuation lines.
    const maxOctets = 74
    if (Buffer.byteLength(text) <= maxOctets) return text

    const chunks = []
    let current = ''
    let currentBytes = 0

    for (const char of text) {
        const bytes = Buffer.byteLength(char)
        if (currentBytes + bytes > maxOctets) {
            chunks.push(current)
            current = char
            currentBytes = bytes
        } else {
            current += char
            currentBytes += bytes
        }
    }
    chunks.push(current)

    return chunks.join('\r\n ')
}

function icsUtc(value) {
    const date = value instanceof Date ? value : new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function icsStatus(status) {
    const normalized = String(status || '').toLowerCase()
    if (normalized === 'cancelled') return 'CANCELLED'
    if (normalized === 'tentative') return 'TENTATIVE'
    return 'CONFIRMED'
}

function humanizeDomain(domain) {
    const text = normalizeFeedDomain(domain)
    if (!text) return 'Practice'
    return text
        .split(/[-_]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

export function serializeCalendarFeed({
    domain,
    appointments = [],
    timezone = 'Australia/Sydney',
    now = new Date(),
} = {}) {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Practice Manager//Scheduling//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        `X-WR-CALNAME:${escapeIcsText(`${humanizeDomain(domain)} Appointments`)}`,
        `X-WR-TIMEZONE:${escapeIcsText(timezone)}`,
        'REFRESH-INTERVAL;VALUE=DURATION:PT15M',
        'X-PUBLISHED-TTL:PT15M',
    ]

    const stamp = icsUtc(now)

    for (const appointment of appointments || []) {
        const start = icsUtc(appointment?.starts_at)
        const end = icsUtc(appointment?.ends_at)
        if (!start || !end) continue

        const initials = patientInitials(appointment.patient_name)
        const label = appointment.service
            ? `${appointment.service} — ${initials || `#${appointment.id}`}`
            : `Appointment — ${initials || `#${appointment.id}`}`

        const description = [
            appointment.service ? `Service: ${appointment.service}` : null,
            appointment.location ? `Location: ${appointment.location}` : null,
            appointment.appointment_status ? `Status: ${appointment.appointment_status}` : null,
        ].filter(Boolean).join('\n')

        lines.push('BEGIN:VEVENT')
        lines.push(`UID:appointment-${appointment.id}@${normalizeFeedDomain(domain)}.scheduling`)
        lines.push(`DTSTAMP:${stamp}`)
        lines.push(`DTSTART:${start}`)
        lines.push(`DTEND:${end}`)
        lines.push(`SUMMARY:${escapeIcsText(label)}`)
        if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
        if (appointment.location) lines.push(`LOCATION:${escapeIcsText(appointment.location)}`)
        lines.push(`STATUS:${icsStatus(appointment.appointment_status)}`)
        lines.push('TRANSP:OPAQUE')
        lines.push('SEQUENCE:0')
        lines.push('END:VEVENT')
    }

    lines.push('END:VCALENDAR')
    return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

export function clampFeedRange({ from = null, to = null, now = new Date() } = {}) {
    const nowMs = now instanceof Date ? now.getTime() : Date.now()
    const defaultStart = nowMs - 30 * 86400000
    const defaultEnd = nowMs + 180 * 86400000

    const startMs = from ? new Date(from).getTime() : defaultStart
    const endMs = to ? new Date(to).getTime() : defaultEnd
    const safeStart = Number.isNaN(startMs) ? defaultStart : startMs
    const safeEnd = Number.isNaN(endMs) ? defaultEnd : endMs
    const cappedEnd = Math.min(safeEnd, safeStart + MAX_FEED_DAYS * 86400000)

    return {
        from: new Date(Math.min(safeStart, cappedEnd)).toISOString(),
        to: new Date(cappedEnd).toISOString(),
    }
}
