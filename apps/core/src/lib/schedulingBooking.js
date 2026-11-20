// Persistence for the public booking flow: settings, catalogue, patients,
// appointments and the IP rate limiter used by the public endpoints.

import { getDomainSetting, setDomainSetting } from '@/lib/appSettings'
import { readDomainPracticeName } from '@/lib/domainPracticeName'
import { ensurePatientsImportSchema } from '@/lib/patientsTable'
import { isScheduleConflictError } from '@/lib/schedulingConstraint'
import {
    resolvePublicOrigin,
    resolveSchedulingSecret,
    syncReminderRowsForAppointment,
} from '@/lib/appointmentReminders'
import { queueEmail } from '@/lib/emailQueueClient'
import { buildAppointmentActionUrls, phoneMatchKey } from '@/lib/appointmentMessaging'
import { VALID_DOMAIN_MODES, resolveDomainModeFromHeaders } from '@/lib/domainMode'
import {
    buildBookingConfirmationEmail,
    buildBookingReference,
    defaultBookingSettingsForDomain,
    escapeBookingHtml,
    mergeBookingSettings,
    normalizeBookingDomain,
    normalizeBookingSettings,
} from '@/lib/publicBooking'

function cleanText(value) {
    return String(value === undefined || value === null ? '' : value).trim()
}

export async function readBookingSettings(domain) {
    const key = normalizeBookingDomain(domain)
    if (!key) return normalizeBookingSettings({})
    const entry = await getDomainSetting(key, 'scheduling_booking')
    // Rollout defaults first, then whatever the practice saved.
    return normalizeBookingSettings({ ...defaultBookingSettingsForDomain(key), ...(entry || {}) })
}

export async function saveBookingSettings(domain, patch) {
    const key = normalizeBookingDomain(domain)
    if (!key) throw new Error('A domain is required')

    // Start from the rollout defaults so a partial patch cannot silently turn a
    // domain off just because it had no stored entry yet.
    const stored = await getDomainSetting(key, 'scheduling_booking')
    const current = mergeBookingSettings(defaultBookingSettingsForDomain(key), stored)
    const next = mergeBookingSettings(current, patch)
    await setDomainSetting(key, 'scheduling_booking', next)
    return next
}

/**
 * Public domain for a booking request.
 *
 * The hostname decides the practice in normal use. `?domain=` exists for local
 * development and previews, and is limited to the known domain domains so a
 * request cannot invent a tenant key.
 */
export function resolvePublicBookingDomain(request, requestedDomain) {
    const explicit = normalizeBookingDomain(requestedDomain)
    if (explicit && VALID_DOMAIN_MODES.includes(explicit)) return explicit
    return resolveDomainModeFromHeaders(request.headers)
}



// The limiter and IP helper are shared with the public intake endpoints.
export { clientIp, consumeRateLimit } from '@/lib/rateLimits'

/**
 * Services and practitioners a visitor may book, limited to assignments that
 * actually exist. Nothing here is patient data.
 */
