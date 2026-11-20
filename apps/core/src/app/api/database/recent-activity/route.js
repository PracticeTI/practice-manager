import { NextResponse } from 'next/server'
import { buildPgClientConfig } from '@/lib/pgClientConfig'
import { isSuperAdmin, verifyAdminToken } from '@/lib/auth.js'
import { contentTableHasDomainColumn } from '@/lib/contentListing'
import { DEFAULT_CONTENT_DOMAIN } from '@/lib/domainMode'
import { applySessionRlsContext, applySuperAdminSessionContext } from '@/lib/postgresRlsContext'

const LATEST_KEYS = ['latest_enrichment_session', 'latest_database_update_session', 'latest_domain_service_startup_session']

function detectDatabaseType(url) {
    try {
        const protocol = new URL(url).protocol.replace(':', '')
        if (protocol === 'postgresql' || protocol === 'postgres') return 'postgresql'
        return null
    } catch {
        return null
    }
}

function safeParseJson(value) {
    if (!value) return null
    try {
        return typeof value === 'string' ? JSON.parse(value) : value
    } catch {
        return null
    }
}

function normalizeDomainKey(value) {
    return String(value || '').trim().toLowerCase()
}

function formatRoleLabel(role) {
    const normalizedRole = String(role || '').trim().toLowerCase()
    if (!normalizedRole) return ''
    if (normalizedRole === 'superadmin') return 'Superadmin'
    if (normalizedRole === 'domain_admin') return 'Domain admin'
    if (normalizedRole === 'admin') return 'Admin'
    return normalizedRole
}

async function resolveRequestContext(request) {
    const searchParams = new URL(request.url).searchParams
    const requestedDomain = normalizeDomainKey(searchParams.get('domain'))

    const auth = request.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) {
        return { domainScope: requestedDomain, requester: null }
    }

    const token = auth.replace('Bearer ', '').trim()
    if (!token) {
        return { domainScope: requestedDomain, requester: null }
    }

    const adminUser = await verifyAdminToken(token)
    if (!adminUser) {
        return { domainScope: requestedDomain, requester: null }
    }

    const scopedDomain = normalizeDomainKey(adminUser.domain)
    if (scopedDomain && adminUser.role !== 'superadmin') {
        return { domainScope: scopedDomain, requester: adminUser }
    }

    return { domainScope: requestedDomain, requester: adminUser }
}

function normalizeActivity(row) {
    const payload = safeParseJson(row.value)
    if (!payload) return null

    const sessionType = payload.session_type
        || (row.key?.includes('database_update')
            ? 'database_update'
            : row.key?.includes('domain_service_startup')
                ? 'domain_service_startup'
                : 'enrichment')
    const status = payload.status || 'unknown'
    const completedAt = payload.completed_at || row.updated_at || null
    const startedAt = payload.started_at || row.started_at || null
    const timestamp = completedAt || startedAt || new Date().toISOString()

    const isDbUpdate = sessionType === 'database_update'
    const isServiceStartup = sessionType === 'domain_service_startup'
    const totalUpdated = Number(payload.total_updated ?? payload.insertedRows ?? 0)
    const totalProcessed = Number(payload.total_processed ?? payload.fetchedRows ?? 0)

    let title = 'Enrichment session'
    let description = `${status.replaceAll('_', ' ')} • ${totalUpdated} records updated`

    if (isDbUpdate) {
        title = 'NYC Open Data refresh'
        description = `${status.replaceAll('_', ' ')} • ${totalUpdated} rows inserted`
    }

    if (isServiceStartup) {
        title = 'Domain services status'
        description = `${payload.service || 'Domain services'} • ${status.replaceAll('_', ' ')}`
    }

    return {
        id: `${sessionType}-${payload.session_id || row.key}`,
        sessionId: payload.session_id || null,
        type: sessionType,
        title,
        description,
        status,
        totalUpdated,
        totalProcessed,
        startedAt,
        completedAt,
        timestamp,
        key: row.key
    }
}

function resolveUpdater(metadata, attributes, fallbackUpdater = '') {
    const value = metadata?.updated_by
        || metadata?.updatedBy
        || metadata?.updated_by_name
        || metadata?.updatedByName
        || metadata?.updated_by_username
        || metadata?.updatedByUsername
        || metadata?.editor
        || metadata?.last_editor
        || metadata?.lastEditedBy
        || metadata?.author
        || metadata?.service
        || metadata?.source
        || metadata?.created_by
        || metadata?.createdBy
        || metadata?.created_by_name
        || metadata?.createdByName
        || metadata?.created_by_username
        || metadata?.createdByUsername
        || attributes?.updated_by
        || attributes?.updatedBy
        || attributes?.updated_by_name
        || attributes?.updatedByName
        || attributes?.updated_by_username
        || attributes?.updatedByUsername
        || attributes?.author
        || attributes?.service
        || attributes?.source

    if (!value) {
        const roleValue = metadata?.updated_by_role
            || metadata?.updatedByRole
            || metadata?.created_by_role
            || metadata?.createdByRole
            || attributes?.updated_by_role
            || attributes?.updatedByRole
            || attributes?.created_by_role
            || attributes?.createdByRole

        const roleLabel = formatRoleLabel(roleValue)
        if (roleLabel) return roleLabel
        if (fallbackUpdater) return String(fallbackUpdater)
        return 'System'
    }
    return String(value)
}

