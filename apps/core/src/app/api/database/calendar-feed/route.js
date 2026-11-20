import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { buildCalendarFeedUrl, getCalendarFeedSecret } from '@/lib/calendarFeed'

function parsePositiveInt(rawValue) {
    const parsed = Number.parseInt(String(rawValue || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

// `request.url` is canonicalised by the dev server and some proxies, which can
// lose the tenant hostname. Prefer the public host headers so a generated feed
// URL keeps the host the practitioner actually uses.
function resolveRequestOrigin(request) {
    const requestUrl = new URL(request.url)
    const host = request.headers.get('x-forwarded-host')
        || request.headers.get('host')
        || requestUrl.host
    const protocol = request.headers.get('x-forwarded-proto')
        || requestUrl.protocol.replace(':', '')
        || 'http'
    return `${protocol}://${host}`
}

/**
 * GET /api/database/calendar-feed?domain=...&practitioner_id=...
 *
 * Returns the signed subscription URL for the current domain. Admin-only: the
 * URL itself is the credential, so it must never be exposed on a public page.
 */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    if (!getCalendarFeedSecret()) {
        return NextResponse.json(
            { success: false, error: 'Calendar feed secret is not configured. Set CALENDAR_FEED_SECRET or JWT_SECRET.' },
            { status: 503 }
        )
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }
    const domain = context.domain
    const practitionerId = parsePositiveInt(searchParams.get('practitioner_id'))

    let connection = null
    try {
        if (practitionerId) {
            connection = await getDomainBoundConnection(domain)
            const result = await connection.query(
                'SELECT id FROM practitioners WHERE id = $1 AND domain = $2 LIMIT 1',
                [practitionerId, domain]
            )
            if (!result.rows?.length) {
                return NextResponse.json(
                    { success: false, error: 'Practitioner not found' },
                    { status: 404 }
                )
            }
        }

        const url = buildCalendarFeedUrl({
            origin: resolveRequestOrigin(request),
            domain,
            practitionerId,
        })

        return NextResponse.json({
            success: true,
            data: {
                url,
                domain,
                practitioner_id: practitionerId,
            },
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to build calendar feed URL' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
