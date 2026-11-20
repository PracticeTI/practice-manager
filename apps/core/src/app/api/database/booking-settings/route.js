import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { readBookingSettings, saveBookingSettings } from '@/lib/schedulingBooking'

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

/** GET /api/database/booking-settings — public booking configuration for the admin's domain. */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) return jsonError(context.error, context.status)

        const settings = await readBookingSettings(context.domain)
        return NextResponse.json({ success: true, data: settings })
    } catch (error) {
        return jsonError(error?.message || 'Failed to load booking settings', 500)
    }
}

/** PUT /api/database/booking-settings — partial update, clamped to safe ranges. */
export async function PUT(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) return jsonError(context.error, context.status)

        const settings = await saveBookingSettings(context.domain, payload?.settings || payload || {})
        return NextResponse.json({ success: true, data: settings })
    } catch (error) {
        return jsonError(error?.message || 'Failed to save booking settings', 500)
    }
}
