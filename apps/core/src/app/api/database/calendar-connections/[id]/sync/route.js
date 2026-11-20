import { NextResponse } from 'next/server'
import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { resolveRouteParams, validateId } from '@/lib/appointments'
import { syncCalendarConnection } from '@/lib/calendarSync'

export async function POST(request, { params }) {
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
        connection = await getDatabaseConnection()
        const result = await syncCalendarConnection(connection, {
            domain: context.domain,
            connectionId: id,
        })
        return NextResponse.json({ success: true, data: result })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Calendar sync failed' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
