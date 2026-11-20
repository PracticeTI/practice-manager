import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { verifyServiceAuth } from '@/lib/auth'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { ensureActivitiesTable } from '@/lib/activitiesTable'
import { activityActorFromAdminUser, normalizeActivityActor, recordActivity } from '@/lib/activities'
import { normalizeActivityEntityType, normalizeActivityRow } from '@/lib/activityDisplay'
import { ACTIVITY_COLUMNS, buildActivityWhere, parseActivityFilters } from '@/lib/activitiesQuery'

function normalizeDomain(value) {
    return String(value || '').trim().toLowerCase()
}

/**
 * GET /api/database/activities
 * Lists the audit trail for a domain, newest first.
 */
export async function GET(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) {
            return NextResponse.json({ success: false, error: context.error }, { status: context.status })
        }

        const filters = parseActivityFilters(searchParams)
        const { clause, params } = buildActivityWhere(filters, { domain: context.domain })

        await ensureActivitiesTable()
        connection = await getDomainBoundConnection(context.domain)

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

        return NextResponse.json({
            success: true,
            data: (listResult.rows || []).map(normalizeActivityRow),
            total: countResult.rows?.[0]?.total ?? 0,
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

/**
 * POST /api/database/activities
 * Appends an audit-trail row. Accepts an admin token (the actor is the signed-in
 * user) or the service shared secret (agents/workers, which declare their own
 * `actor`).
 */
export async function POST(request) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    let connection = null
    try {
        const payload = await request.json().catch(() => ({}))
        const viaService = verifyServiceAuth(request)

        let domain = normalizeDomain(payload?.domain)
        let actor = payload?.actor ? normalizeActivityActor(payload.actor) : null

        if (!viaService) {
            const context = await resolveAdminDomainScope(request, payload?.domain)
            if (context?.error) {
                return NextResponse.json({ success: false, error: context.error }, { status: context.status })
            }
            domain = context.domain
            if (!actor) {
                actor = activityActorFromAdminUser(context.adminUser)
            }
        } else if (!actor) {
            actor = normalizeActivityActor({
                actorType: payload?.actor_type || 'agent',
                actorId: payload?.actor_id,
                actorName: payload?.actor_name,
            })
        }

        if (!domain) {
            return NextResponse.json({ success: false, error: 'domain is required' }, { status: 400 })
        }

        const action = normalizeActivityAction(payload?.action)
        if (!action) {
            return NextResponse.json({ success: false, error: 'action must be one of create, update, delete, import' }, { status: 400 })
        }

        const entityType = normalizeActivityEntityType(payload?.entity_type ?? payload?.entityType)
        if (!entityType) {
            return NextResponse.json({ success: false, error: 'entity_type is required' }, { status: 400 })
        }

        const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : null

        connection = await getDomainBoundConnection(domain)
        const id = await recordActivity({
            domain,
            action,
            entityType,
            entityId: payload?.entity_id ?? payload?.entityId ?? null,
            entityLabel: payload?.entity_label ?? payload?.entityLabel ?? null,
            patientId: payload?.patient_id ?? payload?.patientId ?? null,
            patientName: payload?.patient_name ?? payload?.patientName ?? null,
            deepLink: payload?.deep_link ?? payload?.deepLink ?? null,
            summary: payload?.summary ?? null,
            metadata,
            actor,
        }, { connection })

        if (!id) {
            return NextResponse.json({ success: false, error: 'Failed to record activity' }, { status: 500 })
        }

        return NextResponse.json({ success: true, id }, { status: 201 })
    } catch (error) {
        return NextResponse.json({ success: false, error: error?.message || 'Failed to record activity' }, { status: 500 })
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        }
    }
}
