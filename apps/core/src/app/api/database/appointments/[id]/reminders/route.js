import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { resolveRouteParams, validateId } from '@/lib/appointments'
import { sendConfirmationNow } from '@/lib/appointmentReminders'

async function requireScope(request, requestedDomain) {
    const context = await resolveAdminDomainScope(request, requestedDomain)
    if (context?.error) {
        return { error: NextResponse.json({ success: false, error: context.error }, { status: context.status }) }
    }
    return { context, domain: context.domain }
}

export async function GET(request, { params }) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) return NextResponse.json({ success: false, error: 'Invalid appointment id' }, { status: 400 })

    const { searchParams } = new URL(request.url)
    const scoped = await requireScope(request, searchParams.get('domain'))
    if (scoped.error) return scoped.error

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(scoped.domain)
        const result = await connection.query(
            `SELECT id, kind, channel, offset_hours, scheduled_for, status,
                    attempts, sent_at, provider, provider_message_id, error_message
             FROM appointment_reminders
             WHERE domain = $1 AND appointment_id = $2
             ORDER BY scheduled_for`,
            [scoped.domain, id]
        )
        return NextResponse.json({ success: true, data: result.rows || [] })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load appointment reminders' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

export async function POST(request, { params }) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await resolveRouteParams(params)
    const id = validateId(routeParams?.id)
    if (!id) return NextResponse.json({ success: false, error: 'Invalid appointment id' }, { status: 400 })

    const payload = await request.json().catch(() => ({}))
    const { searchParams } = new URL(request.url)
    const scoped = await requireScope(request, searchParams.get('domain') || payload?.domain)
    if (scoped.error) return scoped.error

    if (String(payload?.action || 'send_confirmation') !== 'send_confirmation') {
        return NextResponse.json(
            { success: false, error: 'Only send_confirmation is supported' },
            { status: 400 }
        )
    }

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(scoped.domain)

        const origin = request.headers.get('x-forwarded-host')
            ? `${request.headers.get('x-forwarded-proto') || 'https'}://${request.headers.get('x-forwarded-host')}`
            : new URL(request.url).origin

        const result = await sendConfirmationNow(connection, {
            domain: scoped.domain,
            appointmentId: id,
            origin,
            channelPreference: payload?.channel || 'auto',
        })

        if (result.success) {
            return NextResponse.json({ success: true, data: result })
        }
        if (result.skipped) {
            return NextResponse.json(
                { success: false, error: `No message sent: ${result.reason}`, data: result },
                { status: 422 }
            )
        }
        return NextResponse.json(
            { success: false, error: result.error || result.reason || 'Failed to send confirmation' },
            { status: 500 }
        )
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to send confirmation' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