export async function loadBookingCatalog(connection, domain) {
    const [servicesResult, practitionersResult, assignmentsResult, locationsResult, rulesResult, practiceName] =
        await Promise.all([
            connection.query(
                `SELECT id, name, code, duration_minutes, buffer_before_minutes, buffer_after_minutes,
                        price, funding_types, active
                 FROM services
                 WHERE domain = $1 AND COALESCE(active, TRUE) = TRUE
                 ORDER BY name`,
                [domain]
            ),
            connection.query(
                `SELECT id, display_name, timezone, default_location_id, active
                 FROM practitioners
                 WHERE domain = $1 AND COALESCE(active, TRUE) = TRUE
                 ORDER BY display_name`,
                [domain]
            ),
            connection.query(
                'SELECT practitioner_id, service_id FROM practitioner_services WHERE domain = $1',
                [domain]
            ),
            connection.query(
                `SELECT id, name, location_type, suburb, state, timezone, active
                 FROM practice_locations
                 WHERE domain = $1 AND COALESCE(active, TRUE) = TRUE
                 ORDER BY name`,
                [domain]
            ),
            connection.query(
                `SELECT DISTINCT practitioner_id, location_id
                 FROM availability_rules
                 WHERE domain = $1 AND active = TRUE AND location_id IS NOT NULL`,
                [domain]
            ),
            readDomainPracticeName(domain).catch(() => ''),
        ])

    const assignments = assignmentsResult.rows || []
    const servicesById = new Map((servicesResult.rows || []).map((row) => [Number(row.id), row]))
    const serviceIdsByPractitioner = new Map()
    const practitionerIdsByService = new Map()

    assignments.forEach((row) => {
        const practitionerId = Number(row.practitioner_id)
        const serviceId = Number(row.service_id)
        if (!servicesById.has(serviceId)) return

        if (!serviceIdsByPractitioner.has(practitionerId)) serviceIdsByPractitioner.set(practitionerId, new Set())
        serviceIdsByPractitioner.get(practitionerId).add(serviceId)

        if (!practitionerIdsByService.has(serviceId)) practitionerIdsByService.set(serviceId, new Set())
        practitionerIdsByService.get(serviceId).add(practitionerId)
    })

    const locationIdsByPractitioner = new Map()
    ;(rulesResult.rows || []).forEach((row) => {
        const practitionerId = Number(row.practitioner_id)
        if (!locationIdsByPractitioner.has(practitionerId)) locationIdsByPractitioner.set(practitionerId, new Set())
        locationIdsByPractitioner.get(practitionerId).add(Number(row.location_id))
    })

    const services = (servicesResult.rows || [])
        .filter((row) => (practitionerIdsByService.get(Number(row.id)) || new Set()).size > 0)
        .map((row) => ({
            id: Number(row.id),
            name: row.name,
            code: row.code || '',
            duration_minutes: Number(row.duration_minutes) || 60,
            buffer_before_minutes: Number(row.buffer_before_minutes) || 0,
            buffer_after_minutes: Number(row.buffer_after_minutes) || 0,
            price: row.price === null || row.price === undefined ? null : Number(row.price),
            funding_types: Array.isArray(row.funding_types) ? row.funding_types : [],
            practitioner_ids: [...(practitionerIdsByService.get(Number(row.id)) || new Set())],
        }))

    const practitioners = (practitionersResult.rows || [])
        .map((row) => {
            const id = Number(row.id)
            const serviceIds = [...(serviceIdsByPractitioner.get(id) || new Set())]
            if (serviceIds.length === 0) return null
            return {
                id,
                display_name: row.display_name,
                timezone: row.timezone || '',
                default_location_id: row.default_location_id ? Number(row.default_location_id) : null,
                location_ids: [...(locationIdsByPractitioner.get(id) || new Set())],
                service_ids: serviceIds,
            }
        })
        .filter(Boolean)

    return {
        practiceName: practiceName || domain,
        services,
        practitioners,
        locations: (locationsResult.rows || []).map((row) => ({
            id: Number(row.id),
            name: row.name,
            location_type: row.location_type,
            suburb: row.suburb || '',
            state: row.state || '',
            timezone: row.timezone || '',
        })),
    }
}

/**
 * Match an existing patient by email first, then by the last nine phone digits,
 * and fill in any missing contact details. Booking never reveals whether the
 * person was already a patient.
 */
