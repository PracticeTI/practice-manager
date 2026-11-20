import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth'
import { getSuperAdminConnection } from '@/lib/domainScopedConnection'
import { ensureActivitiesTable } from '@/lib/activitiesTable'
import { normalizeActivityRow } from '@/lib/activityDisplay'
import { ACTIVITY_COLUMNS, buildActivityWhere, normalizeActivityDomain, parseActivityFilters } from '@/lib/activitiesQuery'

function getAdminToken(request) {
    const authHeader = request.headers.get('authorization') || ''
    return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : ''
}

/**
 * GET /api/settings/activities
 * Superadmin-only view of the audit trail across every domain. Passing `domain`
 * narrows it to one domain; omitting it returns all of them, along with the
 * `domains` facet the settings page uses to build its filter.
 */
export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const adminUser = await verifyAdminToken(getAdminToken(request))
    if (!adminUser || !isSuperAdmin(adminUser)) {
        return NextResponse.json({ error: 'Unauthorized: superadmin required' }, { status: 401 })
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const domain = normalizeActivityDomain(searchParams.get('domain'))
        const filters = parseActivityFilters(searchParams)
        const { clause, params } = buildActivityWhere(filters, { domain: domain || null })

        await ensureActivitiesTable()
        // Superadmin-only view: the `domains` facet spans every tenant, so the
        // session is bound as superadmin rather than to one domain.
        connection = await getSuperAdminConnection()

        const countResult = await connection.query(
            `SELECT COUNT(*)::int AS total FROM activities ${clause}`,
            params
        )

        const listResult = await connection.query(
            `SELECT ${ACTIVITY_COLUMNS.join(', ')}
             FROM activities
             ${clause}
             ORDER BY created_at DESC, id DESC
             LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
            [...params, filters.limit, filters.offset]
        )

        // Only the filtered result set is scoped by `domain`; the facet is always
        // the full list so the filter itself never collapses to one option.
        const domainsResult = await connection.query(
            'SELECT DISTINCT domain FROM activities ORDER BY domain'
        )

        return NextResponse.json({
            success: true,
            data: (listResult.rows || []).map(normalizeActivityRow),
            total: countResult.rows?.[0]?.total ?? 0,
            domains: (domainsResult.rows || []).map((row) => row.domain).filter(Boolean),
            limit: filters.limit,
            offset: filters.offset,
        })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to load activities' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