function normalizeContentUpdate(row, options = {}) {
    if (!row) return null

    const metadata = safeParseJson(row.metadata, {})
    const attributes = safeParseJson(row.attributes, {})
    const contentTitle = row.title || row.name || metadata?.presentation?.default?.title || `Content #${row.id}`
    const updater = resolveUpdater(metadata, attributes, options.fallbackUpdater)
    const timestamp = row.updated_at || row.created_at || new Date().toISOString()
    const useSummaryTitle = options.summaryTitle !== false

    return {
        id: `content-update-${row.id}`,
        type: 'content_update',
        title: useSummaryTitle ? 'Last content item update' : contentTitle,
        description: useSummaryTitle ? `${contentTitle} • by ${updater}` : `Updated by ${updater}`,
        status: 'updated',
        totalUpdated: 1,
        totalProcessed: 1,
        startedAt: row.created_at || null,
        completedAt: row.updated_at || null,
        timestamp,
        key: 'latest_content_update',
        contentId: row.id,
        contentType: row.type || null,
        contentStatus: row.status || null,
        updater,
        contentTitle
    }
}

function summarizeContentUpdate(item) {
    if (!item) return null

    return {
        ...item,
        title: 'Last content item update',
        description: `${item.contentTitle || item.title} • by ${item.updater || 'System'}`
    }
}

function normalizeChatUpdate(row) {
    if (!row) return null

    const metadata = safeParseJson(row.metadata)
    const messages = safeParseJson(row.messages)
    const normalizedMessages = Array.isArray(messages) ? messages : []

    const latestUserMessage = [...normalizedMessages]
        .reverse()
        .find((message) => String(message?.role || '').toLowerCase() === 'user')

    const latestMessageText = String(latestUserMessage?.content || '').trim()
    const preview = latestMessageText
        ? (latestMessageText.length > 110 ? `${latestMessageText.slice(0, 107)}...` : latestMessageText)
        : null

    const contactName = String(
        metadata?.contactName
        || metadata?.name
        || metadata?.fullName
        || metadata?.senderName
        || ''
    ).trim()

    const roleLabel = String(row.role || 'Contact').trim() || 'Contact'
    const sessionId = row.session_id ? String(row.session_id) : null
    const timestamp = row.updated_at || row.created_at || new Date().toISOString()

    return {
        id: `chat-update-${row.id}`,
        type: 'chat_update',
        title: contactName || `${roleLabel} chat`,
        description: preview ? preview : `${roleLabel} chat session`,
        status: String(row.status || 'completed'),
        timestamp,
        role: roleLabel,
        sessionId,
        domain: row.domain || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null,
        messageCount: normalizedMessages.length,
    }
}

