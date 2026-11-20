import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    publicCalendarConnection,
    resolveProviderConfig,
} from '@/lib/calendarSync'

function parsePositiveInt(value) {
    const parsed = Number.parseInt(String(value || ''), 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function providerAvailability(domain) {
    const result = {}
    for (const provider of ['google', 'microsoft']) {
        try {
            resolveProviderConfig(provider, domain)
            result[provider] = { configured: true }
        } catch (error) {
            result[provider] = {
                configured: false,
                reason: String(error?.message || 'Not configured'),
            }
        }
    }
    return result
}

export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
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
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)

        const params = [domain]
        let where = 'domain = $1'
        if (practitionerId) {
            params.push(practitionerId)
            where += ` AND practitioner_id = $${params.length}`
        }

        const result = await connection.query(
            `SELECT id, domain, practitioner_id, provider, external_account_email,
                    status, last_synced_at, last_sync_error, sync_window_days, token_expires_at
             FROM calendar_connections
             WHERE ${where}
             ORDER BY practitioner_id, provider`,
            params
        )

        return NextResponse.json({
            success: true,
            data: (result.rows || []).map(publicCalendarConnection),
            providers: providerAvailability(domain),
        })
    } catch (error) {
        return NextResponse.json(
            { success: false, error: error?.message || 'Failed to load calendar connections' },
            { status: 500 }
        )
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
