// Connection lifecycle for external calendar busy-time sync.

import { decryptSecret, encryptSecret } from '@/lib/secretBox'
import {
    fetchGoogleBusyBlocks,
    refreshGoogleCalendarToken,
} from '@/lib/calendarProviders/google'
import {
    fetchMicrosoftBusyBlocks,
    refreshMicrosoftCalendarToken,
} from '@/lib/calendarProviders/microsoft'

const DAY_MS = 86400000
const TOKEN_REFRESH_WINDOW_MS = 5 * 60 * 1000

function scopedEnv(domain, name) {
    const prefix = String(domain || '')
        .replace(/[^a-z0-9]+/gi, '_')
        .replace(/^_+|_+$/g, '')
        .toUpperCase()
    if (prefix) {
        const scoped = String(process.env[`${prefix}_${name}`] || '').trim()
        if (scoped) return scoped
    }
    return String(process.env[name] || '').trim()
}

export function getGoogleCalendarConfig(domain) {
    return {
        clientId: scopedEnv(domain, 'GOOGLE_OAUTH_CLIENT_ID'),
        clientSecret: scopedEnv(domain, 'GOOGLE_OAUTH_CLIENT_SECRET'),
    }
}

export function getMicrosoftCalendarConfig(domain) {
    return {
        clientId: scopedEnv(domain, 'MICROSOFT_CLIENT_ID'),
        clientSecret: scopedEnv(domain, 'MICROSOFT_CLIENT_SECRET'),
        tenantId: scopedEnv(domain, 'MICROSOFT_TENANT_ID') || 'common',
    }
}

export function resolveProviderConfig(provider, domain) {
    if (provider === 'google') {
        const config = getGoogleCalendarConfig(domain)
        if (!config.clientId || !config.clientSecret) {
            throw new Error('GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be configured')
        }
        return { ...config, tenantId: null }
    }
    if (provider === 'microsoft') {
        const config = getMicrosoftCalendarConfig(domain)
        if (!config.clientId || !config.clientSecret) {
            throw new Error('MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be configured')
        }
        return config
    }
    throw new Error(`Unsupported calendar provider: ${provider}`)
}

async function refreshAccessToken(provider, domain, refreshToken) {
    const config = resolveProviderConfig(provider, domain)
    if (provider === 'google') {
        return refreshGoogleCalendarToken({
            refreshToken,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
        })
    }
    return refreshMicrosoftCalendarToken({
        refreshToken,
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        tenantId: config.tenantId,
    })
}

async function fetchBusyBlocks(provider, accessToken, from, to) {
    if (provider === 'google') {
        return fetchGoogleBusyBlocks({ accessToken, from, to })
    }
    return fetchMicrosoftBusyBlocks({ accessToken, from, to })
}

export function publicCalendarConnection(row) {
    if (!row) return null
    return {
        id: row.id,
        domain: row.domain,
        practitioner_id: row.practitioner_id,
        provider: row.provider,
        external_account_email: row.external_account_email,
        status: row.status,
        last_synced_at: row.last_synced_at,
        last_sync_error: row.last_sync_error,
        sync_window_days: row.sync_window_days,
        token_expires_at: row.token_expires_at,
    }
}

/**
 * Refresh the connection's access token when it is close to expiry.
 * Returns the usable access token.
 */
async function ensureAccessToken(connection, row) {
    let accessToken = decryptSecret(row.access_token_encrypted)
    if (!accessToken) {
        throw new Error('Stored access token could not be decrypted')
    }

    const expiresAt = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0
    if (!expiresAt || expiresAt - Date.now() > TOKEN_REFRESH_WINDOW_MS) {
        return accessToken
    }

    const refreshToken = decryptSecret(row.refresh_token_encrypted)
    if (!refreshToken) return accessToken

    const refreshed = await refreshAccessToken(row.provider, row.domain, refreshToken)
    accessToken = refreshed.accessToken

    await connection.query(
        `UPDATE calendar_connections
         SET access_token_encrypted = $1,
             token_expires_at = $2,
             refresh_token_encrypted = COALESCE($3, refresh_token_encrypted),
             updated_at = NOW()
         WHERE id = $4`,
        [
            encryptSecret(accessToken),
            refreshed.expiresAt,
            refreshed.refreshToken ? encryptSecret(refreshed.refreshToken) : null,
            row.id,
        ]
    )

    return accessToken
}

/**
 * Pull busy blocks for one connection and replace the stored mirror.
 */
export async function syncCalendarConnection(connection, {
    domain,
    connectionId,
    now = new Date(),
} = {}) {
    const result = await connection.query(
        'SELECT * FROM calendar_connections WHERE id = $1 AND domain = $2 LIMIT 1',
        [connectionId, domain]
    )
    const row = result.rows?.[0]
    if (!row) throw new Error('Calendar connection not found')

    try {
        const accessToken = await ensureAccessToken(connection, row)
        const from = new Date(new Date(now).getTime() - 7 * DAY_MS).toISOString()
        const to = new Date(
            new Date(now).getTime() + Math.max(1, Number(row.sync_window_days) || 60) * DAY_MS
        ).toISOString()

        const blocks = await fetchBusyBlocks(row.provider, accessToken, from, to)

        await connection.query('DELETE FROM calendar_busy_blocks WHERE connection_id = $1', [row.id])
        for (const block of blocks) {
            await connection.query(
                `INSERT INTO calendar_busy_blocks
                    (domain, connection_id, practitioner_id, external_event_id,
                     starts_at, ends_at, busy_status, title, metadata)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    row.domain,
                    row.id,
                    row.practitioner_id,
                    block.external_event_id || null,
                    block.starts_at,
                    block.ends_at,
                    block.busy_status || 'busy',
                    block.title || null,
                    JSON.stringify({ provider: row.provider }),
                ]
            )
        }

        await connection.query(
            `UPDATE calendar_connections
             SET status = 'connected', last_synced_at = NOW(), last_sync_error = NULL, updated_at = NOW()
             WHERE id = $1`,
            [row.id]
        )

        return { connectionId: row.id, provider: row.provider, blocks: blocks.length, from, to }
    } catch (error) {
        await connection.query(
            `UPDATE calendar_connections
             SET status = 'error', last_sync_error = $2, updated_at = NOW()
             WHERE id = $1`,
            [row.id, String(error?.message || 'Calendar sync failed').slice(0, 1000)]
        ).catch(() => { })
        throw error
    }
}

/**
 * Sync connections whose mirror is older than `maxAgeMinutes`. Failures are
 * recorded on the connection and do not block availability calculations.
 */
export async function syncStaleConnectionsForPractitioner(connection, {
    domain,
    practitionerId,
    maxAgeMinutes = 15,
    now = new Date(),
} = {}) {
    if (!connection || !domain || !practitionerId) {
        return { checked: 0, synced: 0, errors: 0 }
    }

    const result = await connection.query(
        `SELECT id, last_synced_at
         FROM calendar_connections
         WHERE domain = $1 AND practitioner_id = $2
           AND status IN ('connected', 'error')`,
        [domain, practitionerId]
    )

    const cutoff = Date.now() - Math.max(1, maxAgeMinutes) * 60 * 1000
    let synced = 0
    let errors = 0

    for (const row of result.rows || []) {
        const lastSynced = row.last_synced_at ? new Date(row.last_synced_at).getTime() : 0
        if (lastSynced > cutoff) continue
        try {
            await syncCalendarConnection(connection, {
                domain,
                connectionId: row.id,
                now,
            })
            synced += 1
        } catch {
            errors += 1
        }
    }

    return { checked: result.rows?.length || 0, synced, errors }
}
