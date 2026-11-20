import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { resolveRouteParams, validateId } from '@/lib/appointments'
import { publicCalendarConnection } from '@/lib/calendarSync'

export async function GET(request, { params }) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) return NextResponse.json({ success: false, error: 'Invalid connection id' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(context.domain)
        const result = await connection.query(
            `SELECT id, domain, practitioner_id, provider, external_account_email,
                    status, last_synced_at, last_sync_error, sync_window_days, token_expires_at
             FROM calendar_connections
             WHERE id = $1 AND domain = $2
             LIMIT 1`,
            [id, context.domain]
        )
        const row = result.rows?.[0]
        if (!row) {
            return NextResponse.json({ success: false, error: 'Calendar connection not found' }, { status: 404 })
        }
        return NextResponse.json({ success: true, data: publicCalendarConnection(row) })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load calendar connection' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

export async function DELETE(request, { params }) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) return NextResponse.json({ success: false, error: 'Invalid connection id' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) {
        return NextResponse.json({ success: false, error: context.error }, { status: context.status })
    }

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(context.domain)

        const existing = await connection.query(
            'SELECT id FROM calendar_connections WHERE id = $1 AND domain = $2 LIMIT 1',
            [id, context.domain]
        )
        if (!existing.rows?.length) {
            return NextResponse.json({ success: false, error: 'Calendar connection not found' }, { status: 404 })
        }

        await connection.query('DELETE FROM calendar_busy_blocks WHERE connection_id = $1', [id])
        await connection.query('DELETE FROM calendar_connections WHERE id = $1 AND domain = $2', [id, context.domain])

        return NextResponse.json({ success: true })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to disconnect calendar' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
