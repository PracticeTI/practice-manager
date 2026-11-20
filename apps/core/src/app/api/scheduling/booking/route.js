import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { loadAvailabilitySlots } from '@/lib/schedulingAvailability'
import { buildBookingReference, formatBookingWindow, validateBookingRequest } from '@/lib/publicBooking'
import { resolveRequestOrigin } from '@/lib/calendarOAuth'
import {
    clientIp,
    consumeRateLimit,
    createPublicBooking,
    isScheduleConflictError,
    loadBookingCatalog,
    readBookingSettings,
    resolvePublicBookingDomain,
    scheduleBookingReminders,
    sendBookingConfirmation,
    sendBookingNotification,
} from '@/lib/schedulingBooking'

const SLOT_NOT_AVAILABLE = 'That time is no longer available. Please choose another time.'
const SLOT_LOOKUP_WINDOW_MS = 12 * 60 * 60 * 1000

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

function practitionersForService(catalog, serviceId) {
    return catalog.practitioners.filter((practitioner) => practitioner.service_ids.includes(Number(serviceId)))
}

function resolveLocation(catalog, practitioner, requestedLocationId) {
    const byId = new Map(catalog.locations.map((location) => [Number(location.id), location]))
    const requested = Number(requestedLocationId)
    if (requested && byId.has(requested)) return byId.get(requested)

    const preferred = Number(practitioner?.default_location_id) || 0
    if (preferred && byId.has(preferred)) return byId.get(preferred)

    const ruleLocation = (practitioner?.location_ids || []).map(Number).find((id) => byId.has(id))
    if (ruleLocation) return byId.get(ruleLocation)

    return catalog.locations[0] || null
}

/** The availability engine is the authority on whether a requested start is real. */
async function findSlotOwner(connection, { domain, service, practitioners, startsAt, settings }) {
    const target = new Date(startsAt).getTime()
    const from = new Date(target - SLOT_LOOKUP_WINDOW_MS).toISOString()
    const to = new Date(target + SLOT_LOOKUP_WINDOW_MS).toISOString()

    for (const practitioner of practitioners) {
        const { availability } = await loadAvailabilitySlots(connection, {
            domain,
            practitioner,
            service,
            from,
            to,
            intervalMinutes: settings.slotIntervalMinutes,
            minNoticeMinutes: settings.minNoticeMinutes,
            maxAdvanceDays: settings.maxAdvanceDays,
            limit: 200,
        })
        const match = (availability?.slots || []).find(
            (slot) => new Date(slot.start).getTime() === target
        )
        if (match) return { practitioner, slot: match }
    }

    return null
}

