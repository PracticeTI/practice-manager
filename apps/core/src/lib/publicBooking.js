// Public booking rules shared by the booking API, the AI scheduling agent and
// the tests. Pure module: no Next/DB imports so `node --test` can exercise it.

import { normalizePhone } from './appointmentMessaging.js'
import { getPrivateDomainFieldMap } from './domainExtension.js'

export const DEFAULT_BOOKING_SETTINGS = {
    enabled: false,
    minNoticeMinutes: 120,
    maxAdvanceDays: 60,
    slotIntervalMinutes: 30,
    introText: '',
    contactNote: '',
    requireConsent: true,
    notificationEmail: '',
}

/**
 * Per-domain rollout defaults.
 *
 * These decide what a domain does before anyone touches the admin panel, so a
 * fresh environment behaves like the intended rollout instead of depending on
 * whatever a previous local run stored. Stored settings still win.
 */
export const BOOKING_SETTINGS_DEFAULTS_BY_DOMAIN = {
    ...getPrivateDomainFieldMap('bookingDefaults'),
}

export const TIME_OF_DAY_WINDOWS = {
    morning: [0, 12],
    afternoon: [12, 17],
    evening: [17, 24],
}

const MAX_NOTICE_MINUTES = 10080
const MAX_ADVANCE_DAYS = 180
const MAX_TEXT_LENGTH = 600
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function clampInt(value, { fallback, min, max }) {
    const parsed = Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
}

function clampText(value, maxLength = MAX_TEXT_LENGTH) {
    return cleanText(value).slice(0, maxLength)
}

/** Domain keys are public identifiers, so only normalise them, never trust the case. */
export function normalizeBookingDomain(value) {
    const normalized = cleanText(value).toLowerCase()
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized)) return ''
    return normalized
}

export function normalizeBookingSettings(raw) {
    const data = raw && typeof raw === 'object' ? raw : {}
    return {
        enabled: data.enabled === true,
        minNoticeMinutes: clampInt(data.minNoticeMinutes, {
            fallback: DEFAULT_BOOKING_SETTINGS.minNoticeMinutes,
            min: 0,
            max: MAX_NOTICE_MINUTES,
        }),
        maxAdvanceDays: clampInt(data.maxAdvanceDays, {
            fallback: DEFAULT_BOOKING_SETTINGS.maxAdvanceDays,
            min: 1,
            max: MAX_ADVANCE_DAYS,
        }),
        slotIntervalMinutes: clampInt(data.slotIntervalMinutes, {
            fallback: DEFAULT_BOOKING_SETTINGS.slotIntervalMinutes,
            min: 5,
            max: 120,
        }),
        introText: clampText(data.introText),
        contactNote: clampText(data.contactNote, 300),
        requireConsent: data.requireConsent !== false,
        notificationEmail: normalizeNotificationEmail(data.notificationEmail),
    }
}

function normalizeNotificationEmail(value) {
    const text = cleanText(value).toLowerCase().slice(0, 180)
    return text && EMAIL_PATTERN.test(text) ? text : ''
}

/** Rollout defaults for a domain, before any stored override is applied. */
export function defaultBookingSettingsForDomain(domain) {
    const key = normalizeBookingDomain(domain)
    return normalizeBookingSettings(BOOKING_SETTINGS_DEFAULTS_BY_DOMAIN[key] || {})
}

export function mergeBookingSettings(current, patch) {
    const base = normalizeBookingSettings(current)
    const next = patch && typeof patch === 'object' ? patch : {}
    return normalizeBookingSettings({ ...base, ...next })
}

/** Human-facing booking reference. Appointments already have an id; this is the readable form. */
export function buildBookingReference(appointmentId) {
    const id = Number(appointmentId)
    if (!Number.isFinite(id) || id <= 0) return ''
    return `BK-${String(Math.floor(id)).padStart(4, '0')}`
}

/**
 * Validate a public booking submission.
 *
 * `company_website` is a honeypot: real visitors never see the field, so a value
 * there is reported as spam instead of an ordinary validation error.
 */