export async function findOrCreateBookingPatient(connection, { domain, name, email, phone }) {
    await ensurePatientsImportSchema()

    const normalizedEmail = cleanText(email).toLowerCase()
    const normalizedPhone = cleanText(phone)
    let patient = null

    if (normalizedEmail) {
        const result = await connection.query(
            `SELECT id, patient_name, metadata
             FROM patients
             WHERE domain = $1
               AND LOWER(COALESCE(metadata->>'email', metadata->'splosePatient'->>'email')) = $2
             ORDER BY id
             LIMIT 1`,
            [domain, normalizedEmail]
        )
        patient = result.rows?.[0] || null
    }

    if (!patient && normalizedPhone) {
        const key = phoneMatchKey(normalizedPhone)
        if (key) {
            const result = await connection.query(
                `SELECT id, patient_name, metadata
                 FROM patients
                 WHERE domain = $1
                   AND RIGHT(REGEXP_REPLACE(COALESCE(
                        metadata->>'phone',
                        metadata->'splosePatient'->>'mobile_phone',
                        metadata->'splosePatient'->>'phone',
                        ''
                   ), '\\D', '', 'g'), 9) = $2
                 ORDER BY id
                 LIMIT 1`,
                [domain, key]
            )
            patient = result.rows?.[0] || null
        }
    }

    const contactPatch = {}
    if (normalizedEmail) contactPatch.email = normalizedEmail
    if (normalizedPhone) contactPatch.phone = normalizedPhone

    if (patient) {
        if (Object.keys(contactPatch).length > 0) {
            await connection.query(
                `UPDATE patients
                 SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
                     updated_at = NOW()
                 WHERE id = $1 AND domain = $3`,
                [patient.id, JSON.stringify(contactPatch), domain]
            )
        }
        return { id: Number(patient.id), patientName: patient.patient_name, created: false }
    }

    const metadata = { ...contactPatch, source: 'public_booking', bookingCreatedAt: new Date().toISOString() }
    const inserted = await connection.query(
        `INSERT INTO patients (patient_name, domain, metadata, external_source)
         VALUES ($1, $2, $3::jsonb, 'public_booking')
         RETURNING id, patient_name`,
        [name, domain, JSON.stringify(metadata)]
    )
    const row = inserted.rows?.[0]
    return { id: Number(row?.id), patientName: row?.patient_name || name, created: true }
}

/**
 * Create the appointment for a public booking.
 *
 * Runs in a transaction so a taken slot cannot leave an orphan patient behind.
 * The exclusion constraint added in Phase 0 is still the final authority on
 * double booking.
 */
export async function createPublicBooking(connection, {
    domain,
    patientName,
    email,
    phone,
    service,
    practitioner,
    location,
    startsAt,
    endsAt,
    notes,
}) {
    await connection.query('BEGIN')
    let appointmentId = null
    try {
        const patient = await findOrCreateBookingPatient(connection, {
            domain,
            name: patientName,
            email,
            phone,
        })

        const inserted = await connection.query(
            `INSERT INTO appointments (
                domain, patient_id, patient_name,
                practitioner, practitioner_id, service, service_id, location, location_id,
                starts_at, ends_at, appointment_status, booking_source, booked_by,
                confirmation_status, timezone, notes
             ) VALUES (
                $1, $2, $3,
                $4, $5, $6, $7, $8, $9,
                $10, $11, 'confirmed', 'public', $12,
                'not_required', $13, $14
             ) RETURNING id`,
            [
                domain,
                patient.id,
                patient.patientName || patientName,
                practitioner?.display_name || null,
                practitioner?.id || null,
                service.name,
                service.id,
                location?.name || null,
                location?.id || null,
                startsAt,
                endsAt,
                cleanText(email) || cleanText(phone) || 'online',
                practitioner?.timezone || service.timezone || 'Australia/Sydney',
                cleanText(notes) || null,
            ]
        )
        appointmentId = Number(inserted.rows?.[0]?.id)
        await connection.query('COMMIT')
        return { id: appointmentId, patientId: patient.id, reference: buildBookingReference(appointmentId) }
    } catch (error) {
        await connection.query('ROLLBACK').catch(() => { })
        throw error
    }
}

