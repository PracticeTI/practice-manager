// Shared availability query + slot generation.
//
// The admin availability endpoint and the public booking endpoints must agree
// on what a bookable slot is, so the database reads and the engine call live
// here instead of being repeated per route.

import { DEFAULT_TIMEZONE } from '@/lib/scheduling'
import { syncStaleConnectionsForPractitioner } from '@/lib/calendarSync'
import {
    addDaysToDateString,
    formatDateInTimeZone,
    generateAvailability,
    parseAvailabilityRangeBound,
} from '@/lib/practitionerAvailability'

const RANGE_PADDING_MS = 4 * 60 * 60 * 1000

/**
 * @param {object} options
 * @param {object} options.practitioner  row with id and timezone
 * @param {object} options.service       row with id, duration and buffers
 * @param {string} options.domain
 * @param {number|null} options.locationId
 * @param {string} options.from          ISO timestamp or YYYY-MM-DD
 * @param {string} options.to            ISO timestamp or YYYY-MM-DD
 */
export async function loadAvailabilitySlots(connection, {
    domain,
    practitioner,
    service,
    locationId = null,
    from,
    to,
    intervalMinutes = 15,
    minNoticeMinutes = 0,
    maxAdvanceDays = 365,
    limit = 200,
    syncExternalCalendars = false,
    now = new Date(),
} = {}) {
    if (!connection || !domain || !practitioner?.id || !service?.id) {
        throw new Error('domain, practitioner and service are required')
    }

    const timezone = practitioner.timezone || DEFAULT_TIMEZONE
    const today = formatDateInTimeZone(now, timezone)
    const fromBound = from || today
    const toBound = to || addDaysToDateString(today, 14)

    const rangeStart = parseAvailabilityRangeBound(fromBound, timezone, { endOfDay: false })
    const rangeEnd = parseAvailabilityRangeBound(toBound, timezone, { endOfDay: true })
    if (rangeStart === null) throw new Error('from must be an ISO timestamp or YYYY-MM-DD')
    if (rangeEnd === null) throw new Error('to must be an ISO timestamp or YYYY-MM-DD')
    if (rangeEnd <= rangeStart) throw new Error('to must be after from')

    if (syncExternalCalendars) {
        // A provider failure is recorded on the connection and never blocks slots.
        await syncStaleConnectionsForPractitioner(connection, {
            domain,
            practitionerId: practitioner.id,
            maxAgeMinutes: 15,
        }).catch(() => { })
    }

    const queryStart = new Date(rangeStart - RANGE_PADDING_MS).toISOString()
    const queryEnd = new Date(rangeEnd + RANGE_PADDING_MS).toISOString()

    const [rulesResult, exceptionsResult, appointmentsResult, servicesResult, externalBusyResult] = await Promise.all([
        connection.query(
            `SELECT id, practitioner_id, location_id, service_id, weekday,
                    start_time, end_time, valid_from, valid_to, rrule, active
             FROM availability_rules
             WHERE domain = $1 AND practitioner_id = $2 AND active = TRUE
             ORDER BY weekday, start_time`,
            [domain, practitioner.id]
        ),
        connection.query(
            `SELECT id, practitioner_id, exception_type, starts_at, ends_at, note
             FROM availability_exceptions
             WHERE domain = $1 AND practitioner_id = $2
               AND starts_at < $4 AND ends_at > $3
             ORDER BY starts_at`,
            [domain, practitioner.id, queryStart, queryEnd]
        ),
        connection.query(
            `SELECT id, starts_at, ends_at, service_id, unavailable_block,
                    appointment_status, archived
             FROM appointments
             WHERE domain = $1 AND practitioner_id = $2
               AND starts_at < $4 AND ends_at > $3
               AND COALESCE(archived, FALSE) = FALSE
               AND (
                   COALESCE(unavailable_block, FALSE) = TRUE
                   OR appointment_status IN ('tentative', 'confirmed', 'arrived', 'completed')
               )
             ORDER BY starts_at`,
            [domain, practitioner.id, queryStart, queryEnd]
        ),
        connection.query(
            `SELECT id, buffer_before_minutes, buffer_after_minutes
             FROM services
             WHERE domain = $1`,
            [domain]
        ),
        connection.query(
            `SELECT starts_at, ends_at, busy_status
             FROM calendar_busy_blocks
             WHERE domain = $1 AND practitioner_id = $2
               AND starts_at < $4 AND ends_at > $3
               AND busy_status <> 'free'
             ORDER BY starts_at`,
            [domain, practitioner.id, queryStart, queryEnd]
        ),
    ])

    const servicesById = {}
    ;(servicesResult.rows || []).forEach((row) => {
        servicesById[row.id] = row
    })

    const availability = generateAvailability({
        practitionerId: practitioner.id,
        service,
        locationId,
        rules: rulesResult.rows || [],
        exceptions: exceptionsResult.rows || [],
        appointments: [
            ...(appointmentsResult.rows || []),
            ...(externalBusyResult.rows || []).map((row) => ({
                starts_at: row.starts_at,
                ends_at: row.ends_at,
                unavailable_block: true,
            })),
        ],
        servicesById,
        timezone,
        from: fromBound,
        to: toBound,
        intervalMinutes,
        minNoticeMinutes,
        maxAdvanceDays,
        limit,
        now,
    })

    return { availability, timezone, from: fromBound, to: toBound }
}
