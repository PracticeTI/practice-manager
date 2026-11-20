// Appointment messaging helpers: reminder schedules, signed confirmation
// links, patient contact extraction and waitlist ranking.
//
// Kept free of `@/` imports and database access so the routes, the reminder
// runner and the tests share the same rules. Only `node:crypto` is used, so this
// module must stay server-side.

import crypto from 'node:crypto'
import { CONFIRMATION_STATUSES } from './scheduling.js'

export { CONFIRMATION_STATUSES }

export const DEFAULT_REMINDER_OFFSETS_HOURS = [168, 72, 24, 2]
export const REMINDER_MAX_ATTEMPTS = 3
export const REMINDER_RETRY_MINUTES = 15

const HOUR_MS = 60 * 60 * 1000

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

function safeMetadata(value) {
    if (!value) return {}
    if (typeof value === 'object') return value
    try {
        const parsed = JSON.parse(String(value))
        return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
        return {}
    }
}

function firstValidEmail(values) {
    for (const value of values) {
        const text = cleanText(value)
        if (!text) continue
        const candidate = text.split(/[\s,;]+/).find((part) => part.includes('@'))
        if (!candidate) continue
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) continue
        return candidate
    }
    return null
}

/**
 * Extract the participant's own email and mobile number from the patient
 * metadata written by the Splose importers. Plan-manager and coordinator
 * addresses are deliberately ignored.
 */
export function resolvePatientContact(metadata) {
    const data = safeMetadata(metadata)
    const splosePatient = data.splosePatient || {}
    const answers = data.sploseAnswers || {}
    const labelled = data.sploseLabelledAnswers || {}

    const email = firstValidEmail([
        splosePatient.email,
        data.email,
        data.patient_email,
        answers.email,
        answers.patient_email,
        labelled['Email Address'],
        labelled['Patient Email'],
    ])

    const phone = [
        splosePatient.mobile_phone,
        splosePatient.phone,
        answers.client_phone,
        answers.patient_phone,
        labelled['Phone Number'],
        labelled['Client Phone'],
        labelled['Mobile Number'],
        data.phone,
        data.mobile,
    ]
        .map((value) => normalizePhone(value))
        .find(Boolean) || null

    return { email, phone }
}

export function normalizePhone(value) {
    let text = cleanText(value).replace(/[^\d+]/g, '')
    if (!text) return null

    if (text.startsWith('+610')) text = `+61${text.slice(4)}`
    if (text.startsWith('0') && text.length === 10) return `+61${text.slice(1)}`
    if (text.startsWith('61') && text.length === 11 && !text.startsWith('+')) return `+${text}`
    return text
}

/** Last nine digits, used to match inbound SMS senders to a patient. */
export function phoneMatchKey(value) {
    const digits = cleanText(value).replace(/\D/g, '')
    return digits.length >= 9 ? digits.slice(-9) : digits || null
}

/**
 * Build the reminder rows for one appointment.
 *
 * The first future offset becomes the confirmation request; earlier offsets are
 * skipped rather than sent late. A declined appointment is not reminded.
 */
export function buildReminderSchedule({
    startsAt,
    now = new Date(),
    offsetsHours = DEFAULT_REMINDER_OFFSETS_HOURS,
    confirmationStatus = 'pending',
    includePast = false,
    graceMinutes = includePast ? 24 * 60 : 0,
} = {}) {
    const start = new Date(startsAt)
    const nowDate = now instanceof Date ? now : new Date(now)
    if (Number.isNaN(start.getTime()) || Number.isNaN(nowDate.getTime())) return []
    if (confirmationStatus === 'declined' || confirmationStatus === 'reschedule_requested') return []

    const offsets = [...new Set((offsetsHours || []).map((value) => Number(value)))]
        .filter((value) => Number.isFinite(value) && value > 0)
        .sort((a, b) => b - a)

    const graceMs = Math.max(0, Number(graceMinutes) || 0) * 60 * 1000
    const earliest = nowDate.getTime() - graceMs

    const schedule = offsets
        .map((offsetHours) => ({
            offsetHours,
            scheduledFor: new Date(start.getTime() - offsetHours * HOUR_MS),
        }))
        .filter((item) => item.scheduledFor.getTime() > earliest)

    const confirmationOffset = confirmationStatus === 'pending' && schedule.length > 0
        ? schedule[0].offsetHours
        : null

    return schedule.map((item, index) => ({
        offsetHours: item.offsetHours,
        scheduledFor: item.scheduledFor.toISOString(),
        kind: confirmationOffset !== null && index === 0 ? 'confirmation' : 'reminder',
    }))
}

// ---------------------------------------------------------------------------
// Signed action links
// ---------------------------------------------------------------------------

