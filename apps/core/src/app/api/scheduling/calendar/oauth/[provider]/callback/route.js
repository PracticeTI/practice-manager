import { NextResponse } from 'next/server'
import { detectDatabaseType } from '@/lib/database'
import { getDomainBoundConnection } from '@/lib/domainScopedConnection'
import { ensureSchedulingTables } from '@/lib/schedulingTables'
import { encryptSecret } from '@/lib/secretBox'
import {
    buildCalendarRedirectUri,
    clearCalendarOAuthStateCookie,
    readCalendarOAuthState,
    verifyCalendarOAuthState,
} from '@/lib/calendarOAuth'
import { resolveProviderConfig, syncCalendarConnection } from '@/lib/calendarSync'
import {
    exchangeGoogleCalendarCode,
    fetchGoogleCalendarEmail,
} from '@/lib/calendarProviders/google'
import {
    exchangeMicrosoftCalendarCode,
    fetchMicrosoftCalendarEmail,
} from '@/lib/calendarProviders/microsoft'

function redirectToApp(origin, params) {
    const url = new URL('/admin/appointments', origin)
    Object.entries(params).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
            url.searchParams.set(key, String(value))
        }
    })
    return NextResponse.redirect(url)
}

export async function GET(request, { params }) {
    if (detectDatabaseType() !== 'postgresql') {
        return NextResponse.json({ success: false, error: 'Relational database required' }, { status: 400 })
    }

    const routeParams = await params
    const provider = String(routeParams?.provider || '').trim().toLowerCase()
    const requestUrl = new URL(request.url)
    const code = requestUrl.searchParams.get('code') || ''
    const stateToken = requestUrl.searchParams.get('state') || ''
    const providerError = requestUrl.searchParams.get('error') || ''

    const state = await verifyCalendarOAuthState(stateToken)
    if (!state || state.provider !== provider || !state.domain || !state.practitionerId) {
        return NextResponse.json(
            { success: false, error: 'Invalid or expired OAuth state' },
            { status: 400 }
        )
    }

    const cookieState = readCalendarOAuthState(request)
    if (!cookieState || cookieState !== stateToken) {
        return NextResponse.json(
            { success: false, error: 'OAuth state cookie missing or mismatched' },
            { status: 400 }
        )
    }

    const origin = String(state.origin || '').replace(/\/+$/, '')
    if (providerError) {
        const response = redirectToApp(origin, {
            calendar: 'error',
            provider,
            reason: providerError,
        })
        clearCalendarOAuthStateCookie(response, requestUrl)
        return response
    }
    if (!code) {
        return NextResponse.json({ success: false, error: 'Missing authorization code' }, { status: 400 })
    }

    let connection = null
    try {
        const config = resolveProviderConfig(provider, state.domain)
        const redirectUri = buildCalendarRedirectUri(provider, origin)
        const tokens = provider === 'google'
            ? await exchangeGoogleCalendarCode({
                code,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                redirectUri,
            })
            : await exchangeMicrosoftCalendarCode({
                code,
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                redirectUri,
                tenantId: config.tenantId,
            })

        if (!tokens.accessToken) {
            throw new Error('The provider did not return an access token')
        }

        const accountEmail = provider === 'google'
            ? await fetchGoogleCalendarEmail({ accessToken: tokens.accessToken })
            : await fetchMicrosoftCalendarEmail({ accessToken: tokens.accessToken })

        await ensureSchedulingTables()
        connection = await getDomainBoundConnection(state.domain)

        const saved = await connection.query(
            `INSERT INTO calendar_connections
                (domain, practitioner_id, provider, external_account_email,
                 access_token_encrypted, refresh_token_encrypted, token_expires_at,
                 scopes, status, last_sync_error)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'connected', NULL)
             ON CONFLICT (domain, practitioner_id, provider) DO UPDATE SET
                external_account_email = EXCLUDED.external_account_email,
                access_token_encrypted = EXCLUDED.access_token_encrypted,
                refresh_token_encrypted = COALESCE(
                    EXCLUDED.refresh_token_encrypted,
                    calendar_connections.refresh_token_encrypted
                ),
                token_expires_at = EXCLUDED.token_expires_at,
                scopes = EXCLUDED.scopes,
                status = 'connected',
                last_sync_error = NULL,
                updated_at = NOW()
             RETURNING id`,
            [
                state.domain,
                state.practitionerId,
                provider,
                accountEmail,
                encryptSecret(tokens.accessToken),
                tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
                tokens.expiresAt,
                tokens.scopes || null,
            ]
        )

        const connectionId = saved.rows?.[0]?.id
        let syncStatus = 'skipped'
        if (connectionId) {
            try {
                await syncCalendarConnection(connection, {
                    domain: state.domain,
                    connectionId,
                })
                syncStatus = 'synced'
            } catch {
                syncStatus = 'error'
            }
        }

        const response = redirectToApp(origin, {
            calendar: 'connected',
            provider,
            sync: syncStatus,
        })
        clearCalendarOAuthStateCookie(response, requestUrl)
        return response
    } catch (error) {
        const response = redirectToApp(origin, {
            calendar: 'error',
            provider,
            reason: String(error?.message || 'Calendar connection failed').slice(0, 200),
        })
        clearCalendarOAuthStateCookie(response, requestUrl)
        return response
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}
