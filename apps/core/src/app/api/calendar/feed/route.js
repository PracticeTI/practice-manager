import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    clampFeedRange,
    normalizeFeedDomain,
    serializeCalendarFeed,
    verifyCalendarFeedToken,
} from '@/lib/calendarFeed'

const DEFAULT_TIMEZONE = 'Australia/Sydney'

function parsePractitionerId(rawValue) {
    if (!rawValue) return null
    const parsed = Number.parseInt(rawValue, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function textError(message, status) {
    return new NextResponse(message, {
        status,
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    })
}

/**
 * GET /api/calendar/feed?domain=...&practitioner_id=...&token=...
 *
 * Public read-only ICS feed. The token is an HMAC over the domain and optional
 * practitioner id, so a leaked URL cannot be re-pointed at another practice.
 */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return textError('Relational database required', 400)
    }

    const requestUrl = new URL(request.url)
    const domain = normalizeFeedDomain(requestUrl.searchParams.get('domain'))
    const practitionerId = parsePractitionerId(requestUrl.searchParams.get('practitioner_id'))
    const token = requestUrl.searchParams.get('token') || ''

    if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(domain)) {
        return textError('Invalid domain', 400)
    }
    if (!verifyCalendarFeedToken({ domain, practitionerId, token })) {
        return textError('Invalid or expired calendar feed token', 401)
    }

    const { from, to } = clampFeedRange({
        from: requestUrl.searchParams.get('from'),
        to: requestUrl.searchParams.get('to'),
    })

    let connection = null
    try {
        connection = await getDomainBoundConnection(domain)

        let timezone = DEFAULT_TIMEZONE
        if (practitionerId) {
            const practitioner = await connection.query(
                'SELECT timezone FROM practitioners WHERE id = $1 AND domain = $2 LIMIT 1',
                [practitionerId, domain]
            )
            timezone = practitioner.rows?.[0]?.timezone || timezone
        }

        const result = await connection.query(
            `SELECT id, starts_at, ends_at, service, location, patient_name,
                    appointment_status, practitioner_id
             FROM appointments
             WHERE domain = $1
               AND ($2::int IS NULL OR practitioner_id = $2)
               AND starts_at <= $4
               AND COALESCE(ends_at, starts_at) >= $3
               AND COALESCE(archived, FALSE) = FALSE
             ORDER BY starts_at`,
            [domain, practitionerId, from, to]
        )

        const calendar = serializeCalendarFeed({
            domain,
            appointments: result.rows || [],
            timezone,
        })

        return new NextResponse(calendar, {
            status: 200,
            headers: {
                'Content-Type': 'text/calendar; charset=utf-8',
                'Content-Disposition': `inline; filename="${domain}-appointments.ics"`,
                'Cache-Control': 'private, max-age=300',
                'X-Content-Type-Options': 'nosniff',
            },
        })
    } catch (error) {
        return textError('Failed to build calendar feed', 500)
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
