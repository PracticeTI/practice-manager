import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { whenTablesMissing } from './pgOptionalDdl.js'

function normalizeChatRoles(rawRoles) {
    if (!Array.isArray(rawRoles)) return []

    const seen = new Set()
    const roles = []

    for (const value of rawRoles) {
        const role = String(value || '').trim()
        if (!role) continue
        const key = role.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        roles.push(role)
    }

    return roles
}

export function normalizeChatRole(allowedRoles = [], requestedRole = '', fallbackRole = 'Contact') {
    const normalizedAllowedRoles = normalizeChatRoles(allowedRoles)
    const requested = String(requestedRole || '').trim()

    if (requested && normalizedAllowedRoles.some((role) => role.toLowerCase() === requested.toLowerCase())) {
        return normalizedAllowedRoles.find((role) => role.toLowerCase() === requested.toLowerCase())
    }

    if (normalizedAllowedRoles.length > 0) {
        return normalizedAllowedRoles[0]
    }

    return String(fallbackRole || 'Contact').trim() || 'Contact'
}

export async function ensureChatsTable(connection, dbType) {
    const resolvedDbType = dbType || detectDatabaseType()

    if (resolvedDbType === 'postgresql') {
        await whenTablesMissing(connection, ['chats'], async () => {
            await connection.query(`
                CREATE TABLE IF NOT EXISTS chats (
                    id BIGSERIAL PRIMARY KEY,
                    domain VARCHAR(100) NOT NULL,
                    role VARCHAR(50) NOT NULL,
                    session_id VARCHAR(255),
                    messages JSONB NOT NULL DEFAULT '[]',
                    metadata JSONB,
                    status VARCHAR(50) DEFAULT 'active',
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            `)

            await connection.query('CREATE INDEX IF NOT EXISTS idx_chats_domain_role ON chats(domain, role)')
            await connection.query('CREATE INDEX IF NOT EXISTS idx_chats_session_id ON chats(session_id)')
            await connection.query('CREATE INDEX IF NOT EXISTS idx_chats_created_at ON chats(created_at)')
        })
        return
    }

    throw new Error(`Chat support requires postgresql (detected: ${resolvedDbType || 'none'})`)
}

export async function logChatSession({ domain, role, sessionId = '', messages = [], metadata = {}, status = 'completed' }) {
    const dbType = detectDatabaseType()
    if (dbType !== 'postgresql') {
        return {
            success: false,
            error: `Chat logging requires postgresql (detected: ${dbType || 'none'})`
        }
    }

    const normalizedDomain = String(domain || '').trim().toLowerCase()
    const normalizedRole = String(role || 'Contact').trim() || 'Contact'
    const normalizedSessionId = String(sessionId || '').trim()
    const normalizedMessages = Array.isArray(messages) ? messages : []
    const normalizedMetadata = metadata && typeof metadata === 'object' ? metadata : {}
    const normalizedStatus = String(status || 'completed').trim() || 'completed'

    let connection = null

    try {
        connection = await getDatabaseConnection()
        await ensureChatsTable(connection, dbType)

        const result = await connection.query(
            `INSERT INTO chats (domain, role, session_id, messages, metadata, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NOW(), NOW())
             RETURNING id`,
            [
                normalizedDomain,
                normalizedRole,
                normalizedSessionId || null,
                JSON.stringify(normalizedMessages),
                JSON.stringify(normalizedMetadata),
                normalizedStatus
            ]
        )

        return { success: true, id: result?.rows?.[0]?.id || null }
    } catch (error) {
        return { success: false, error: error?.message || 'Failed to log chat session' }
    } finally {
        if (connection?.end) {
            await connection.end().catch(() => { })
        } else if (connection?.close) {
            await connection.close().catch(() => { })
        }
    }
}

export function normalizeChatRolesForSettings(rawRoles) {
    return normalizeChatRoles(rawRoles)
}
