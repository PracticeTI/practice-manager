import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { DEFAULT_TIMEZONE } from '@/lib/scheduling'
import { parseAvailabilityRangeBound } from '@/lib/practitionerAvailability'
import { loadAvailabilitySlots } from '@/lib/schedulingAvailability'

function parsePositiveInt(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseBoundedInt(rawValue, { fallback, min, max }) {
    const parsed = Number.parseInt(String(rawValue ?? ''), 10)
    if (!Number.isFinite(parsed)) return fallback
    return Math.min(max, Math.max(min, parsed))
}

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

/**
 * GET /api/database/availability
 *
 * Query:
 *   practitioner_id   required
 *   service_id        required
 *   location_id       optional
 *   from, to          ISO timestamps or YYYY-MM-DD in the practitioner timezone
 *   interval          slot step in minutes (5-120, default 15)
 *   min_notice        minimum notice in minutes (default 0)
 *   limit             maximum slots (default 200, max 2000)
 */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) {
            return jsonError(context.error, context.status)
        }
        const domain = context.domain

        const practitionerId = parsePositiveInt(searchParams.get('practitioner_id'))
        const serviceId = parsePositiveInt(searchParams.get('service_id'))
        const locationId = parsePositiveInt(searchParams.get('location_id'))
        if (!practitionerId) return jsonError('practitioner_id is required')
        if (!serviceId) return jsonError('service_id is required')

        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        const practitionerResult = await connection.query(
            `SELECT id, domain, display_name, timezone, default_location_id, active
             FROM practitioners
             WHERE id = $1 AND domain = $2
             LIMIT 1`,
            [practitionerId, domain]
        )
        const practitioner = practitionerResult.rows?.[0]
        if (!practitioner) return jsonError('Practitioner not found', 404)

        const serviceResult = await connection.query(
            `SELECT id, domain, name, duration_minutes, buffer_before_minutes, buffer_after_minutes
             FROM services
             WHERE id = $1 AND domain = $2
             LIMIT 1`,
            [serviceId, domain]
        )
        const service = serviceResult.rows?.[0]
        if (!service) return jsonError('Service not found', 404)

        if (locationId) {
            const locationResult = await connection.query(
                'SELECT id FROM practice_locations WHERE id = $1 AND domain = $2 LIMIT 1',
                [locationId, domain]
            )
            if (!locationResult.rows?.length) return jsonError('Practice location not found', 404)
        }

        const timezone = practitioner.timezone || DEFAULT_TIMEZONE
        const now = new Date()

        const fromParam = searchParams.get('from') || undefined
        const toParam = searchParams.get('to') || undefined

        const rangeStart = fromParam
            ? parseAvailabilityRangeBound(fromParam, timezone, { endOfDay: false })
            : 0
        const rangeEnd = toParam
            ? parseAvailabilityRangeBound(toParam, timezone, { endOfDay: true })
            : 1
        if (rangeStart === null) return jsonError('from must be an ISO timestamp or YYYY-MM-DD')
        if (rangeEnd === null) return jsonError('to must be an ISO timestamp or YYYY-MM-DD')
        if (fromParam && toParam && rangeEnd <= rangeStart) return jsonError('to must be after from')

        const intervalMinutes = parseBoundedInt(searchParams.get('interval'), {
            fallback: 15,
            min: 5,
            max: 120,
        })
        const minNoticeMinutes = parseBoundedInt(searchParams.get('min_notice'), {
            fallback: 0,
            min: 0,
            max: 10080,
        })
        const limit = parseBoundedInt(searchParams.get('limit'), {
            fallback: 200,
            min: 1,
            max: 2000,
        })
        const maxAdvanceDays = parseBoundedInt(searchParams.get('max_advance_days'), {
            fallback: 365,
            min: 1,
            max: 730,
        })

        const { availability } = await loadAvailabilitySlots(connection, {
            domain,
            practitioner,
            service,
            locationId,
            from: fromParam,
            to: toParam,
            intervalMinutes,
            minNoticeMinutes,
            maxAdvanceDays,
            limit,
            syncExternalCalendars: true,
            now,
        })

        return NextResponse.json({
            success: true,
            data: {
                ...availability,
                practitioner: {
                    id: practitioner.id,
                    display_name: practitioner.display_name,
                    timezone,
                },
                service: {
                    id: service.id,
                    name: service.name,
                    duration_minutes: service.duration_minutes,
                },
                location_id: locationId,
                interval_minutes: intervalMinutes,
            },
        })
    } catch (error) {
        return jsonError(error?.message || 'Failed to calculate availability', 500)
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
