import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { INTAKE_MODES } from '@/lib/nativeIntake'
import { readIntakeSettings, saveIntakeSettings } from '@/lib/nativeIntakeStore'

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

/** GET /api/database/intake-settings — which intake form the domain publishes. */
export async function GET(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    try {
        const { searchParams } = new URL(request.url)
        const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
        if (context?.error) return jsonError(context.error, context.status)

        const settings = await readIntakeSettings(context.domain)
        return NextResponse.json({ success: true, data: settings, modes: INTAKE_MODES })
    } catch (error) {
        return jsonError(error?.message || 'Failed to load intake settings', 500)
    }
}

/** PUT /api/database/intake-settings — partial update. */
export async function PUT(request) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    try {
        const payload = await request.json().catch(() => ({}))
        const context = await resolveAdminDomainScope(request, payload?.domain)
        if (context?.error) return jsonError(context.error, context.status)

        const settings = await saveIntakeSettings(context.domain, payload?.settings || payload || {})
        return NextResponse.json({ success: true, data: settings, modes: INTAKE_MODES })
    } catch (error) {
        return jsonError(error?.message || 'Failed to save intake settings', 500)
    }
}