function dedupeLatestByType(activity = []) {
    const latestByType = new Map()

    for (const item of activity) {
        const existing = latestByType.get(item.type)
        if (!existing || new Date(item.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
            latestByType.set(item.type, item)
        }
    }

    return Array.from(latestByType.values())
}

/**
 * Bind the client before its first tenant query. The dashboard reads one domain
 * for an admin and every domain for a superadmin, so the session follows the
 * scope that `resolveRequestContext` already decided.
 */
async function bindRlsSession(client, session) {
    if (session?.superadmin) {
        await applySuperAdminSessionContext(client)
        return
    }
    await applySessionRlsContext(client, { domain: session?.domain || DEFAULT_CONTENT_DOMAIN })
}

function sortActivity(activity = []) {
    return [...activity].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

async function queryRecentContentUpdatesPostgres(connectionString, limit = 3, domainKey = '', fallbackUpdater = '', session = null) {
    const { Client } = await import('pg')
    const client = new Client(buildPgClientConfig(connectionString, { statement_timeout: 10000 }))
    const normalizedDomain = normalizeDomainKey(domainKey)

    try {
        await client.connect()
        await bindRlsSession(client, session)
        const hasDomainColumn = await contentTableHasDomainColumn(client)

        let result
        try {
            if (normalizedDomain) {
                result = await client.query(`
                                SELECT id, type, title, name, status, metadata, attributes, created_at, updated_at
                FROM content
                WHERE LOWER(COALESCE(${hasDomainColumn ? 'domain, ' : ''}attributes->>'domain', metadata->>'domain', '')) = $2
                                    AND LOWER(TRIM(COALESCE(status, ''))) <> 'pending delete'
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT $1
            `, [limit, normalizedDomain])
            } else {
                result = await client.query(`
                SELECT id, type, title, name, status, metadata, attributes, created_at, updated_at
                FROM content
                WHERE LOWER(TRIM(COALESCE(status, ''))) <> 'pending delete'
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT $1
            `, [limit])
            }
        } catch (error) {
            if (error?.code === '42P01') {
                return []
            }
            throw error
        }

        return (result.rows || [])
            .map((row) => normalizeContentUpdate(row, { summaryTitle: false, fallbackUpdater }))
            .filter(Boolean)
    } finally {
        await client.end().catch(() => { })
    }
}

async function queryRecentChatUpdatesPostgres(connectionString, limit = 3, domainKey = '', session = null) {
    const { Client } = await import('pg')
    const client = new Client(buildPgClientConfig(connectionString, { statement_timeout: 10000 }))
    const normalizedDomain = normalizeDomainKey(domainKey)

    try {
        await client.connect()
        await bindRlsSession(client, session)

        let result
        try {
            if (normalizedDomain) {
                result = await client.query(`
                SELECT id, domain, role, session_id, messages, metadata, status, created_at, updated_at
                FROM chats
                WHERE LOWER(COALESCE(domain, '')) = $2
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT $1
            `, [limit, normalizedDomain])
            } else {
                result = await client.query(`
                SELECT id, domain, role, session_id, messages, metadata, status, created_at, updated_at
                FROM chats
                ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
                LIMIT $1
            `, [limit])
            }
        } catch (error) {
            if (error?.code === '42P01') {
                return []
            }
            throw error
        }

        return (result.rows || [])
            .map(normalizeChatUpdate)
            .filter(Boolean)
    } finally {
        await client.end().catch(() => { })
    }
}

async function queryRecentActivityPostgres(connectionString, session = null) {
    const { Client } = await import('pg')
    const client = new Client(buildPgClientConfig(connectionString, { statement_timeout: 10000 }))

    try {
        await client.connect()
        await bindRlsSession(client, session)

        let latestResult
        try {
            latestResult = await client.query(
                `
        SELECT key, value, updated_at AS started_at, updated_at
        FROM system_settings
        WHERE key = ANY($1)
        ORDER BY updated_at DESC NULLS LAST
        `,
                [LATEST_KEYS]
            )
        } catch (error) {
            if (error?.code === '42P01') {
                return []
            }
            throw error
        }

        let rows = latestResult.rows || []

        if (rows.length === 0) {
            const fallbackResult = await client.query(`
        SELECT key, value, updated_at AS started_at, updated_at
        FROM system_settings
                WHERE key LIKE 'enrichment_session_%'
                    OR key LIKE 'database_update_session_%'
                    OR key LIKE 'domain_service_startup_session_%'
        ORDER BY updated_at DESC NULLS LAST, started_at DESC NULLS LAST
        LIMIT 10
      `)
            rows = fallbackResult.rows || []
        }

        return rows
            .map(normalizeActivity)
            .filter(Boolean)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 10)
    } finally {
        await client.end().catch(() => { })
    }
}

export async function GET(request) {
    try {
        const { domainScope, requester } = await resolveRequestContext(request)
        const requesterLabel = requester?.username || formatRoleLabel(requester?.role) || ''
        const connectionString = process.env.DATABASE_URL
        if (!connectionString) {
            return NextResponse.json({ success: false, error: 'Database not configured' }, { status: 400 })
        }

        const dbType = detectDatabaseType(connectionString)
        if (!dbType) {
            return NextResponse.json({ success: false, error: 'Unsupported database type' }, { status: 400 })
        }

        const session = domainScope
            ? { domain: domainScope }
            : (isSuperAdmin(requester) ? { superadmin: true } : { domain: DEFAULT_CONTENT_DOMAIN })

        let activity = []
        if (dbType === 'postgresql') {
            activity = await queryRecentActivityPostgres(connectionString, session)
        }

        let contentUpdates = []
        if (dbType === 'postgresql') {
            contentUpdates = await queryRecentContentUpdatesPostgres(connectionString, 3, domainScope, requesterLabel, session)
        }

        let chatUpdates = []
        if (dbType === 'postgresql') {
            chatUpdates = await queryRecentChatUpdatesPostgres(connectionString, 3, domainScope, session)
        }

        const latestContent = summarizeContentUpdate(contentUpdates[0])
        const merged = latestContent ? [...activity, latestContent] : activity
        const normalized = sortActivity(dedupeLatestByType(merged))

        return NextResponse.json({ success: true, activity: normalized, contentUpdates, chatUpdates })
    } catch (error) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    }
}
