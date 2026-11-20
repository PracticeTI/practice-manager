// Reminder generation and delivery for appointments.
//
// Email reminders are queued through the existing outbound email queue (the
// `two` worker sends them). SMS is sent directly through Twilio when configured.
// Every send is recorded on `appointment_reminders` so a re-run never duplicates
// a message and failures retry with backoff.

import { queueEmail } from '@/lib/emailQueueClient'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { DEFAULT_TIMEZONE } from '@/lib/scheduling'
import {
    REMINDER_MAX_ATTEMPTS,
    REMINDER_RETRY_MINUTES,
    buildAppointmentActionUrls,
    buildReminderMessage,
    buildReminderSchedule,
    buildReminderSms,
    resolvePatientContact,
} from '@/lib/appointmentMessaging'
import { isSmsConfigured, sendSms } from '@/lib/smsClient'

const DAY_MS = 86400000
const HOUR_MS = 3600000

function toIso(value) {
    if (!value) return null
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function resolveSchedulingSecret() {
    return String(
        process.env.SCHEDULING_CONFIRMATION_SECRET
        || process.env.CALENDAR_FEED_SECRET
        || process.env.JWT_SECRET
        || ''
    ).trim()
}

export function resolvePublicOrigin(origin = '') {
    const explicit = String(origin || '').trim()
    if (explicit) return explicit.replace(/\/+$/, '')
    const configured = String(
        process.env.SCHEDULING_PUBLIC_URL
        || process.env.NEXT_PUBLIC_SITE_URL
        || process.env.NEXT_PUBLIC_BACKEND_URL
        || ''
    ).trim()
    if (configured) return configured.replace(/\/+$/, '')
    // No configured public origin: keep a valid absolute origin so signed action
    // URLs still build. A deployment that sends these links must set
    // SCHEDULING_PUBLIC_URL (or NEXT_PUBLIC_SITE_URL).
    return 'http://localhost:3000'
}

function buildAppointmentContext(row) {
    return {
        id: row.id,
        domain: row.domain,
        patient_id: row.patient_id ?? null,
        patient_name: row.linked_patient_name || row.patient_name || '',
        starts_at: toIso(row.starts_at || row.appointment_starts_at),
        ends_at: toIso(row.ends_at),
        service: row.service || '',
        location: row.location || '',
        practitioner: row.practitioner || '',
        timezone: row.timezone || DEFAULT_TIMEZONE,
        appointment_status: row.appointment_status || 'confirmed',
        confirmation_status: row.confirmation_status || 'pending',
    }
}

async function upsertReminderRow(connection, appointment, item) {
    await connection.query(
        `INSERT INTO appointment_reminders
            (domain, appointment_id, patient_id, kind, channel, offset_hours,
             appointment_starts_at, scheduled_for, status, metadata)
         VALUES ($1, $2, $3, $4, 'auto', $5, $6, $7, 'pending', $8)
         ON CONFLICT (domain, appointment_id, offset_hours) DO UPDATE SET
            kind = EXCLUDED.kind,
            patient_id = EXCLUDED.patient_id,
            appointment_starts_at = EXCLUDED.appointment_starts_at,
            scheduled_for = EXCLUDED.scheduled_for,
            status = CASE
                WHEN appointment_reminders.appointment_starts_at IS DISTINCT FROM EXCLUDED.appointment_starts_at
                THEN 'pending'
                ELSE appointment_reminders.status
            END,
            sent_at = CASE
                WHEN appointment_reminders.appointment_starts_at IS DISTINCT FROM EXCLUDED.appointment_starts_at
                THEN NULL
                ELSE appointment_reminders.sent_at
            END,
            attempts = CASE
                WHEN appointment_reminders.appointment_starts_at IS DISTINCT FROM EXCLUDED.appointment_starts_at
                THEN 0
                ELSE appointment_reminders.attempts
            END,
            error_message = CASE
                WHEN appointment_reminders.appointment_starts_at IS DISTINCT FROM EXCLUDED.appointment_starts_at
                THEN NULL
                ELSE appointment_reminders.error_message
            END,
            updated_at = NOW()`,
        [
            appointment.domain,
            appointment.id,
            appointment.patient_id,
            item.kind,
            item.offsetHours,
            appointment.starts_at,
            item.scheduledFor,
            JSON.stringify({ source: 'appointment-schedule' }),
        ]
    )
}

/**
 * Create or refresh the reminder rows for one appointment.
 * Returns the number of schedule entries considered.
 */
export async function syncReminderRowsForAppointment(connection, appointment, {
    now = new Date(),
    includePast = false,
} = {}) {
    if (!connection || !appointment?.id || !appointment?.domain) return 0

    const active = ['tentative', 'confirmed'].includes(appointment.appointment_status || 'confirmed')
    const startsAt = toIso(appointment.starts_at)
    if (!active || !startsAt) {
        await cancelPendingReminders(connection, {
            domain: appointment.domain,
            appointmentId: appointment.id,
            reason: 'appointment_inactive',
        })
        return 0
    }

    const schedule = buildReminderSchedule({
        startsAt,
        now,
        confirmationStatus: appointment.confirmation_status || 'pending',
        includePast,
        graceMinutes: includePast ? 24 * 60 : 0,
    })

    for (const item of schedule) {
        await upsertReminderRow(connection, { ...appointment, starts_at: startsAt }, item)
    }

    const offsets = schedule.map((item) => item.offsetHours)
    if (offsets.length === 0) {
        await cancelPendingReminders(connection, {
            domain: appointment.domain,
            appointmentId: appointment.id,
            reason: 'no_future_offsets',
        })
    } else {
        await connection.query(
            `UPDATE appointment_reminders
             SET status = 'cancelled', error_message = 'offset no longer applies', updated_at = NOW()
             WHERE domain = $1 AND appointment_id = $2 AND status = 'pending'
               AND NOT (offset_hours = ANY($3::int[]))`,
            [appointment.domain, appointment.id, offsets]
        )
    }

    return schedule.length
}

export async function cancelPendingReminders(connection, { domain, appointmentId, reason = 'cancelled' }) {
    if (!connection || !domain || !appointmentId) return 0
    const result = await connection.query(
        `UPDATE appointment_reminders
         SET status = 'cancelled', error_message = $3, updated_at = NOW()
         WHERE domain = $1 AND appointment_id = $2 AND status = 'pending'`,
        [domain, appointmentId, reason]
    )
    return result.rowCount || 0
}

/**
 * Generate reminders for all upcoming appointments in a domain and cancel rows
 * that no longer apply. Safe to run repeatedly.
 */
export async function ensureRemindersForDomain(connection, {
    domain,
    now = new Date(),
    horizonDays = 30,
} = {}) {
    if (!connection || !domain) return { appointments: 0 }

    const nowIso = toIso(now)
    const horizon = new Date(new Date(now).getTime() + Math.max(1, horizonDays) * DAY_MS).toISOString()

    const result = await connection.query(
        `SELECT a.id, a.domain, a.patient_id, a.patient_name, a.starts_at, a.ends_at,
                a.service, a.location, a.practitioner, a.timezone,
                a.appointment_status, a.confirmation_status
         FROM appointments a
         WHERE a.domain = $1
           AND a.starts_at > $2
           AND a.starts_at <= $3
           AND a.appointment_status IN ('tentative', 'confirmed')
           AND COALESCE(a.archived, FALSE) = FALSE
         ORDER BY a.starts_at`,
        [domain, nowIso, horizon]
    )

    for (const row of result.rows || []) {
        await syncReminderRowsForAppointment(connection, row, {
            now,
            includePast: true,
        })
    }

    await connection.query(
        `UPDATE appointment_reminders r
         SET status = 'cancelled', error_message = 'appointment no longer active', updated_at = NOW()
         FROM appointments a
         WHERE r.domain = $1
           AND r.appointment_id = a.id
           AND r.domain = a.domain
           AND r.status = 'pending'
           AND (
               a.appointment_status NOT IN ('tentative', 'confirmed')
               OR a.starts_at <= $2
               OR COALESCE(a.archived, FALSE) = TRUE
               OR a.confirmation_status IN ('declined', 'reschedule_requested')
           )`,
        [domain, nowIso]
    )

    return { appointments: result.rows?.length || 0 }
}

function actionExpiry(appointment, now) {
    const nowMs = new Date(now).getTime()
    const startsAt = new Date(appointment.starts_at).getTime()
    const candidate = Math.max(nowMs + HOUR_MS, startsAt + HOUR_MS)
    return new Date(Math.min(candidate, nowMs + 30 * DAY_MS)).toISOString()
}

/**
 * Send one reminder/confirmation message for an appointment.
 *
 * Returns { success, skipped, channel, provider, providerMessageId, reason }.
 */
export async function sendAppointmentMessage(connection, {
    appointment,
    contact,
    practiceName,
    kind = 'reminder',
    origin = '',
    now = new Date(),
    channelPreference = 'auto',
    metadata = {},
} = {}) {
    const secret = resolveSchedulingSecret()
    if (!secret) {
        return { success: false, skipped: true, reason: 'signing_secret_not_configured' }
    }

    const email = contact?.email || null
    const phone = contact?.phone || null
    const emailAllowed = channelPreference !== 'sms'
    const smsAllowed = channelPreference !== 'email'

    if (email && emailAllowed) {
        const urls = buildAppointmentActionUrls({
            origin: resolvePublicOrigin(origin),
            domain: appointment.domain,
            appointmentId: appointment.id,
            secret,
            expiresAt: actionExpiry(appointment, now),
        })
        const message = buildReminderMessage({
            appointment,
            patientName: appointment.patient_name,
            practiceName,
            urls,
            kind,
            confirmationStatus: appointment.confirmation_status,
        })
        const queued = await queueEmail(connection, {
            toEmail: email,
            category: 'appointment-reminder',
            subject: message.subject,
            text: message.text,
            html: message.html,
            payload: {
                domain: appointment.domain,
                appointmentId: appointment.id,
                patientId: appointment.patient_id,
                kind,
                confirmationStatus: appointment.confirmation_status,
                ...metadata,
            },
        })
        return { success: true, channel: 'email', ...queued }
    }

    if (phone && smsAllowed && isSmsConfigured()) {
        const urls = buildAppointmentActionUrls({
            origin: resolvePublicOrigin(origin),
            domain: appointment.domain,
            appointmentId: appointment.id,
            secret,
            expiresAt: actionExpiry(appointment, now),
        })
        const body = buildReminderSms({
            appointment,
            practiceName,
            urls,
            kind,
            confirmationStatus: appointment.confirmation_status,
        })
        const sent = await sendSms({ to: phone, body })
        if (sent.success) {
            return {
                success: true,
                channel: 'sms',
                provider: sent.provider,
                providerMessageId: sent.providerMessageId || null,
            }
        }
        return { success: false, channel: 'sms', reason: sent.error || 'sms_failed' }
    }

    if (phone && smsAllowed && !isSmsConfigured()) {
        return { success: false, skipped: true, reason: 'sms_not_configured' }
    }

    return { success: false, skipped: true, reason: 'no_contact_details' }
}

export async function loadAppointmentForMessaging(connection, { domain, appointmentId }) {
    const result = await connection.query(
        `SELECT a.id, a.domain, a.patient_id, a.patient_name, a.starts_at, a.ends_at,
                COALESCE(a.service, s.name) AS service,
                COALESCE(a.location, l.name) AS location,
                COALESCE(a.practitioner, pr.display_name) AS practitioner,
                a.practitioner_id, a.service_id, a.location_id, a.timezone,
                a.appointment_status, a.confirmation_status,
                p.metadata AS patient_metadata, p.patient_name AS linked_patient_name
         FROM appointments a
         LEFT JOIN patients p ON p.id = a.patient_id AND p.domain = a.domain
         LEFT JOIN services s ON s.id = a.service_id AND s.domain = a.domain
         LEFT JOIN practice_locations l ON l.id = a.location_id AND l.domain = a.domain
         LEFT JOIN practitioners pr ON pr.id = a.practitioner_id AND pr.domain = a.domain
         WHERE a.id = $1 AND a.domain = $2
         LIMIT 1`,
        [appointmentId, domain]
    )
    return result.rows?.[0] || null
}

/**
 * Run all due reminders for a domain.
 */
export async function runDueReminders(connection, {
    domain,
    origin = '',
    now = new Date(),
    dryRun = false,
    limit = 100,
} = {}) {
    if (!connection || !domain) {
        return { domain, due: 0, sent: 0, skipped: 0, failed: 0, dryRun }
    }

    const nowIso = toIso(now)
    await ensureRemindersForDomain(connection, { domain, now })

    const due = await connection.query(
        `SELECT r.id AS reminder_id, r.kind, r.offset_hours, r.scheduled_for, r.attempts,
                a.id, a.domain, a.patient_id, a.patient_name, a.starts_at, a.ends_at,
                COALESCE(a.service, s.name) AS service,
                COALESCE(a.location, l.name) AS location,
                COALESCE(a.practitioner, pr.display_name) AS practitioner,
                a.timezone, a.appointment_status, a.confirmation_status,
                p.metadata AS patient_metadata, p.patient_name AS linked_patient_name
         FROM appointment_reminders r
         JOIN appointments a ON a.id = r.appointment_id AND a.domain = r.domain
         LEFT JOIN patients p ON p.id = a.patient_id AND p.domain = a.domain
         LEFT JOIN services s ON s.id = a.service_id AND s.domain = a.domain
         LEFT JOIN practice_locations l ON l.id = a.location_id AND l.domain = a.domain
         LEFT JOIN practitioners pr ON pr.id = a.practitioner_id AND pr.domain = a.domain
         WHERE r.domain = $1
           AND r.status = 'pending'
           AND r.scheduled_for <= $2
           AND a.appointment_status IN ('tentative', 'confirmed')
           AND COALESCE(a.archived, FALSE) = FALSE
         ORDER BY r.scheduled_for
         LIMIT $3`,
        [domain, nowIso, Math.max(1, Math.min(500, Number(limit) || 100))]
    )

    const practiceName = await readDomainPracticeName(domain).catch(() => domain)
    const summary = {
        domain,
        due: due.rows?.length || 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        dryRun: Boolean(dryRun),
        results: [],
    }

    for (const row of due.rows || []) {
        const appointment = buildAppointmentContext(row)
        const contact = resolvePatientContact(row.patient_metadata)

        if (dryRun) {
            summary.results.push({
                reminderId: row.reminder_id,
                appointmentId: row.id,
                contact: { email: Boolean(contact.email), phone: Boolean(contact.phone) },
                planned: true,
            })
            continue
        }

        const result = await sendAppointmentMessage(connection, {
            appointment,
            contact,
            practiceName,
            kind: row.kind,
            origin,
            now,
            metadata: { reminderId: row.reminder_id },
        })

        if (result.success) {
            await connection.query(
                `UPDATE appointment_reminders
                 SET status = 'sent', channel = $2, sent_at = NOW(),
                     provider = $3, provider_message_id = $4,
                     attempts = attempts + 1, error_message = NULL, updated_at = NOW()
                 WHERE id = $1`,
                [
                    row.reminder_id,
                    result.channel,
                    result.provider || null,
                    result.providerMessageId || null,
                ]
            )
            summary.sent += 1
        } else if (result.skipped) {
            await connection.query(
                `UPDATE appointment_reminders
                 SET status = 'skipped', error_message = $2, updated_at = NOW()
                 WHERE id = $1`,
                [row.reminder_id, result.reason || 'skipped']
            )
            summary.skipped += 1
        } else {
            const attempts = Number(row.attempts || 0) + 1
            await connection.query(
                `UPDATE appointment_reminders
                 SET attempts = attempts + 1,
                     status = CASE WHEN attempts + 1 >= $2 THEN 'failed' ELSE 'pending' END,
                     scheduled_for = CASE
                         WHEN attempts + 1 >= $2 THEN scheduled_for
                         ELSE NOW() + ($3 * INTERVAL '1 minute')
                     END,
                     error_message = $4,
                     updated_at = NOW()
                 WHERE id = $1`,
                [
                    row.reminder_id,
                    REMINDER_MAX_ATTEMPTS,
                    REMINDER_RETRY_MINUTES,
                    result.reason || 'send failed',
                ]
            )
            summary.failed += 1
        }

        summary.results.push({
            reminderId: row.reminder_id,
            appointmentId: row.id,
            channel: result.channel || null,
            status: result.success ? 'sent' : result.skipped ? 'skipped' : 'failed',
            reason: result.reason || null,
        })
    }

    return summary
}

/**
 * Send a confirmation request immediately, without waiting for the schedule.
 */
export async function sendConfirmationNow(connection, {
    domain,
    appointmentId,
    origin = '',
    channelPreference = 'auto',
    now = new Date(),
} = {}) {
    const row = await loadAppointmentForMessaging(connection, { domain, appointmentId })
    if (!row) return { success: false, error: 'Appointment not found' }

    const appointment = buildAppointmentContext(row)
    if (!['tentative', 'confirmed'].includes(appointment.appointment_status)) {
        return { success: false, error: 'Only tentative or confirmed appointments can be confirmed' }
    }

    const contact = resolvePatientContact(row.patient_metadata)
    const practiceName = await readDomainPracticeName(domain).catch(() => domain)
    return sendAppointmentMessage(connection, {
        appointment,
        contact,
        practiceName,
        kind: 'confirmation',
        origin,
        now,
        channelPreference,
        metadata: { manual: true },
    })
}