function signPayload(payload, secret) {
    return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

function verifySignature(payload, signature, secret) {
    const expected = signPayload(payload, secret)
    const provided = String(signature || '')
    if (provided.length !== expected.length) return false
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
}

function actionToken({ subject, action, expiresAt, secret }) {
    if (!secret) throw new Error('Signing secret is not configured')
    const expires = Math.floor(new Date(expiresAt).getTime() / 1000)
    if (!Number.isFinite(expires)) throw new Error('Invalid token expiry')
    return `${expires}.${signPayload(`${subject}:${action}:${expires}`, secret)}`
}

function verifyActionToken({ token, subject, action, secret, now = new Date() }) {
    if (!secret || !token) return false
    const [expiresText, signature] = String(token).split('.')
    const expires = Number(expiresText)
    if (!Number.isFinite(expires)) return false
    if (expires * 1000 < new Date(now).getTime()) return false
    return verifySignature(`${subject}:${action}:${expires}`, signature, secret)
}

export function buildAppointmentActionToken({ domain, appointmentId, action, expiresAt, secret }) {
    return actionToken({
        subject: `appointment:${domain}:${appointmentId}`,
        action,
        expiresAt,
        secret,
    })
}

export function verifyAppointmentActionToken({
    token,
    domain,
    appointmentId,
    action,
    secret,
    now,
}) {
    return verifyActionToken({
        token,
        subject: `appointment:${domain}:${appointmentId}`,
        action,
        secret,
        now,
    })
}

export function buildWaitlistActionToken({ domain, offerId, action, expiresAt, secret }) {
    return actionToken({
        subject: `waitlist:${domain}:${offerId}`,
        action,
        expiresAt,
        secret,
    })
}

export function verifyWaitlistActionToken({ token, domain, offerId, action, secret, now }) {
    return verifyActionToken({
        token,
        subject: `waitlist:${domain}:${offerId}`,
        action,
        secret,
        now,
    })
}

export function buildAppointmentActionUrls({
    origin,
    domain,
    appointmentId,
    secret,
    expiresAt,
}) {
    const build = (action) => {
        const url = new URL('/api/scheduling/confirm', origin)
        url.searchParams.set('domain', domain)
        url.searchParams.set('appointment_id', String(appointmentId))
        url.searchParams.set('action', action)
        url.searchParams.set('token', buildAppointmentActionToken({
            domain,
            appointmentId,
            action,
            expiresAt,
            secret,
        }))
        return url.toString()
    }

    return {
        confirm: build('confirm'),
        decline: build('decline'),
        reschedule: build('reschedule'),
    }
}

export function buildWaitlistActionUrls({
    origin,
    domain,
    offerId,
    secret,
    expiresAt,
}) {
    const build = (action) => {
        const url = new URL('/api/scheduling/waitlist/offer', origin)
        url.searchParams.set('domain', domain)
        url.searchParams.set('offer_id', String(offerId))
        url.searchParams.set('action', action)
        url.searchParams.set('token', buildWaitlistActionToken({
            domain,
            offerId,
            action,
            expiresAt,
            secret,
        }))
        return url.toString()
    }

    return {
        accept: build('accept'),
        decline: build('decline'),
    }
}

// ---------------------------------------------------------------------------
// Message rendering
// ---------------------------------------------------------------------------

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function formatAppointmentDate(appointment) {
    const timezone = appointment?.timezone || 'Australia/Sydney'
    const start = new Date(appointment?.starts_at)
    if (Number.isNaN(start.getTime())) return { date: '', time: '' }

    return {
        date: new Intl.DateTimeFormat('en-AU', {
            timeZone: timezone,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        }).format(start),
        time: new Intl.DateTimeFormat('en-AU', {
            timeZone: timezone,
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        }).format(start),
    }
}

export function buildReminderMessage({
    appointment,
    patientName,
    practiceName = 'your practice',
    urls,
    kind = 'reminder',
    confirmationStatus = 'pending',
}) {
    const { date, time } = formatAppointmentDate(appointment)
    const firstName = cleanText(patientName).split(/\s+/)[0] || 'there'
    const service = cleanText(appointment?.service) || 'Appointment'
    const practitioner = cleanText(appointment?.practitioner)
    const location = cleanText(appointment?.location)
    const confirmed = confirmationStatus === 'confirmed'

    const subject = confirmed
        ? `Appointment confirmed — ${date}`
        : kind === 'confirmation'
            ? `Please confirm your appointment — ${date}`
            : `Appointment reminder — ${date}`

    const lines = [
        `Hi ${firstName},`,
        '',
        confirmed
            ? `Your appointment with ${practiceName} is confirmed.`
            : `This is a reminder of your appointment with ${practiceName}.`,
        '',
        `${date} at ${time}`,
        service,
        practitioner ? `Practitioner: ${practitioner}` : null,
        location ? `Location: ${location}` : null,
        '',
    ].filter((line) => line !== null)

    if (!confirmed) {
        lines.push(
            `Please confirm here: ${urls.confirm}`,
            `Can't attend? Decline here: ${urls.decline}`,
            `Need a different time? Reschedule here: ${urls.reschedule}`
        )
    } else {
        lines.push(
            `Need a different time? Reschedule here: ${urls.reschedule}`
        )
    }

    const text = lines.join('\n')
    const html = [
        `<p>Hi ${escapeHtml(firstName)},</p>`,
        `<p>${escapeHtml(confirmed
            ? `Your appointment with ${practiceName} is confirmed.`
            : `This is a reminder of your appointment with ${practiceName}.`)}</p>`,
        '<p>',
        `<strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong><br>`,
        `${escapeHtml(service)}<br>`,
        practitioner ? `Practitioner: ${escapeHtml(practitioner)}<br>` : '',
        location ? `Location: ${escapeHtml(location)}` : '',
        '</p>',
        confirmed ? '' : `<p><a href="${escapeHtml(urls.confirm)}">Confirm appointment</a></p>`,
        '<p>',
        `<a href="${escapeHtml(urls.decline)}">Can't attend</a> · `,
        `<a href="${escapeHtml(urls.reschedule)}">Request another time</a>`,
        '</p>',
    ].filter(Boolean).join('')

    return { subject, text, html }
}

export function buildReminderSms({
    appointment,
    practiceName = 'your practice',
    urls,
    kind = 'reminder',
    confirmationStatus = 'pending',
}) {
    const { date, time } = formatAppointmentDate(appointment)
    if (confirmationStatus === 'confirmed') {
        return `${practiceName}: your appointment on ${date} at ${time} is confirmed. Need another time? ${urls.reschedule}`
    }
    const lead = kind === 'confirmation'
        ? `${practiceName}: please confirm your appointment on ${date} at ${time}.`
        : `${practiceName}: reminder for your appointment on ${date} at ${time}.`
    return `${lead} Confirm: ${urls.confirm} Can't attend? ${urls.decline}`
}

export function buildWaitlistOfferMessage({
    entry,
    slot,
    practiceName = 'your practice',
    urls,
}) {
    const { date, time } = formatAppointmentDate(slot)
    const firstName = cleanText(entry?.patient_name).split(/\s+/)[0] || 'there'
    const subject = `A cancelled slot is available — ${date}`
    const text = [
        `Hi ${firstName},`,
        '',
        `A ${cleanText(slot?.service) || 'appointment'} slot has opened at ${practiceName}.`,
        `${date} at ${time}`,
        cleanText(slot?.location) ? `Location: ${slot.location}` : null,
        '',
        `Accept this slot: ${urls.accept}`,
        `No thanks: ${urls.decline}`,
        '',
        'This offer expires in two hours.',
    ].filter((line) => line !== null).join('\n')

    const html = [
        `<p>Hi ${escapeHtml(firstName)},</p>`,
        `<p>A <strong>${escapeHtml(cleanText(slot?.service) || 'appointment')}</strong> slot has opened at ${escapeHtml(practiceName)}.</p>`,
        `<p><strong>${escapeHtml(date)} at ${escapeHtml(time)}</strong>`,
        cleanText(slot?.location) ? `<br>Location: ${escapeHtml(slot.location)}` : '',
        '</p>',
        `<p><a href="${escapeHtml(urls.accept)}">Accept this slot</a></p>`,
        `<p><a href="${escapeHtml(urls.decline)}">No thanks</a></p>`,
        '<p>This offer expires in two hours.</p>',
    ].join('')

    return { subject, text, html }
}

// ---------------------------------------------------------------------------
// Waitlist ranking
// ---------------------------------------------------------------------------

function dateOnly(value) {
    const text = cleanText(value).slice(0, 10)
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function sameId(a, b) {
    return a !== null && a !== undefined && b !== null && b !== undefined
        && Number(a) === Number(b)
}

/**
 * Rank waiting entries for a freed slot. Higher scores win; ties break on the
 * earliest requested date, then on the lowest id so the result is stable.
 */
export function rankWaitlistEntries(entries, slot, { slotDate } = {}) {
    const date = slotDate || dateOnly(slot?.starts_at)

    return (entries || [])
        .filter((entry) => String(entry?.status || 'waiting') === 'waiting')
        .filter((entry) => !entry?.service_id || !slot?.service_id || sameId(entry.service_id, slot.service_id))
        .filter((entry) => {
            if (!date) return true
            const earliest = dateOnly(entry.earliest_date)
            const latest = dateOnly(entry.latest_date)
            if (earliest && date < earliest) return false
            if (latest && date > latest) return false
            return true
        })
        .map((entry) => {
            let score = 0
            if (sameId(entry.service_id, slot?.service_id)) score += 100
            else if (!entry.service_id) score += 20
            if (sameId(entry.practitioner_id, slot?.practitioner_id)) score += 30
            else if (!entry.practitioner_id) score += 10
            if (sameId(entry.location_id, slot?.location_id)) score += 20
            else if (!entry.location_id) score += 5
            score += Number(entry.priority) || 0
            return { entry, score }
        })
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score
            const aDate = dateOnly(a.entry.earliest_date) || '9999-12-31'
            const bDate = dateOnly(b.entry.earliest_date) || '9999-12-31'
            if (aDate !== bDate) return aDate.localeCompare(bDate)
            return Number(a.entry.id) - Number(b.entry.id)
        })
}