export function validateBookingRequest(payload) {
    const data = payload && typeof payload === 'object' ? payload : {}
    const errors = []

    if (cleanText(data.company_website)) {
        return { errors: ['spam'], values: null }
    }

    const patientName = clampText(data.patient_name ?? data.patientName, 120)
    if (patientName.length < 2) errors.push('Please enter your full name')

    const rawEmail = cleanText(data.email).toLowerCase()
    if (rawEmail && !EMAIL_PATTERN.test(rawEmail)) errors.push('Please enter a valid email address')

    const rawPhone = cleanText(data.phone)
    const phone = rawPhone ? normalizePhone(rawPhone) : ''
    if (rawPhone && (!phone || phone.replace(/\D/g, '').length < 8)) {
        errors.push('Please enter a valid mobile number')
    }
    if (!rawEmail && !phone) errors.push('Enter an email address or mobile number so we can confirm')

    const serviceId = clampInt(data.service_id ?? data.serviceId, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER })
    if (!serviceId) errors.push('Choose an appointment type')

    const practitionerId = clampInt(data.practitioner_id ?? data.practitionerId, {
        fallback: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
    })
    const locationId = clampInt(data.location_id ?? data.locationId, {
        fallback: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
    })

    const startsAtText = cleanText(data.starts_at ?? data.startsAt)
    const startsAt = startsAtText ? new Date(startsAtText) : null
    if (!startsAt || Number.isNaN(startsAt.getTime())) errors.push('Choose an appointment time')

    const consent = data.consent === true || data.consent === 'true' || data.consent === 'on'

    return {
        errors,
        values: {
            patientName,
            email: rawEmail || '',
            phone: phone || '',
            serviceId,
            practitionerId: practitionerId || null,
            locationId: locationId || null,
            startsAt: startsAt && !Number.isNaN(startsAt.getTime()) ? startsAt.toISOString() : '',
            notes: clampText(data.notes, 1000),
            consent,
        },
    }
}

function normalizeDateString(value) {
    const text = cleanText(value).slice(0, 10)
    return DATE_PATTERN.test(text) ? text : ''
}

function addDaysToDateString(dateString, days) {
    const match = DATE_PATTERN.exec(dateString)
    if (!match) return dateString
    const date = new Date(`${dateString}T00:00:00.000Z`)
    date.setUTCDate(date.getUTCDate() + days)
    return date.toISOString().slice(0, 10)
}

function compareDateStrings(left, right) {
    return String(left).localeCompare(String(right))
}

function findService(raw, services) {
    const id = clampInt(raw?.service_id ?? raw?.serviceId, { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER })
    if (id) {
        const byId = services.find((service) => Number(service.id) === id)
        if (byId) return byId
    }

    const name = cleanText(raw?.service_name ?? raw?.serviceName).toLowerCase()
    if (!name) return null

    return services.find((service) => {
        const candidate = cleanText(service.name).toLowerCase()
        return candidate === name || candidate.includes(name) || name.includes(candidate)
    }) || null
}

function findPractitioner(raw, practitioners) {
    const id = clampInt(raw?.practitioner_id ?? raw?.practitionerId, {
        fallback: 0,
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
    })
    if (id) {
        const byId = practitioners.find((practitioner) => Number(practitioner.id) === id)
        if (byId) return byId
    }

    const name = cleanText(raw?.practitioner_name ?? raw?.practitionerName).toLowerCase()
    if (!name) return null

    return practitioners.find((practitioner) => {
        const candidate = cleanText(practitioner.display_name || practitioner.name).toLowerCase()
        if (!candidate) return false
        if (candidate === name || candidate.includes(name) || name.includes(candidate)) return true
        // "Kate" should match "Kate O'Callaghan".
        return name.split(/\s+/).every((word) => word.length > 2 && candidate.includes(word))
    }) || null
}

export function normalizeTimeOfDay(value) {
    const normalized = cleanText(value).toLowerCase()
    return Object.prototype.hasOwnProperty.call(TIME_OF_DAY_WINDOWS, normalized) ? normalized : 'any'
}

/**
 * Turn whatever the model (or the keyword fallback) produced into a validated
 * intent. Anything the catalogue cannot resolve is dropped with a warning
 * instead of reaching availability with a bad id.
 */
