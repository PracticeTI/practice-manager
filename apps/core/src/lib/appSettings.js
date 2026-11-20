/**
 * Application settings, split by scope.
 *
 * `system_settings` holds system-wide values: the Settings page tools
 * (infra_mode, display policy), caches and queue state,
 * AI configuration, and the catalogues. It has no tenant column, so its policy is
 * scoped to the runtime role.
 *
 * `domain_settings` holds per-domain values keyed by (domain, key). It is in the
 * tenant policy set, so `domain = app.current_domain` applies.
 *
 * `user_settings` holds per-admin values keyed by (domain, username, key) — a
 * dashboard layout today, and the home for other per-user preferences. The
 * connection binds both `app.current_domain` and `app.current_username`, so one
 * admin cannot read another's rows and no admin can read across domains.
 *
 * All three replaced the single `system_state` key/value table, which mixed the
 * scopes — per-domain values were stored either as one JSON map keyed by domain or
 * with the domain baked into the key name, which made them invisible to row-level
 * security.
 */

import { detectDatabaseType, getDatabaseConnection } from '@/lib/database'
import { getDomainBoundConnection, getSuperAdminConnection } from '@/lib/domainScopedConnection'
import { settingsTablesProbe } from './settingsTables.js'

function parseValue(value) {
    if (value === null || value === undefined) return null
    if (typeof value === 'object') return value
    if (typeof value === 'string') {
        try {
            return JSON.parse(value)
        } catch {
            return value
        }
    }
    return value
}

function serializeValue(value) {
    return typeof value === 'string' ? value : JSON.stringify(value)
}

function requireKey(key) {
    const normalized = String(key || '').trim()
    if (!normalized) throw new Error('A settings key is required')
    return normalized
}

function requireDomain(domain) {
    const normalized = String(domain || '').trim().toLowerCase()
    if (!normalized) throw new Error('A domain is required for domain settings')
    return normalized
}

