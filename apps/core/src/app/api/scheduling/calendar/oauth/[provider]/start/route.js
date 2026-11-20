import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { resolveAdminDomainScope } from '@/lib/adminDomainScope'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import {
    buildCalendarRedirectUri,
    createCalendarOAuthState,
    resolveRequestOrigin,
    setCalendarOAuthStateCookie,
} from '@/lib/calendarOAuth'
import { resolveProviderConfig } from '@/lib/calendarSync'
import { buildGoogleCalendarAuthUrl } from '@/lib/calendarProviders/google'
import { buildMicrosoftCalendarAuthUrl } from '@/lib/calendarProviders/microsoft'

function jsonError(message, status = 400) {
    return NextResponse.json({ success: false, error: message }, { status })
}

export async function GET(request, { params }) {
    if (detectDatabaseType() !== 'postgresql') {
        return jsonError('Relational database required')
    }

    const routeParams = await params
    const provider = String(routeParams?.provider || '').trim().toLowerCase()
    if (!['google', 'microsoft'].includes(provider)) {
        return jsonError('Unsupported calendar provider', 404)
    }

    const { searchParams } = new URL(request.url)
    const context = await resolveAdminDomainScope(request, searchParams.get('domain'))
    if (context?.error) return jsonError(context.error, context.status)
    const domain = context.domain

    const practitionerId = Number.parseInt(String(searchParams.get('practitioner_id') || ''), 10)
    if (!Number.isFinite(practitionerId) || practitionerId <= 0) {
        return jsonError('practitioner_id is required')
    }

    let connection = null
    try {
        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(domain)
        const practitioner = await connection.query(
            'SELECT id FROM practitioners WHERE id = $1 AND domain = $2 LIMIT 1',
            [practitionerId, domain]
        )
        if (!practitioner.rows?.length) return jsonError('Practitioner not found', 404)

        let config
        try {
            config = resolveProviderConfig(provider, domain)
        } catch (error) {
            return jsonError(error?.message || `${provider} OAuth is not configured`, 503)
        }

        const origin = resolveRequestOrigin(request)
        const wantsJson = searchParams.get('format') === 'json'
            || String(request.headers.get('accept') || '').includes('application/json')
        const redirectUri = buildCalendarRedirectUri(provider, origin)
        const state = await createCalendarOAuthState({
            domain,
            practitionerId,
            provider,
            origin,
        })

        const authUrl = provider === 'google'
            ? buildGoogleCalendarAuthUrl({
                clientId: config.clientId,
                redirectUri,
                state,
            })
            : buildMicrosoftCalendarAuthUrl({
                tenantId: config.tenantId,
                clientId: config.clientId,
                redirectUri,
                state,
            })

        const response = wantsJson
            ? NextResponse.json({ success: true, authUrl })
            : NextResponse.redirect(authUrl)
        setCalendarOAuthStateCookie(response, state, new URL(request.url))
        return response
    } catch (error) {
        return jsonError(error?.message || 'Failed to start calendar OAuth', 500)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