export function normalizeAgentIntent(raw, { services = [], practitioners = [], today, maxAdvanceDays = 60 } = {}) {
    const data = raw && typeof raw === 'object' ? raw : {}
    const warnings = []

    const service = findService(data, services)
    const practitioner = findPractitioner(data, practitioners)

    const requestedService = cleanText(data.service_name ?? data.serviceName) || clampInt(
        data.service_id ?? data.serviceId,
        { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER }
    )
    const requestedPractitioner = cleanText(data.practitioner_name ?? data.practitionerName) || clampInt(
        data.practitioner_id ?? data.practitionerId,
        { fallback: 0, min: 0, max: Number.MAX_SAFE_INTEGER }
    )

    if (!service && requestedService) warnings.push('service_not_found')
    if (!practitioner && requestedPractitioner) warnings.push('practitioner_not_found')
    const todayString = normalizeDateString(today) || new Date().toISOString().slice(0, 10)
    const latestDate = addDaysToDateString(todayString, Math.max(1, Number(maxAdvanceDays) || 60))

    let fromDate = normalizeDateString(data.from_date ?? data.fromDate)
    let toDate = normalizeDateString(data.to_date ?? data.toDate)

    if (!fromDate) fromDate = todayString
    if (compareDateStrings(fromDate, todayString) < 0) fromDate = todayString
    if (compareDateStrings(fromDate, latestDate) > 0) fromDate = latestDate

    if (!toDate) toDate = addDaysToDateString(fromDate, 13)
    if (compareDateStrings(toDate, fromDate) < 0) toDate = addDaysToDateString(fromDate, 13)
    if (compareDateStrings(toDate, latestDate) > 0) toDate = latestDate

    return {
        intent: {
            serviceId: service ? Number(service.id) : null,
            serviceName: service ? cleanText(service.name) : '',
            practitionerId: practitioner ? Number(practitioner.id) : null,
            practitionerName: practitioner ? cleanText(practitioner.display_name || practitioner.name) : '',
            fromDate,
            toDate,
            timeOfDay: normalizeTimeOfDay(data.time_of_day ?? data.timeOfDay),
        },
        warnings,
    }
}

/** Local wall-clock hour for an instant, used to honour "mornings" style requests. */
export function localHourForIso(value, timezone) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    try {
        const formatter = new Intl.DateTimeFormat('en-AU', {
            timeZone: timezone || 'Australia/Sydney',
            hour: '2-digit',
            hour12: false,
        })
        const hour = Number(formatter.format(date))
        return Number.isFinite(hour) ? hour % 24 : null
    } catch {
        return date.getHours()
    }
}

export function localDateKeyForIso(value, timezone) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    try {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone || 'Australia/Sydney',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
        return formatter.format(date)
    } catch {
        return date.toISOString().slice(0, 10)
    }
}

/**
 * Reduce a computed slot list to a short, readable set for the agent: honour the
 * requested part of day, avoid piling every option onto one date, keep order.
 */
export function selectAgentSlots(slots, { timeOfDay = 'any', timezone, limit = 6, maxPerDay = 2 } = {}) {
    const window = TIME_OF_DAY_WINDOWS[normalizeTimeOfDay(timeOfDay)] || null
    const perDay = {}
    const selected = []

    for (const slot of slots || []) {
        const startsAt = slot?.starts_at || slot?.startsAt || slot?.start
        if (!startsAt) continue

        if (window) {
            const hour = localHourForIso(startsAt, timezone)
            if (hour === null || hour < window[0] || hour >= window[1]) continue
        }

        const dayKey = localDateKeyForIso(startsAt, timezone)
        if (!dayKey) continue
        const used = perDay[dayKey] || 0
        if (used >= maxPerDay) continue

        perDay[dayKey] = used + 1
        selected.push(slot)
        if (selected.length >= limit) break
    }

    return selected
}

/**
 * Keyword fallback for the agent when the model is unavailable. Deliberately
 * conservative: it only narrows the search, the availability engine still
 * decides which times exist.
 */
export function parseAgentMessageFallback(message, { services = [], practitioners = [], today } = {}) {
    const text = cleanText(message).toLowerCase()
    const intent = {
        service_name: '',
        practitioner_name: '',
        time_of_day: 'any',
        from_date: '',
        to_date: '',
    }

    let bestService = null
    for (const service of services) {
        const name = cleanText(service.name).toLowerCase()
        if (name && text.includes(name) && (!bestService || name.length > bestService.length)) {
            bestService = name
        }
    }
    if (bestService) intent.service_name = bestService

    for (const practitioner of practitioners) {
        const name = cleanText(practitioner.display_name || practitioner.name).toLowerCase()
        if (!name) continue
        const first = name.split(/\s+/)[0]
        if (text.includes(name) || (first.length > 2 && text.includes(first))) {
            intent.practitioner_name = name
            break
        }
    }

    if (/\bmorning|\bbefore noon|\bam\b/.test(text)) intent.time_of_day = 'morning'
    else if (/\bafternoon|\bpm\b/.test(text)) intent.time_of_day = 'afternoon'
    else if (/\bevening|\bafter work|\bafter 5\b/.test(text)) intent.time_of_day = 'evening'

    const todayString = normalizeDateString(today) || new Date().toISOString().slice(0, 10)
    if (/\btomorrow\b/.test(text)) {
        intent.from_date = addDaysToDateString(todayString, 1)
        intent.to_date = addDaysToDateString(todayString, 1)
    } else if (/\bnext week\b/.test(text)) {
        intent.from_date = addDaysToDateString(todayString, 7)
        intent.to_date = addDaysToDateString(todayString, 13)
    } else if (/\bthis week\b/.test(text)) {
        intent.from_date = todayString
        intent.to_date = addDaysToDateString(todayString, 6)
    } else if (/\bnext month\b/.test(text)) {
        intent.from_date = addDaysToDateString(todayString, 14)
        intent.to_date = addDaysToDateString(todayString, 44)
    }

    return intent
}