/** Manage links stay valid until an hour after the appointment, capped at 30 days. */
export function bookingManageExpiry(startsAt, now = new Date()) {
    const nowMs = now.getTime()
    const startMs = new Date(startsAt).getTime()
    const candidate = Math.max(nowMs + 60 * 60 * 1000, Number.isFinite(startMs) ? startMs + 60 * 60 * 1000 : 0)
    return new Date(Math.min(candidate, nowMs + 30 * 24 * 60 * 60 * 1000)).toISOString()
}

function bookingActionUrls({ domain, appointmentId, startsAt, origin }) {
    const secret = resolveSchedulingSecret()
    if (!secret) return {}
    const urls = buildAppointmentActionUrls({
        origin: resolvePublicOrigin(origin),
        domain,
        appointmentId,
        secret,
        expiresAt: bookingManageExpiry(startsAt),
    })
    return { manageUrl: urls.reschedule, cancelUrl: urls.decline }
}

export async function sendBookingConfirmation(connection, { domain, booking, origin = '' }) {
    if (!booking?.email) return { sent: false, reason: 'no_email' }
    const practiceName = await readDomainPracticeName(domain).catch(() => domain)
    const actions = bookingActionUrls({
        domain,
        appointmentId: booking.id,
        startsAt: booking.startsAt,
        origin,
    })
    const message = buildBookingConfirmationEmail({
        booking: {
            ...booking,
            ...actions,
            reference: booking.reference || buildBookingReference(booking.id),
        },
        practiceName,
    })

    try {
        const queued = await queueEmail(connection, {
            toEmail: booking.email,
            category: 'booking-confirmation',
            subject: message.subject,
            text: message.text,
            html: message.html,
            payload: {
                domain,
                appointmentId: booking.id,
                patientId: booking.patientId,
                reference: booking.reference,
                manageLinks: Boolean(actions.manageUrl),
            },
        })
        return { sent: true, ...queued }
    } catch (error) {
        return { sent: false, reason: error?.message || 'queue_failed' }
    }
}

/** Tell the practice about a new online booking. Silently skipped until an address is configured. */
export async function sendBookingNotification(connection, { domain, booking, settings }) {
    const toEmail = String(settings?.notificationEmail || '').trim()
    if (!toEmail) return { sent: false, reason: 'not_configured' }

    const reference = booking.reference || buildBookingReference(booking.id)
    const lines = [
        `New online booking ${reference}.`,
        '',
        `When: ${booking.timeLabel || booking.startsAt}`,
        `Appointment: ${booking.serviceName}`,
        booking.practitionerName ? `Practitioner: ${booking.practitionerName}` : '',
        `Patient: ${booking.patientName}`,
        booking.email ? `Email: ${booking.email}` : '',
        booking.phone ? `Mobile: ${booking.phone}` : '',
        booking.notes ? `Notes: ${booking.notes}` : '',
    ].filter(Boolean)

    try {
        const queued = await queueEmail(connection, {
            toEmail,
            category: 'booking-notification',
            subject: `New online booking — ${reference}`,
            text: lines.join('\n'),
            html: lines.map((line) => (line ? `<p>${escapeBookingHtml(line)}</p>` : '<br/>')).join(''),
            payload: {
                domain,
                appointmentId: booking.id,
                patientId: booking.patientId,
                reference,
            },
        })
        return { sent: true, ...queued }
    } catch (error) {
        return { sent: false, reason: error?.message || 'queue_failed' }
    }
}

export async function scheduleBookingReminders(connection, { domain, id, patientId, patientName, startsAt }) {
    try {
        await syncReminderRowsForAppointment(connection, {
            id,
            domain,
            patient_id: patientId,
            patient_name: patientName,
            starts_at: startsAt,
            appointment_status: 'confirmed',
            confirmation_status: 'not_required',
        })
        return true
    } catch (error) {
        console.warn('Failed to schedule booking reminders:', error?.message || error)
        return false
    }
}

export { isScheduleConflictError }