async function withPlainConnection(operation) {
    if (detectDatabaseType() !== 'postgresql') return null
    const connection = await getDatabaseConnection()
    try {
        return await operation(connection)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/**
 * Run `operation` on a session bound to `domain`.
 *
 * `inherited` lets a route that already holds a bound session pass it in instead
 * of opening a second one; the caller then owns its lifetime, so it is not ended
 * here.
 */
async function withBoundConnection(domain, operation, inherited = null) {
    if (inherited) return operation(inherited)

    const connection = await getDomainBoundConnection(domain)
    try {
        return await operation(connection)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/** The cross-tenant twin of `withBoundConnection`; caller must have verified superadmin. */
async function withSuperAdminConnection(operation, inherited = null) {
    if (inherited) return operation(inherited)

    const connection = await getSuperAdminConnection()
    try {
        return await operation(connection)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

/**
 * Confirm the tables exist, creating them only when they are missing.
 *
 * Returns `false` when they are missing and cannot be created — a constrained
 * runtime role has no CREATE on `schema public`. Callers then use defaults rather
 * than throwing. Warming the probe costs one connection per process; afterwards
 * this is a no-op.
 */
export async function ensureSettingsTables(connection = null) {
    if (settingsTablesProbe.isPresent()) return true

    if (connection) return settingsTablesProbe.ensure(connection)

    if (detectDatabaseType() !== 'postgresql') return false
    const owned = await getDatabaseConnection()
    try {
        return await settingsTablesProbe.ensure(owned)
    } finally {
        if (owned?.end) await owned.end().catch(() => { })
    }
}

export async function getSystemSetting(key) {
    const normalizedKey = requireKey(key)

    return withPlainConnection(async (connection) => {
        if (!(await settingsTablesProbe.ensure(connection))) return null

        const result = await connection.query(
            'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
            [normalizedKey]
        )
        return result.rows?.length ? parseValue(result.rows[0].value) : null
    }).catch(() => null)
}

export async function setSystemSetting(key, value) {
    const normalizedKey = requireKey(key)
    const serialized = serializeValue(value)

    return withPlainConnection(async (connection) => {
        if (!(await settingsTablesProbe.ensure(connection))) return false

        await connection.query(
            `INSERT INTO system_settings (key, value, created_at, updated_at)
             VALUES ($1, $2, NOW(), NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [normalizedKey, serialized]
        )
        return true
    }).catch(() => false)
}

export async function deleteSystemSetting(key) {
    const normalizedKey = requireKey(key)

    return withPlainConnection(async (connection) => {
        if (!(await settingsTablesProbe.ensure(connection))) return false
        const result = await connection.query('DELETE FROM system_settings WHERE key = $1', [normalizedKey])
        return (result?.rowCount || 0) > 0
    }).catch(() => false)
}

export async function listSystemSettings() {
    return withPlainConnection(async (connection) => {
        if (!(await settingsTablesProbe.ensure(connection))) return []
        const result = await connection.query(
            'SELECT key, value, created_at, updated_at FROM system_settings ORDER BY key'
        )
        return (result.rows || []).map((row) => ({
            key: row.key,
            value: row.value,
            parsedValue: parseValue(row.value),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }))
    }).catch(() => [])
}

/**
 * Read one setting for a domain.
 *
 * `options.connection` is an already domain-bound session to reuse; the caller
 * keeps ownership of it.
 */
export async function getDomainSetting(domain, key, options = {}) {
    const normalizedDomain = requireDomain(domain)
    const normalizedKey = requireKey(key)

    if (!(await ensureSettingsTables())) return null

    return withBoundConnection(normalizedDomain, async (connection) => {
        const result = await connection.query(
            'SELECT value FROM domain_settings WHERE domain = $1 AND key = $2 LIMIT 1',
            [normalizedDomain, normalizedKey]
        )
        return result.rows?.length ? parseValue(result.rows[0].value) : null
    }, options?.connection).catch(() => null)
}

/** Read several per-domain settings in one bound connection. */
export async function getDomainSettings(domain, keys) {
    const normalizedDomain = requireDomain(domain)
    const requested = [...new Set((Array.isArray(keys) ? keys : []).map((key) => requireKey(key)))]
    if (requested.length === 0) return {}

    if (!(await ensureSettingsTables())) {
        return Object.fromEntries(requested.map((key) => [key, null]))
    }

    const stored = await withBoundConnection(normalizedDomain, async (connection) => {
        const result = await connection.query(
            'SELECT key, value FROM domain_settings WHERE domain = $1 AND key = ANY($2::text[])',
            [normalizedDomain, requested]
        )
        return new Map((result.rows || []).map((row) => [row.key, parseValue(row.value)]))
    }).catch(() => new Map())

    const settings = {}
    for (const key of requested) {
        settings[key] = stored.has(key) ? stored.get(key) : null
    }
    return settings
}

/**
 * Read one setting across every domain. Cross-domain, so it runs as a superadmin
 * session; callers must have verified superadmin themselves.
 *
 * `options.connection` is an already-bound superadmin session to reuse; the caller
 * keeps ownership of it.
 */
export async function getAllDomainSettings(key = null, options = {}) {
    const normalizedKey = key ? requireKey(key) : null

    if (!(await ensureSettingsTables())) return {}

    const rows = await withSuperAdminConnection(async (connection) => {
        const result = normalizedKey
            ? await connection.query(
                'SELECT domain, key, value FROM domain_settings WHERE key = $1 ORDER BY domain',
                [normalizedKey]
            )
            : await connection.query('SELECT domain, key, value FROM domain_settings ORDER BY domain, key')
        return result.rows || []
    }, options?.connection)

    const settings = {}
    for (const row of rows) {
        if (normalizedKey) {
            settings[row.domain] = parseValue(row.value)
        } else {
            settings[row.domain] = settings[row.domain] || {}
            settings[row.domain][row.key] = parseValue(row.value)
        }
    }
    return settings
}

export async function setDomainSetting(domain, key, value) {
    const normalizedDomain = requireDomain(domain)
    const normalizedKey = requireKey(key)
    const serialized = serializeValue(value)

    if (!(await ensureSettingsTables())) return false

    return withBoundConnection(normalizedDomain, async (connection) => {
        await connection.query(
            `INSERT INTO domain_settings (domain, key, value, created_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())
             ON CONFLICT (domain, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [normalizedDomain, normalizedKey, serialized]
        )
        return true
    }).catch(() => false)
}

export async function deleteDomainSetting(domain, key) {
    const normalizedDomain = requireDomain(domain)
    const normalizedKey = requireKey(key)

    if (!(await ensureSettingsTables())) return false

    return withBoundConnection(normalizedDomain, async (connection) => {
        const result = await connection.query(
            'DELETE FROM domain_settings WHERE domain = $1 AND key = $2',
            [normalizedDomain, normalizedKey]
        )
        return (result?.rowCount || 0) > 0
    }).catch(() => false)
}

export async function listDomainSettings(domain) {
    const normalizedDomain = requireDomain(domain)

    if (!(await ensureSettingsTables())) return []

    return withBoundConnection(normalizedDomain, async (connection) => {
        const result = await connection.query(
            'SELECT key, value, created_at, updated_at FROM domain_settings WHERE domain = $1 ORDER BY key',
            [normalizedDomain]
        )
        return (result.rows || []).map((row) => ({
            key: row.key,
            value: row.value,
            parsedValue: parseValue(row.value),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }))
    }).catch(() => [])
}

function requireUsername(username) {
    const normalized = String(username || '').trim().toLowerCase().slice(0, 100)
    if (!normalized) throw new Error('A username is required for user settings')
    return normalized
}

/**
 * Open a connection bound to the tenant *and* the user, so the `user_settings`
 * policy can match `app.current_username`.
 */
async function withUserBoundConnection(domain, username, operation) {
    const connection = await getDomainBoundConnection(domain, { username })
    try {
        return await operation(connection)
    } finally {
        if (connection?.end) await connection.end().catch(() => { })
    }
}

export async function getUserSetting(domain, username, key) {
    const normalizedDomain = requireDomain(domain)
    const normalizedUsername = requireUsername(username)
    const normalizedKey = requireKey(key)

    if (!(await ensureSettingsTables())) return null

    return withUserBoundConnection(normalizedDomain, normalizedUsername, async (connection) => {
        const result = await connection.query(
            'SELECT value FROM user_settings WHERE domain = $1 AND username = $2 AND key = $3 LIMIT 1',
            [normalizedDomain, normalizedUsername, normalizedKey]
        )
        return result.rows?.length ? parseValue(result.rows[0].value) : null
    }).catch(() => null)
}

/** Read several per-user settings in one bound connection. */
export async function getUserSettings(domain, username, keys) {
    const normalizedDomain = requireDomain(domain)
    const normalizedUsername = requireUsername(username)
    const requested = [...new Set((Array.isArray(keys) ? keys : []).map((key) => requireKey(key)))]
    if (requested.length === 0) return {}

    if (!(await ensureSettingsTables())) {
        return Object.fromEntries(requested.map((key) => [key, null]))
    }

    const stored = await withUserBoundConnection(normalizedDomain, normalizedUsername, async (connection) => {
        const result = await connection.query(
            `SELECT key, value FROM user_settings
             WHERE domain = $1 AND username = $2 AND key = ANY($3::text[])`,
            [normalizedDomain, normalizedUsername, requested]
        )
        return new Map((result.rows || []).map((row) => [row.key, parseValue(row.value)]))
    }).catch(() => new Map())

    const settings = {}
    for (const key of requested) {
        settings[key] = stored.has(key) ? stored.get(key) : null
    }
    return settings
}

export async function setUserSetting(domain, username, key, value) {
    const normalizedDomain = requireDomain(domain)
    const normalizedUsername = requireUsername(username)
    const normalizedKey = requireKey(key)
    const serialized = serializeValue(value)

    if (!(await ensureSettingsTables())) return false

    return withUserBoundConnection(normalizedDomain, normalizedUsername, async (connection) => {
        await connection.query(
            `INSERT INTO user_settings (domain, username, key, value, created_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             ON CONFLICT (domain, username, key)
             DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [normalizedDomain, normalizedUsername, normalizedKey, serialized]
        )
        return true
    }).catch(() => false)
}

export async function deleteUserSetting(domain, username, key) {
    const normalizedDomain = requireDomain(domain)
    const normalizedUsername = requireUsername(username)
    const normalizedKey = requireKey(key)

    if (!(await ensureSettingsTables())) return false

    return withUserBoundConnection(normalizedDomain, normalizedUsername, async (connection) => {
        const result = await connection.query(
            'DELETE FROM user_settings WHERE domain = $1 AND username = $2 AND key = $3',
            [normalizedDomain, normalizedUsername, normalizedKey]
        )
        return (result?.rowCount || 0) > 0
    }).catch(() => false)
}

export async function listUserSettings(domain, username) {
    const normalizedDomain = requireDomain(domain)
    const normalizedUsername = requireUsername(username)

    if (!(await ensureSettingsTables())) return []

    return withUserBoundConnection(normalizedDomain, normalizedUsername, async (connection) => {
        const result = await connection.query(
            `SELECT key, value, created_at, updated_at FROM user_settings
             WHERE domain = $1 AND username = $2 ORDER BY key`,
            [normalizedDomain, normalizedUsername]
        )
        return (result.rows || []).map((row) => ({
            key: row.key,
            value: row.value,
            parsedValue: parseValue(row.value),
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        }))
    }).catch(() => [])
}