export function buildAgentSystemPrompt({ practiceName, services, practitioners, today, maxAdvanceDays }) {
    const serviceList = services.map((service) => `- ${service.name} (id ${service.id})`).join('\n')
    const practitionerList = practitioners
        .map((practitioner) => `- ${practitioner.display_name || practitioner.name} (id ${practitioner.id})`)
        .join('\n')

    return [
        `You are the booking assistant for ${practiceName || 'an occupational therapy practice'}.`,
        'Your only job is to understand which appointment the person wants and when they would like it.',
        'Never give clinical advice and never invent appointment times — availability comes from the practice system.',
        `Today is ${today}. Bookings can be made up to ${maxAdvanceDays} days ahead.`,
        'Appointment types:',
        serviceList || '- (none configured)',
        'Practitioners:',
        practitionerList || '- (no preference)',
        'Reply with a single JSON object and nothing else:',
        '{"service_id": number|null, "service_name": string, "practitioner_id": number|null, "practitioner_name": string, "from_date": "YYYY-MM-DD", "to_date": "YYYY-MM-DD", "time_of_day": "morning"|"afternoon"|"evening"|"any", "reply": string}',
        'The reply is one short, friendly sentence shown to the person; do not include times in it.',
    ].join('\n')
}

/** Extract the first JSON object from a model reply that may be wrapped in prose or fences. */
export function parseAgentJson(text) {
    const raw = cleanText(text)
    if (!raw) return null

    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw)
    const candidate = fenced ? fenced[1] : raw
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start === -1 || end <= start) return null

    try {
        const parsed = JSON.parse(candidate.slice(start, end + 1))
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch {
        return null
    }
}

export function sanitizeAgentHistory(history, maxTurns = 6) {
    if (!Array.isArray(history)) return []
    return history
        .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant'))
        .slice(-maxTurns)
        .map((turn) => ({
            role: turn.role,
            content: clampText(turn.content, 500),
        }))
        .filter((turn) => turn.content.length > 0)
}

/** Human-readable appointment window in the practitioner's timezone. */
export function formatBookingWindow({ startsAt, endsAt, timezone } = {}) {
    const start = new Date(startsAt)
    if (Number.isNaN(start.getTime())) return ''
    const zone = timezone || 'Australia/Sydney'
    const day = new Intl.DateTimeFormat('en-AU', {
        timeZone: zone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    }).format(start)
    const time = new Intl.DateTimeFormat('en-AU', {
        timeZone: zone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(start)
    const end = endsAt ? new Date(endsAt) : null
    if (!end || Number.isNaN(end.getTime())) return `${day} at ${time}`
    const endTime = new Intl.DateTimeFormat('en-AU', {
        timeZone: zone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    }).format(end)
    return `${day}, ${time} – ${endTime}`
}

export function escapeBookingHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

/** Confirmation email body, including the self-service manage links when available. */
export function buildBookingConfirmationEmail({ booking, practiceName }) {
    const when = booking.timeLabel || booking.startsAt
    const lines = [
        `Your appointment with ${practiceName || 'the practice'} is booked.`,
        '',
        `Reference: ${booking.reference}`,
        `When: ${when}`,
        `Appointment: ${booking.serviceName}`,
        booking.practitionerName ? `Practitioner: ${booking.practitionerName}` : '',
        booking.locationName ? `Location: ${booking.locationName}` : '',
        '',
        booking.manageUrl
            ? `Need a different time? ${booking.manageUrl}`
            : 'If you need to change or cancel, reply to this email or call the practice.',
        booking.cancelUrl ? `Cancel this appointment: ${booking.cancelUrl}` : '',
    ].filter(Boolean)

    return {
        subject: `Appointment confirmed — ${booking.reference}`,
        text: lines.join('\n'),
        html: lines.map((line) => `<p>${escapeBookingHtml(line)}</p>`).join(''),
    }
}