/**
 * GET /api/scheduling/booking
 *
 * Public booking catalogue. `enabled` says whether this domain accepts online
 * bookings; the rest is the non-sensitive list of bookable services.
 */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const domain = resolvePublicBookingDomain(request, searchParams.get('domain'))

        await ensureSchedulingTables()
        connection = await getDatabaseConnection()

        const settings = await readBookingSettings(domain)
        const catalog = await loadBookingCatalog(connection, domain)

        return NextResponse.json({
            success: true,
            data: {
                domain,
                enabled: settings.enabled,
                practice: {
                    name: catalog.practiceName,
                    timezone: catalog.practitioners[0]?.timezone || 'Australia/Sydney',
                },
                settings: {
                    minNoticeMinutes: settings.minNoticeMinutes,
                    maxAdvanceDays: settings.maxAdvanceDays,
                    slotIntervalMinutes: settings.slotIntervalMinutes,
                    introText: settings.introText,
                    contactNote: settings.contactNote,
                    requireConsent: settings.requireConsent,
                },
                services: catalog.services.map((service) => ({
                    id: service.id,
                    name: service.name,
                    duration_minutes: service.duration_minutes,
                    price: service.price,
                    practitioner_ids: service.practitioner_ids,
                })),
                practitioners: catalog.practitioners.map((practitioner) => ({
                    id: practitioner.id,
                    display_name: practitioner.display_name,
                    service_ids: practitioner.service_ids,
                })),
                locations: catalog.locations,
            },
        })
    } catch (error) {
        return jsonError(error?.message || 'Failed to load booking options', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/**
 * POST /api/scheduling/booking
 *
 * Creates a native appointment for a visitor. The requested time is
 * re-validated against the availability engine, so a caller cannot book outside
 * published hours even though the slot list is generated client-side.
 */
export async function POST(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const domain = resolvePublicBookingDomain(request, payload?.domain)
        const { values, errors } = validateBookingRequest(payload)

        if (errors.length > 0) {
            return jsonError(errors[0], 400)
        }

        await ensureSchedulingTables()
        connection = await getDatabaseConnection()

        const limited = await consumeRateLimit(connection, {
            bucketKey: `booking:${domain}:${clientIp(request)}`,
            limit: 6,
            windowSeconds: 3600,
        })
        if (!limited.allowed) {
            return jsonError('Too many booking attempts. Please call the practice instead.', 429)
        }

        const settings = await readBookingSettings(domain)
        if (!settings.enabled) {
            return jsonError('Online booking is not available for this practice', 403)
        }
        if (settings.requireConsent && !values.consent) {
            return jsonError('Please agree to be contacted about this booking', 400)
        }

        const catalog = await loadBookingCatalog(connection, domain)
        const service = catalog.services.find((item) => Number(item.id) === Number(values.serviceId))
        if (!service) return jsonError('That appointment type is not available', 400)

        const eligible = practitionersForService(catalog, service.id)
        if (eligible.length === 0) {
            return jsonError('No practitioner is available for that appointment type', 409)
        }

        const requestedPractitioner = values.practitionerId
            ? eligible.find((practitioner) => practitioner.id === values.practitionerId)
            : null
        if (values.practitionerId && !requestedPractitioner) {
            return jsonError('That practitioner is not available for this appointment type', 400)
        }

        const owner = await findSlotOwner(connection, {
            domain,
            service,
            practitioners: requestedPractitioner ? [requestedPractitioner] : eligible,
            startsAt: values.startsAt,
            settings,
        })
        if (!owner) return jsonError(SLOT_NOT_AVAILABLE, 409)

        const location = resolveLocation(catalog, owner.practitioner, values.locationId)
        const booking = await createPublicBooking(connection, {
            domain,
            patientName: values.patientName,
            email: values.email,
            phone: values.phone,
            service,
            practitioner: owner.practitioner,
            location,
            startsAt: owner.slot.start,
            endsAt: owner.slot.end,
            notes: values.notes,
        })

        const timeLabel = formatBookingWindow({
            startsAt: owner.slot.start,
            endsAt: owner.slot.end,
            timezone: owner.practitioner.timezone,
        })

        await scheduleBookingReminders(connection, {
            domain,
            id: booking.id,
            patientId: booking.patientId,
            patientName: values.patientName,
            startsAt: owner.slot.start,
        })

        const origin = resolveRequestOrigin(request)
        const bookingSummary = {
            id: booking.id,
            patientId: booking.patientId,
            reference: booking.reference || buildBookingReference(booking.id),
            startsAt: owner.slot.start,
            timeLabel,
            serviceName: service.name,
            practitionerName: owner.practitioner.display_name,
            locationName: location?.name || '',
        }

        const confirmation = await sendBookingConfirmation(connection, {
            domain,
            origin,
            booking: { ...bookingSummary, email: values.email },
        })

        await sendBookingNotification(connection, {
            domain,
            settings,
            booking: {
                ...bookingSummary,
                patientName: values.patientName,
                email: values.email,
                phone: values.phone,
                notes: values.notes,
            },
        })

        return NextResponse.json({
            success: true,
            data: {
                id: booking.id,
                reference: booking.reference,
                starts_at: owner.slot.start,
                ends_at: owner.slot.end,
                time_label: timeLabel,
                timezone: owner.practitioner.timezone || 'Australia/Sydney',
                service: { id: service.id, name: service.name },
                practitioner: {
                    id: owner.practitioner.id,
                    display_name: owner.practitioner.display_name,
                },
                location: location ? { id: location.id, name: location.name } : null,
                confirmation_email: confirmation.sent === true,
            },
        }, { status: 201 })
    } catch (error) {
        if (isScheduleConflictError(error)) {
            return jsonError(SLOT_NOT_AVAILABLE, 409)
        }
        return jsonError(error?.message || 'Failed to create booking', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
