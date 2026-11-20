import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { addDaysToDateString, formatDateInTimeZone } from '@/lib/practitionerAvailability'
import { loadAvailabilitySlots } from '@/lib/schedulingAvailability'
import {
    clientIp,
    consumeRateLimit,
    loadBookingCatalog,
    readBookingSettings,
    resolvePublicBookingDomain,
} from '@/lib/schedulingBooking'

const MAX_SLOTS = 80
const MAX_UNASSIGNED_PRACTITIONERS = 3

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

function parsePositiveInt(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/**
 * GET /api/scheduling/booking/availability
 *
 * Bookable slots for the public page. Only times are exposed — never patients
 * or appointment details.
 */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const domain = resolvePublicBookingDomain(request, searchParams.get('domain'))
        const serviceId = parsePositiveInt(searchParams.get('service_id'))
        const practitionerId = parsePositiveInt(searchParams.get('practitioner_id'))
        if (!serviceId) return jsonError('service_id is required')

        await ensureSchedulingTables()
        connection = await getDatabaseConnection()

        const limited = await consumeRateLimit(connection, {
            bucketKey: `booking-slots:${domain}:${clientIp(request)}`,
            limit: 120,
            windowSeconds: 600,
        })
        if (!limited.allowed) {
            return jsonError('Too many requests. Please try again shortly.', 429)
        }

        const settings = await readBookingSettings(domain)
        if (!settings.enabled) {
            return NextResponse.json({ success: true, data: { enabled: false, slots: [] } })
        }

        const catalog = await loadBookingCatalog(connection, domain)
        const service = catalog.services.find((item) => Number(item.id) === serviceId)
        if (!service) return jsonError('That appointment type is not available', 404)

        const eligible = catalog.practitioners.filter((item) => item.service_ids.includes(serviceId))
        const selected = practitionerId
            ? eligible.filter((item) => item.id === practitionerId)
            : eligible.slice(0, MAX_UNASSIGNED_PRACTITIONERS)
        if (selected.length === 0) {
            return NextResponse.json({ success: true, data: { enabled: true, slots: [], service } })
        }

        const requestedFrom = String(searchParams.get('from') || '').trim()
        const requestedTo = String(searchParams.get('to') || '').trim()

        const slots = []
        for (const practitioner of selected) {
            const timezone = practitioner.timezone || 'Australia/Sydney'
            const today = formatDateInTimeZone(new Date(), timezone)
            const latest = addDaysToDateString(today, Math.min(30, settings.maxAdvanceDays))

            const { availability } = await loadAvailabilitySlots(connection, {
                domain,
                practitioner,
                service,
                from: requestedFrom || today,
                to: requestedTo || latest,
                intervalMinutes: settings.slotIntervalMinutes,
                minNoticeMinutes: settings.minNoticeMinutes,
                maxAdvanceDays: settings.maxAdvanceDays,
                limit: 200,
                syncExternalCalendars: true,
            })

            ;(availability?.slots || []).forEach((slot) => {
                slots.push({
                    starts_at: slot.start,
                    ends_at: slot.end,
                    practitioner_id: practitioner.id,
                    practitioner_name: practitioner.display_name,
                })
            })
        }

        slots.sort((left, right) => new Date(left.starts_at) - new Date(right.starts_at))

        return NextResponse.json({
            success: true,
            data: {
                enabled: true,
                interval_minutes: settings.slotIntervalMinutes,
                min_notice_minutes: settings.minNoticeMinutes,
                max_advance_days: settings.maxAdvanceDays,
                timezone: selected[0].timezone || 'Australia/Sydney',
                service: {
                    id: service.id,
                    name: service.name,
                    duration_minutes: service.duration_minutes,
                },
                slots: slots.slice(0, MAX_SLOTS),
            },
        })
    } catch (error) {
        return jsonError(error?.message || 'Failed to load availability', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
